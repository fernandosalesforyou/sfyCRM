import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * sfy (fork Sales for You, Bloco C e etapa 7B) — cadastro de parceiros e supervisores.
 *
 *   GET  /api/v1/sfy/parceiros  → supervisores e parceiros da organização (gerente+)
 *   PUT  /api/v1/sfy/parceiros  → edita um parceiro (nome, situação, certificação, supervisor,
 *                                  contatos) ou um supervisor (nome, contatos, estados, padrão,
 *                                  desativar passando para um substituto) (admin)
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
import { sincronizarOpcoesDosParceiros } from "@/lib/sfy/opcoes-parceiro";
import { donoDoNome, nomesAnterioresApos, UFS_DO_BRASIL, ufsEmUso, type SupervisorCadastrado } from "@/lib/sfy/supervisores";
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
  z
    .object({
      tipo: z.literal("supervisor"),
      ...base,
      padrao: z.boolean().optional(),
      nome: z.string().trim().min(1).max(120).optional(),
      /** Só do Agro: os estados atendidos. */
      ufs: z.array(z.enum(UFS_DO_BRASIL)).max(27).optional(),
      /** Ao desativar: quem assume os parceiros, as cidades e os estados. */
      substituto_id: z.string().uuid().nullable().optional(),
    })
    .strict(),
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

/** Mantém a lista do campo "Parceiro responsável" igual ao cadastro. Falha aqui não derruba a edição. */
async function sincronizarOpcoes(
  admin: ReturnType<typeof createAdminClient>,
  org: string,
  codigo: string,
): Promise<Record<string, unknown>> {
  try {
    return { ...(await sincronizarOpcoesDosParceiros(admin, org, [codigo])) };
  } catch {
    return { erro: "opcoes_falhou" };
  }
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
      .select("id, nome, categoria, whatsapp, email, user_id, ufs, padrao, ativo, nomes_anteriores")
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
    .select(
      input.tipo === "parceiro"
        ? "codigo, whatsapp, email, ativo, certificado, recebe_leads, saiu_em"
        : "id, nome, whatsapp, email, ativo, categoria, ufs, nomes_anteriores",
    )
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
    const atual = anterior as unknown as SupervisorCadastrado;
    const mudaCadastro = input.nome !== undefined || input.ufs !== undefined || input.ativo === true;
    let lista: SupervisorCadastrado[] = [];
    if (mudaCadastro) {
      const { data: todos, error: erroLista } = await admin
        .from("sfy_supervisores")
        .select("id, nome, categoria, ufs, ativo, nomes_anteriores")
        .eq("organization_id", org);
      if (erroLista) return fail("internal_error", erroLista.message, 500, { requestId });
      lista = (todos ?? []) as SupervisorCadastrado[];
    }
    if (input.nome !== undefined && input.nome !== atual.nome) {
      const repetido = donoDoNome(lista, input.nome, input.id);
      if (repetido) {
        return fail("conflict", `${t("Já existe um supervisor com este nome:")} ${repetido.nome}`, 409, { requestId });
      }
      patch.nome = input.nome;
      patch.nomes_anteriores = nomesAnterioresApos(atual, input.nome);
    }
    if (input.ufs !== undefined && atual.categoria !== "agro") {
      return fail("validation_failed", t("Estados só valem para os supervisores do Agro."), 422, { requestId });
    }
    // Estado com um só responsável: vale ao trocar a lista e ao reativar com a lista antiga.
    if (atual.categoria === "agro" && (input.ufs !== undefined || input.ativo === true)) {
      const ocupadas = ufsEmUso(lista, input.ufs ?? atual.ufs ?? [], input.id);
      if (ocupadas.length > 0) {
        return fail(
          "conflict",
          `${t("Estado já atendido por outro supervisor:")} ${ocupadas.map((o) => `${o.uf} (${o.nome})`).join(", ")}`,
          409,
          { requestId },
        );
      }
      if (input.ufs !== undefined) patch.ufs = [...new Set(input.ufs)].sort();
    }
    if (input.ativo === true) patch.ativo = true;
    if (input.padrao !== undefined) {
      if (input.padrao && atual.ativo === false && input.ativo !== true) {
        return fail("validation_failed", t("Um supervisor desativado não pode ser o padrão."), 422, { requestId });
      }
      patch.padrao = input.padrao;
    }
    // Desativar é uma operação só no banco (ninguém fica sem supervisor no meio do caminho).
    if (input.ativo === false) {
      const { data: r, error: erroDesativar } = await admin.rpc("fn_sfy_desativar_supervisor", {
        p_org: org,
        p_supervisor: input.id,
        p_substituto: input.substituto_id ?? null,
      });
      if (erroDesativar) return fail("internal_error", erroDesativar.message, 500, { requestId });
      const recusa = (r as { erro?: string } | null)?.erro;
      if (recusa === "tem_parceiros") {
        return fail("conflict", t("Escolha quem assume os parceiros antes de desativar."), 409, { requestId });
      }
      if (recusa === "tem_estados") {
        return fail("conflict", t("Escolha quem assume os estados antes de desativar."), 409, { requestId });
      }
      if (recusa) return fail("validation_failed", t("Substituto inválido. Escolha um supervisor ativo da mesma linha."), 422, { requestId });
      delete patch.padrao;
    }
  }

  // Um único padrão por linha: ligar um desliga os outros da mesma categoria (antes de gravar este).
  if (input.tipo === "supervisor" && patch.padrao === true) {
    await admin
      .from("sfy_supervisores")
      .update({ padrao: false, updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("categoria", antes.categoria as string)
      .neq("id", input.id);
  }

  const { error } = await admin.from(tabela).update(patch).eq("organization_id", org).eq("id", input.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  // Mexeu em quem pode receber lead (ou em quem supervisiona)? O supervisor das cidades se refaz.
  const mexeNoDestino =
    (input.tipo === "supervisor" && input.ativo === false) ||
    ["ativo", "recebe_leads", "certificado", "supervisor_id", "whatsapp", "email"].some((k) => k in patch);
  const recalculo = mexeNoDestino ? await recalcular(admin, org) : null;
  // Renomear ou dar saída muda o rótulo da opção que os negócios usam (o valor, o código, não muda).
  const opcoes =
    input.tipo === "parceiro" && ("nome" in patch || "ativo" in patch)
      ? await sincronizarOpcoes(admin, org, antes.codigo as string)
      : null;

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
      ativo: { antes: (antes.ativo as boolean | undefined) ?? null, depois: (patch.ativo as boolean | undefined) ?? input.ativo ?? null },
      ...(input.tipo === "supervisor" && input.ativo === false ? { substituto_id: input.substituto_id ?? null } : {}),
      ...(input.tipo === "parceiro" && input.situacao ? { situacao: input.situacao } : {}),
    },
  });

  return ok({ id: input.id, recalculo, opcoes }, { requestId });
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

  const opcoes = await sincronizarOpcoes(admin, org, input.codigo);
  return ok({ id: criado.id, opcoes }, { requestId, status: 201 });
}
