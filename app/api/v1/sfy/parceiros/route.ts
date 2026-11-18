import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, Bloco C e etapa 7B) — cadastro de parceiros e supervisores.
 *
 *   GET  /api/v1/sfy/parceiros  → supervisores e parceiros da organização (gerente+)
 *   PUT  /api/v1/sfy/parceiros  → edita um parceiro (nome, situação, certificação, supervisor,
 *                                  contatos) ou um supervisor (contatos, ativo, padrão) (admin)
 *   POST /api/v1/sfy/parceiros  → cria um parceiro (admin)
 *
 * Desde a 7B o CRM é a FONTE DE VERDADE dos parceiros: a Mariana cria, renomeia, certifica,
 * pausa e dá saída por aqui. Na tela e na planilha há UMA situação por parceiro
 * (`lib/sfy/cadastro.ts`), que vira `ativo`/`certificado`/`recebe_leads` no banco. Toda mudança
 * que altera quem pode receber lead refaz o supervisor das cidades sem parceiro elegível
 * (`fn_sfy_recalcular_cidades_supervisor`). Quem escolhe o destino é o banco.
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
import { camposDaSituacao, codigoValido, dataValida, SITUACOES, type Situacao } from "@/lib/sfy/cadastro";
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

const situacaoSchema = z.enum(SITUACOES as [Situacao, ...Situacao[]]);
const dataOpcional = z.string().nullable().optional();

const base = {
  id: z.string().uuid(),
  whatsapp: contato,
  email: contato,
  ativo: z.boolean().optional(),
};

const edicaoSchema = z.discriminatedUnion("tipo", [
  z
    .object({
      tipo: z.literal("parceiro"),
      ...base,
      supervisor_id: z.string().uuid().nullable().optional(),
      nome: z.string().trim().min(1).max(120).optional(),
      situacao: situacaoSchema.optional(),
      certificado_em: dataOpcional,
    })
    .strict(),
  z.object({ tipo: z.literal("supervisor"), ...base, padrao: z.boolean().optional() }).strict(),
]);

const criacaoSchema = z
  .object({
    codigo: z.string().trim().min(1).max(20),
    nome: z.string().trim().min(1).max(120),
    whatsapp: contato,
    email: contato,
    supervisor_id: z.string().uuid().nullable().optional(),
    situacao: situacaoSchema.optional(),
  })
  .strict();

type Traduz = (texto: string) => string;

/** Valida WhatsApp e e-mail; devolve o que gravar (telefone normalizado) ou a mensagem de erro. */
function validarContatos(
  input: { whatsapp?: string | null; email?: string | null },
  t: Traduz,
): { erro: string } | { patch: Record<string, unknown> } {
  const patch: Record<string, unknown> = {};
  if (input.whatsapp !== undefined) {
    if (input.whatsapp !== null && !normalizePhoneBR(input.whatsapp)) return { erro: t("WhatsApp inválido. Use DDD + número.") };
    patch.whatsapp = input.whatsapp === null ? null : normalizePhoneBR(input.whatsapp);
  }
  if (input.email !== undefined) {
    if (input.email !== null && !EMAIL.test(input.email)) return { erro: t("E-mail inválido.") };
    patch.email = input.email;
  }
  return { patch };
}

/** Refaz o supervisor das cidades sem parceiro elegível. Falha aqui não derruba a edição. */
async function recalcular(admin: ReturnType<typeof createAdminClient>, org: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("fn_sfy_recalcular_cidades_supervisor", { p_org: org });
  if (error) return { erro: "recalculo_falhou" };
  return (data ?? {}) as Record<string, unknown>;
}

