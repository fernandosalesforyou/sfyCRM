import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, etapa 7B) — as cidades que um parceiro atende.
 *
 *   GET /api/v1/sfy/parceiros/<id>/cidades  → cidades do parceiro (gerente+)
 *   PUT /api/v1/sfy/parceiros/<id>/cidades  → adiciona e/ou remove cidades (admin)
 *
 * As cidades vêm SEMPRE da lista fechada do IBGE (`sfy_municipios`, pelo código): nada de texto
 * livre, então não há cidade escrita errada. Cada troca refaz o supervisor das cidades sem
 * parceiro elegível e devolve o impacto (quantas cidades passam a ter rodízio e quantas ficaram
 * sem parceiro), para a tela avisar a Mariana.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { validateRequest } from "@/lib/schemas";
import { impactoDasCidades } from "@/lib/sfy/cadastro";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAXIMO_POR_PEDIDO = 500;

const troca = z
  .object({
    adicionar: z.array(z.number().int().positive()).max(MAXIMO_POR_PEDIDO).optional(),
    remover: z.array(z.number().int().positive()).max(MAXIMO_POR_PEDIDO).optional(),
    // Cidade cadastrada com grafia fora do IBGE (carga antiga): sai pelo nome normalizado.
    remover_nomes: z
      .array(z.object({ uf: z.string().regex(/^[A-Z]{2}$/), cidade_norm: z.string().min(1).max(120) }))
      .max(MAXIMO_POR_PEDIDO)
      .optional(),
  })
  .strict();

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "id", 422, { requestId });

  const supabase = await createClient();
  const org = authz.org.orgId;
  const linhas: { cidade_norm: string; uf: string }[] = [];
  for (let de = 0; de < 5000; de += 1000) {
    const { data, error } = await supabase
      .from("sfy_parceiro_cidades")
      .select("cidade_norm, uf")
      .eq("organization_id", org)
      .eq("parceiro_id", id)
      .order("uf")
      .order("cidade_norm")
      .range(de, de + 999);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    linhas.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  // O nome com acento e o código do IBGE vêm da tabela de municípios (só o servidor lê).
  const admin = createAdminClient();
  const porUf = new Map<string, string[]>();
  for (const l of linhas) porUf.set(l.uf, [...(porUf.get(l.uf) ?? []), l.cidade_norm]);
  const nomes = new Map<string, { codigo_ibge: number; nome: string }>();
  for (const [uf, norms] of porUf) {
    for (let i = 0; i < norms.length; i += 200) {
      const { data } = await admin
        .from("sfy_municipios")
        .select("codigo_ibge, nome, nome_norm")
        .eq("uf", uf)
        .in("nome_norm", norms.slice(i, i + 200));
      for (const m of data ?? []) nomes.set(`${uf}|${m.nome_norm}`, { codigo_ibge: m.codigo_ibge, nome: m.nome });
    }
  }
  const cidades = linhas.map((l) => {
    const m = nomes.get(`${l.uf}|${l.cidade_norm}`);
    return { uf: l.uf, cidade_norm: l.cidade_norm, nome: m?.nome ?? l.cidade_norm, codigo_ibge: m?.codigo_ibge ?? null };
  });
  return ok({ cidades }, { requestId });
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const t = (texto: string) => traduzir(texto, authUser.idioma);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "id", 422, { requestId });

  let input;
  try {
    input = await validateRequest(troca, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    }
    throw err;
  }
  const adicionar = [...new Set(input.adicionar ?? [])];
  const remover = [...new Set(input.remover ?? [])];
  const removerNomes = input.remover_nomes ?? [];
  if (adicionar.length === 0 && remover.length === 0 && removerNomes.length === 0) {
    return fail("validation_failed", t("Nada para alterar."), 422, { requestId });
  }

  const admin = createAdminClient();
  const org = activeOrg.orgId;
  const { data: parceiro } = await admin
    .from("sfy_parceiros")
    .select("id")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (!parceiro) return fail("not_found", t("Cadastro não encontrado."), 404, { requestId });

  const codigos = [...adicionar, ...remover];
  const { data: municipios, error: erroMun } = await admin
    .from("sfy_municipios")
    .select("codigo_ibge, nome_norm, uf")
    .in("codigo_ibge", codigos);
  if (erroMun) return fail("internal_error", erroMun.message, 500, { requestId });
  const porCodigo = new Map((municipios ?? []).map((m) => [m.codigo_ibge as number, m]));
  if (codigos.some((c) => !porCodigo.has(c))) {
    return fail("validation_failed", t("Cidade fora da lista do IBGE (ou a lista ainda não foi carregada)."), 422, { requestId });
  }

  const chave = (m: { uf: string; nome_norm: string }) => `${m.uf}|${m.nome_norm}`;
  const adicionadas = adicionar.map((c) => porCodigo.get(c)!);
  const removidas = [
    ...remover.map((c) => porCodigo.get(c)!),
    ...removerNomes.map((n) => ({ uf: n.uf, nome_norm: n.cidade_norm })),
  ];

  if (adicionadas.length > 0) {
    const { error } = await admin.from("sfy_parceiro_cidades").upsert(
      adicionadas.map((m) => ({ organization_id: org, parceiro_id: id, cidade_norm: m.nome_norm, uf: m.uf })),
      { onConflict: "parceiro_id,cidade_norm,uf", ignoreDuplicates: true },
    );
    if (error) return fail("internal_error", error.message, 500, { requestId });
  }
  for (const m of removidas) {
    const { error } = await admin
      .from("sfy_parceiro_cidades")
      .delete()
      .eq("organization_id", org)
      .eq("parceiro_id", id)
      .eq("cidade_norm", m.nome_norm)
      .eq("uf", m.uf);
    if (error) return fail("internal_error", error.message, 500, { requestId });
  }

  // Impacto: quantos parceiros ELEGÍVEIS atendem cada cidade que mexemos, depois da troca.
  const mexidas = [...adicionadas, ...removidas];
  const elegiveisPorCidade = new Map<string, number>(mexidas.map((m) => [chave(m), 0]));
  const { data: atendimentos } = await admin
    .from("sfy_parceiro_cidades")
    .select("parceiro_id, cidade_norm, uf")
    .eq("organization_id", org)
    .in("cidade_norm", [...new Set(mexidas.map((m) => m.nome_norm))]);
  const { data: elegiveis } = await admin
    .from("sfy_parceiros")
    .select("id, whatsapp, email")
    .eq("organization_id", org)
    .eq("ativo", true)
    .eq("recebe_leads", true)
    .eq("categoria", "climabrisa");
  const idsElegiveis = new Set((elegiveis ?? []).filter((p) => (p.whatsapp ?? "").trim() || (p.email ?? "").trim()).map((p) => p.id));
  for (const a of atendimentos ?? []) {
    const k = `${a.uf}|${a.cidade_norm}`;
    if (elegiveisPorCidade.has(k) && idsElegiveis.has(a.parceiro_id)) elegiveisPorCidade.set(k, (elegiveisPorCidade.get(k) ?? 0) + 1);
  }
  const impacto = impactoDasCidades(adicionadas.map(chave), removidas.map(chave), elegiveisPorCidade);

  const { data: recalculo, error: erroRecalculo } = await admin.rpc("fn_sfy_recalcular_cidades_supervisor", { p_org: org });

  await audit({
    action: "sfy.distribuicao_cadastro_changed",
    actorUserId: authUser.id,
    organizationId: org,
    resourceType: "sfy_parceiros",
    resourceId: id,
    requestId,
    metadata: { tipo: "parceiro", campos: ["cidades"], adicionadas: adicionadas.length, removidas: removidas.length, ...impacto },
  });

  return ok(
    { adicionadas: adicionadas.length, removidas: removidas.length, ...impacto, recalculo: erroRecalculo ? { erro: "recalculo_falhou" } : (recalculo ?? {}) },
    { requestId },
  );
}
