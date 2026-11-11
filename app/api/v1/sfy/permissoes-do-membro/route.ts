import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, Bloco A1) — permissão "ver todos os leads" por membro.
 *
 *   GET /api/v1/sfy/permissoes-do-membro  → quem tem a permissão nesta organização
 *   PUT /api/v1/sfy/permissoes-do-membro  → liga/desliga para um membro (admin)
 *
 * A permissão vale para o ATENDENTE (agent): gerente, leitor e admin já veem
 * tudo pela regra do original. Quem aplica é o banco (`fn_can_view_lead`,
 * `fn_can_view_conversation`, `fn_conversation_scope`, migration 5002); esta
 * rota só grava `sfy_permissoes_do_membro`. Organização SEMPRE da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { invalidarUsuario } from "@/lib/auth/cache-curto";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const permissaoSchema = z
  .object({
    user_id: z.string().uuid(),
    ver_todos_os_leads: z.boolean(),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sfy_permissoes_do_membro")
    .select("user_id, ver_todos_os_leads")
    .eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const t = (texto: string) => traduzir(texto, authUser.idioma);

  let input;
  try {
    input = await validateRequest(permissaoSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Escrita pelo admin client (a tabela não tem policy de escrita), com a
  // organização da sessão em todo filtro.
  const admin = createAdminClient();
  const { data: membro, error: membroErr } = await admin
    .from("user_organizations")
    .select("user_id, role, revoked_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", input.user_id)
    .maybeSingle();
  if (membroErr) return fail("internal_error", membroErr.message, 500, { requestId });
  if (!membro || membro.revoked_at) {
    return fail("not_found", t("Membro não encontrado."), 404, { requestId });
  }

  const { data: anterior } = await admin
    .from("sfy_permissoes_do_membro")
    .select("ver_todos_os_leads")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", input.user_id)
    .maybeSingle();

  invalidarUsuario(input.user_id);
  const { error: gravarErr } = await admin.from("sfy_permissoes_do_membro").upsert(
    {
      organization_id: activeOrg.orgId,
      user_id: input.user_id,
      ver_todos_os_leads: input.ver_todos_os_leads,
      updated_at: new Date().toISOString(),
      updated_by: authUser.id,
    },
    { onConflict: "organization_id,user_id" },
  );
  if (gravarErr) return fail("internal_error", gravarErr.message, 500, { requestId });
  invalidarUsuario(input.user_id);

  await audit({
    action: "sfy.member_permission_changed",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "membership",
    resourceId: input.user_id,
    requestId,
    metadata: {
      target_user_id: input.user_id,
      target_role: membro.role,
      ver_todos_os_leads: {
        antes: (anterior as { ver_todos_os_leads?: boolean } | null)?.ver_todos_os_leads === true,
        depois: input.ver_todos_os_leads,
      },
    },
  });

  return ok({ user_id: input.user_id, ver_todos_os_leads: input.ver_todos_os_leads }, { requestId });
}
