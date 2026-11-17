/**
 * sfy (Bloco D) — pedidos de fechamento informados pelos parceiros pelo link.
 *
 * GET lista (manager+): pendentes primeiro, com parceiro, negócio, valor e nota.
 * PATCH (só administrador): marca o pedido como `tratado` (o ADM conferiu e concluiu o negócio
 * pelas regras de sempre) ou `recusado`. NÃO muda o negócio: valor do ganho e DANFE seguem o
 * Bloco A. Escrita pelo servidor com a organização explícita (a tabela não é do usuário).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ id: z.string().uuid(), status: z.enum(["tratado", "recusado"]) }).strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("sfy_fechamentos_sinalizados")
    .select("id, lead_id, parceiro_id, valor_centavos, moeda, nota_fiscal, observacao, status, criado_em, decidido_em")
    .eq("organization_id", org)
    .order("criado_em", { ascending: false })
    .limit(300);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const linhas = data ?? [];

  const parceiroIds = [...new Set(linhas.map((l) => l.parceiro_id as string))];
  const leadIds = [...new Set(linhas.map((l) => l.lead_id as string))];
  const [{ data: parceiros }, { data: leads }] = await Promise.all([
    parceiroIds.length ? admin.from("sfy_parceiros").select("id, codigo, nome").eq("organization_id", org).in("id", parceiroIds) : Promise.resolve({ data: [] }),
    leadIds.length ? admin.from("crm_leads").select("id, title, status").eq("organization_id", org).in("id", leadIds) : Promise.resolve({ data: [] }),
  ]);
  const nomeDoParceiro = new Map((parceiros ?? []).map((p) => [p.id as string, `${p.codigo} - ${p.nome}`]));
  const negocio = new Map((leads ?? []).map((l) => [l.id as string, l as { title: string | null; status: string }]));

  const ordem = { pendente: 0, tratado: 1, recusado: 1 } as const;
  const pedidos = linhas
    .map((l) => ({
      ...l,
      parceiro: nomeDoParceiro.get(l.parceiro_id as string) ?? "",
      negocio_titulo: negocio.get(l.lead_id as string)?.title ?? "",
      negocio_status: negocio.get(l.lead_id as string)?.status ?? "",
    }))
    .sort((a, b) => ordem[a.status as keyof typeof ordem] - ordem[b.status as keyof typeof ordem]);
  return ok({ pedidos }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let input;
  try {
    input = await validateRequest(patchSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    }
    throw err;
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { data: anterior } = await admin
    .from("sfy_fechamentos_sinalizados")
    .select("id, status")
    .eq("organization_id", org)
    .eq("id", input.id)
    .maybeSingle();
  if (!anterior) return fail("not_found", t("Pedido não encontrado."), 404, { requestId });
  if (anterior.status !== "pendente") return fail("conflict", t("Este pedido já foi tratado."), 409, { requestId });

  const { error } = await admin
    .from("sfy_fechamentos_sinalizados")
    .update({ status: input.status, decidido_em: new Date().toISOString(), decidido_por: authz.user.id })
    .eq("organization_id", org)
    .eq("id", input.id)
    .eq("status", "pendente");
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "sfy.fechamento_decidido",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "sfy_fechamentos_sinalizados",
    resourceId: input.id,
    requestId,
    metadata: { status: input.status },
  });
  return ok({ id: input.id, status: input.status }, { requestId });
}