function erroDeValidacao(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return fail(err.code, err.message, err.status, {
      details: err.details as Record<string, unknown> | undefined,
      requestId,
    });
  }
  throw err;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const org = authz.org.orgId;
  const [sup, par, mun] = await Promise.all([
    supabase
      .from("sfy_supervisores")
      .select("id, nome, categoria, whatsapp, email, user_id, ufs, padrao, ativo")
      .eq("organization_id", org)
      .order("nome"),
    supabase
      .from("sfy_parceiros")
      .select(
        "id, codigo, nome, categoria, whatsapp, email, supervisor_id, ativo, certificado, certificado_em, recebe_leads, saiu_em, ultimo_recebimento_em",
      )
      .eq("organization_id", org)
      .order("nome")
      .limit(1000),
    // A tabela de municípios é só do servidor (sem política para o navegador).
    createAdminClient().from("sfy_municipios").select("codigo_ibge", { count: "exact", head: true }),
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
  return ok(
    { supervisores: sup.data ?? [], parceiros, municipios_carregados: (mun.count ?? 0) > 0 },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const t: Traduz = (texto) => traduzir(texto, authUser.idioma);

  let input;
  try {
    input = await validateRequest(edicaoSchema, req);
  } catch (err) {
    return erroDeValidacao(err, requestId);
  }

  const contatos = validarContatos(input, t);
  if ("erro" in contatos) return fail("validation_failed", contatos.erro, 422, { requestId });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), ...contatos.patch };

  const admin = createAdminClient();
  const org = activeOrg.orgId;
  const tabela = input.tipo === "parceiro" ? "sfy_parceiros" : "sfy_supervisores";
  const { data: anterior } = await admin
    .from(tabela)
    .select(input.tipo === "parceiro" ? "whatsapp, email, ativo, certificado, recebe_leads, saiu_em" : "whatsapp, email, ativo, categoria")
    .eq("organization_id", org)
    .eq("id", input.id)
    .maybeSingle();
  if (!anterior) return fail("not_found", t("Cadastro não encontrado."), 404, { requestId });
  const antes = anterior as unknown as Record<string, unknown>;

  if (input.tipo === "parceiro") {
    if (input.nome !== undefined) patch.nome = input.nome;
    if (input.supervisor_id !== undefined) {
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
    if (input.certificado_em !== undefined) {
      if (input.certificado_em !== null && !dataValida(input.certificado_em)) {
        return fail("validation_failed", t("Data inválida. Use AAAA-MM-DD."), 422, { requestId });
      }
      patch.certificado_em = input.certificado_em;
    }
    const hoje = new Date().toISOString().slice(0, 10);
    if (input.situacao !== undefined) {
      // A situação manda; o "ativo" solto é ignorado quando as duas vêm juntas.
      Object.assign(patch, camposDaSituacao(input.situacao, hoje, (antes.saiu_em as string | null) ?? null));
    } else if (input.ativo !== undefined) {
      // Compatibilidade com o "ativo" antigo: sair tira do rodízio (a restrição do banco exige).
      patch.ativo = input.ativo;
      if (!input.ativo) {
        patch.recebe_leads = false;
        patch.saiu_em = (antes.saiu_em as string | null) ?? hoje;
      } else {
        patch.saiu_em = null;
      }
    }
  } else {
    if (input.ativo !== undefined) patch.ativo = input.ativo;
    if (input.padrao !== undefined) {
      if (antes.categoria !== "climabrisa") {
        return fail("validation_failed", t("O padrão só vale para os supervisores da Climabrisa."), 422, { requestId });
      }
      patch.padrao = input.padrao;
    }
  }

  // Um único padrão da Climabrisa: ligar um desliga os outros (antes de gravar este).
  if (input.tipo === "supervisor" && input.padrao === true) {
    await admin
      .from("sfy_supervisores")
      .update({ padrao: false, updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("categoria", "climabrisa")
      .neq("id", input.id);
  }

  const { error } = await admin.from(tabela).update(patch).eq("organization_id", org).eq("id", input.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  // Mexeu em quem pode receber lead (ou em quem supervisiona)? O supervisor das cidades se refaz.
  const mexeNoDestino = ["ativo", "recebe_leads", "certificado", "supervisor_id", "whatsapp", "email"].some((k) => k in patch);
  const recalculo = mexeNoDestino ? await recalcular(admin, org) : null;

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
      ativo: { antes: (antes.ativo as boolean | undefined) ?? null, depois: (patch.ativo as boolean | undefined) ?? null },
      ...(input.tipo === "parceiro" && input.situacao ? { situacao: input.situacao } : {}),
    },
  });

  return ok({ id: input.id, recalculo }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;
  const t: Traduz = (texto) => traduzir(texto, authUser.idioma);

  let input;
  try {
    input = await validateRequest(criacaoSchema, req);
  } catch (err) {
    return erroDeValidacao(err, requestId);
  }
  if (!codigoValido(input.codigo)) {
    return fail("validation_failed", t("Código inválido. Use até 20 letras, números, ponto, hífen ou sublinhado."), 422, { requestId });
  }
  const contatos = validarContatos(input, t);
  if ("erro" in contatos) return fail("validation_failed", contatos.erro, 422, { requestId });

  const admin = createAdminClient();
  const org = activeOrg.orgId;
  if (input.supervisor_id) {
    const { data: s } = await admin
      .from("sfy_supervisores")
      .select("id")
      .eq("organization_id", org)
      .eq("id", input.supervisor_id)
      .eq("categoria", "climabrisa")
      .maybeSingle();
    if (!s) return fail("not_found", t("Supervisor não encontrado."), 404, { requestId });
  }

  const campos = camposDaSituacao(input.situacao ?? "nao_certificado", new Date().toISOString().slice(0, 10), null);
  const { data: criado, error } = await admin
    .from("sfy_parceiros")
    .insert({
      organization_id: org,
      codigo: input.codigo,
      nome: input.nome,
      categoria: "climabrisa",
      supervisor_id: input.supervisor_id ?? null,
      ...contatos.patch,
      ...campos,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return fail("conflict", t("Já existe um parceiro com este código."), 409, { requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "sfy.distribuicao_cadastro_changed",
    actorUserId: authUser.id,
    organizationId: org,
    resourceType: "sfy_parceiros",
    resourceId: criado.id,
    requestId,
    metadata: { tipo: "parceiro", criado: true, situacao: input.situacao ?? "nao_certificado" },
  });

  return ok({ id: criado.id }, { requestId, status: 201 });
}
