import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, etapa 7B) — cria um supervisor (admin).
 *
 *   POST /api/v1/sfy/supervisores
 *
 * Editar e desativar ficam em PUT /api/v1/sfy/parceiros (tipo "supervisor"). O supervisor novo nasce
 * sem usuário do CRM ligado e sem ser padrão; na Climabrisa ele passa a receber leads quando algum
 * parceiro é colocado sob ele; no Agro, pelos estados informados.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { normalizePhoneBR } from "@/lib/channels/phone-variants";
import { traduzir } from "@/lib/i18n/dicionario";
import { validateRequest } from "@/lib/schemas";
import { donoDoNome, UFS_DO_BRASIL, ufsEmUso, type SupervisorCadastrado } from "@/lib/sfy/supervisores";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const criacao = z
  .object({
    nome: z.string().trim().min(1).max(120),
    categoria: z.enum(["climabrisa", "agro"]),
    whatsapp: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().max(200).nullable().optional(),
    ufs: z.array(z.enum(UFS_DO_BRASIL)).max(27).optional(),
  })
  .strict();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const t = (texto: string) => traduzir(texto, authUser.idioma);

  let input;
  try {
    input = await validateRequest(criacao, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    }
    throw err;
  }
  const whatsapp = input.whatsapp ? normalizePhoneBR(input.whatsapp) : null;
  if (input.whatsapp && !whatsapp) return fail("validation_failed", t("WhatsApp inválido. Use DDD + número."), 422, { requestId });
  const email = input.email || null;
  if (email && !EMAIL.test(email)) return fail("validation_failed", t("E-mail inválido."), 422, { requestId });

  const admin = createAdminClient();
  const org = activeOrg.orgId;
  const { data: existentes, error: erroLista } = await admin
    .from("sfy_supervisores")
    .select("id, nome, categoria, ufs, ativo, nomes_anteriores")
    .eq("organization_id", org);
  if (erroLista) return fail("internal_error", erroLista.message, 500, { requestId });
  const lista = (existentes ?? []) as SupervisorCadastrado[];
  const repetido = donoDoNome(lista, input.nome);
  if (repetido) return fail("conflict", `${t("Já existe um supervisor com este nome:")} ${repetido.nome}`, 409, { requestId });
  const ufs = input.categoria === "agro" ? [...new Set(input.ufs ?? [])].sort() : [];
  const ocupadas = ufsEmUso(lista, ufs);
  if (ocupadas.length > 0) {
    return fail("conflict", `${t("Estado já atendido por outro supervisor:")} ${ocupadas.map((o) => `${o.uf} (${o.nome})`).join(", ")}`, 409, { requestId });
  }

  const { data: criado, error } = await admin
    .from("sfy_supervisores")
    .insert({ organization_id: org, nome: input.nome, categoria: input.categoria, whatsapp, email, ufs })
    .select("id")
    .single();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "sfy.distribuicao_cadastro_changed",
    actorUserId: authUser.id,
    organizationId: org,
    resourceType: "sfy_supervisores",
    resourceId: criado.id,
    requestId,
    metadata: { tipo: "supervisor", criado: true, categoria: input.categoria },
  });
  return ok({ id: criado.id }, { requestId, status: 201 });
}
