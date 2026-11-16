import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, Bloco C) — cadastro de parceiros e supervisores.
 *
 *   GET /api/v1/sfy/parceiros  → supervisores e parceiros da organização (gerente+)
 *   PUT /api/v1/sfy/parceiros  → corrige contato, supervisor e "ativo" de um deles (admin)
 *
 * A carga em massa (os 134 parceiros do mapa) é feita por script na entrega; esta rota
 * cobre o dia a dia: a Mariana corrige um WhatsApp, troca o supervisor de um parceiro ou
 * tira um parceiro do rodízio. Quem escolhe o destino é o banco (`fn_sfy_escolher_destino`).
 * Organização SEMPRE da sessão; escrita pelo admin client (as tabelas não têm policy de escrita).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { normalizePhoneBR } from "@/lib/channels/phone-variants";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Texto opcional: vazio vira null (apaga o contato); `undefined` = não mexer. */
const contato = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : (v ?? "").trim() || null));

const base = {
  id: z.string().uuid(),
  whatsapp: contato,
  email: contato,
  ativo: z.boolean().optional(),
};

const edicaoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("parceiro"), ...base, supervisor_id: z.string().uuid().nullable().optional() }).strict(),
  z.object({ tipo: z.literal("supervisor"), ...base }).strict(),
]);

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const org = authz.org.orgId;
  const [sup, par] = await Promise.all([
    supabase
      .from("sfy_supervisores")
      .select("id, nome, categoria, whatsapp, email, user_id, ufs, padrao, ativo")
      .eq("organization_id", org)
      .order("nome"),
    supabase
      .from("sfy_parceiros")
      .select("id, codigo, nome, categoria, whatsapp, email, supervisor_id, ativo, ultimo_recebimento_em")
      .eq("organization_id", org)
      .order("nome")
      .limit(1000),
  ]);
  if (sup.error) return fail("internal_error", sup.error.message, 500, { requestId });
  if (par.error) return fail("internal_error", par.error.message, 500, { requestId });

  // Quantas cidades cada parceiro atende: lê só o id, em páginas de 1000 (o teto da API).
  const cidades = new Map<string, number>();
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await supabase
      .from("sfy_parceiro_cidades")
      .select("parceiro_id")
      .eq("organization_id", org)
      .order("parceiro_id")
      .order("cidade_norm")
      .order("uf")
      .range(de, de + 999);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    for (const l of data ?? []) cidades.set(l.parceiro_id, (cidades.get(l.parceiro_id) ?? 0) + 1);
    if ((data?.length ?? 0) < 1000) break;
  }
  const parceiros = (par.data ?? []).map((p) => ({ ...p, cidades: cidades.get(p.id) ?? 0 }));
  return ok({ supervisores: sup.data ?? [], parceiros }, { requestId });
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
    input = await validateRequest(edicaoSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.whatsapp !== undefined) {
    if (input.whatsapp !== null && !normalizePhoneBR(input.whatsapp)) {
      return fail("validation_failed", t("WhatsApp inválido. Use DDD + número."), 422, { requestId });
    }
    patch.whatsapp = input.whatsapp === null ? null : normalizePhoneBR(input.whatsapp);
  }
  if (input.email !== undefined) {
    if (input.email !== null && !EMAIL.test(input.email)) {
      return fail("validation_failed", t("E-mail inválido."), 422, { requestId });
    }
    patch.email = input.email;
  }
  if (input.ativo !== undefined) patch.ativo = input.ativo;

  const admin = createAdminClient();
  const org = activeOrg.orgId;

  if (input.tipo === "parceiro" && input.supervisor_id !== undefined) {
    if (input.supervisor_id !== null) {
      const { data: s } = await admin
        .from("sfy_supervisores")
        .select("id")
        .eq("organization_id", org)
        .eq("id", input.supervisor_id)
        .eq("categoria", "climabrisa")
        .maybeSingle();
      if (!s) return fail("not_found", t("Supervisor não encontrado."), 404, { requestId });
    }
    patch.supervisor_id = input.supervisor_id;
  }

  const tabela = input.tipo === "parceiro" ? "sfy_parceiros" : "sfy_supervisores";
  const { data: anterior } = await admin
    .from(tabela)
    .select("whatsapp, email, ativo")
    .eq("organization_id", org)
    .eq("id", input.id)
    .maybeSingle();
  if (!anterior) return fail("not_found", t("Cadastro não encontrado."), 404, { requestId });

  const { error } = await admin.from(tabela).update(patch).eq("organization_id", org).eq("id", input.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "sfy.distribuicao_cadastro_changed",
    actorUserId: authUser.id,
    organizationId: org,
    resourceType: tabela,
    resourceId: input.id,
    requestId,
    // Sem gravar o telefone/e-mail no registro: só diz o que mudou.
    metadata: {
      tipo: input.tipo,
      campos: Object.keys(patch).filter((k) => k !== "updated_at"),
      ativo: { antes: (anterior as { ativo?: boolean }).ativo ?? null, depois: input.ativo ?? null },
    },
  });

  return ok({ id: input.id }, { requestId });
}
