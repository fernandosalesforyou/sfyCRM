/**
 * sfy (fork Sales for You, Bloco D, D4) — link de fechamento do parceiro.
 *
 * O parceiro não tem login. Recebe um link com token aleatório (32 bytes, base64url) que mostra
 * os negócios ABERTOS dele e deixa informar valor e nota. O banco guarda só o SHA-256 do token.
 * A informação vira um PEDIDO (`sfy_fechamentos_sinalizados`) que o administrador trata: nunca
 * muda o negócio para Ganho (valor do ganho e DANFE seguem as regras do Bloco A).
 *
 * Privacidade: a página mostra só nome curto, cidade e data de entrada — nunca telefone nem
 * e-mail. O link expira (8 dias; cada relatório semanal gera um novo e revoga o anterior) e só
 * enxerga os negócios do próprio parceiro; o servidor confere isso de novo ao receber o pedido.
 */
import { createHash, randomBytes } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";
import { rotuloDoContato, SEM_NOME } from "@/lib/contacts/rotulo-do-contato";
import { normalizaTexto } from "@/lib/sfy/distribuicao";
import { chavesDoCampo, rotulosDasOpcoes } from "@/lib/sfy/relatorios";

type Admin = ReturnType<typeof createAdminClient>;

export const VALIDADE_DO_LINK_DIAS = 8;
export const TETO_DE_NEGOCIOS_NA_PAGINA = 100;
const VALOR_MAXIMO_CENTAVOS = 99_999_999_999;

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token com a forma certa? (43 caracteres base64url). Barra lixo antes de ir ao banco. */
export function tokenComFormaValida(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * "1.234,56" | "1234,56" | "1234.56" | "1234" → centavos. Vazio, zero, negativo, mais de duas
 * casas ou acima do teto → `null` (nunca adivinha).
 */
export function valorEmCentavos(texto: string): number | null {
  const t = texto.replace(/\s|R\$/gi, "");
  if (t === "") return null;
  let normal: string;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(t)) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(t)) normal = t.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(t)) normal = t;
  else return null;
  const centavos = Math.round(Number(normal) * 100);
  return Number.isFinite(centavos) && centavos > 0 && centavos <= VALOR_MAXIMO_CENTAVOS ? centavos : null;
}

/** O nome do contato pela régua única do produto; sem nome apresentável, o título do negócio. */
function rotuloEscolhido(contato: { name?: string | null; display_name?: string | null } | null | undefined, titulo: string | null): string {
  const r = rotuloDoContato(contato ?? {});
  return r === SEM_NOME ? (titulo ?? "") : r;
}

/** Data curta DD/MM/AAAA no fuso de Brasília, sem fixar um idioma de tela (a página é pública). */
export function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** "Maria da Silva" → "Maria S."; um nome só fica como está. Nunca devolve telefone nem e-mail. */
export function nomeCurto(nome: string | null | undefined): string {
  // Só partes com letra: telefone, traço e símbolo soltos não são nome.
  const partes = (nome ?? "")
    .split(/\s+/)
    .filter((p) => !p.includes("@") && !/\d/.test(p) && /\p{L}/u.test(p));
  if (partes.length === 0) return "Cliente";
  if (partes.length === 1) return partes[0]!;
  return `${partes[0]} ${partes[partes.length - 1]!.charAt(0).toUpperCase()}.`;
}

export interface ParceiroDoLink {
  id: string;
  organization_id: string;
  codigo: string;
  nome: string;
}

export interface NegocioDaPagina {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  recebido_em: string;
  ja_informado: boolean;
}

/** Cria um link novo (8 dias) e revoga os ativos do parceiro. Devolve o token em claro UMA vez. */
export async function criarLinkDeFechamento(
  admin: Admin,
  organizationId: string,
  parceiroId: string,
  agora = new Date(),
  opcoes: { revogarAnteriores?: boolean } = {},
): Promise<string> {
  const token = gerarToken();
  if (opcoes.revogarAnteriores ?? true) {
    await admin
      .from("sfy_links_fechamento")
      .update({ revogado_em: agora.toISOString() })
      .eq("organization_id", organizationId)
      .eq("parceiro_id", parceiroId)
      .is("revogado_em", null);
  }
  const { error } = await admin.from("sfy_links_fechamento").insert({
    organization_id: organizationId,
    parceiro_id: parceiroId,
    token_hash: hashDoToken(token),
    expira_em: new Date(agora.getTime() + VALIDADE_DO_LINK_DIAS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`link_de_fechamento_nao_criado:${error.message}`);
  return token;
}

/** O link e o parceiro dele, se o token é válido, não expirou nem foi revogado e o parceiro está ativo. */
export async function acharLinkValido(
  admin: Admin,
  token: string,
  agora = new Date(),
): Promise<{ link_id: string; parceiro: ParceiroDoLink } | null> {
  if (!tokenComFormaValida(token)) return null;
  const { data: link } = await admin
    .from("sfy_links_fechamento")
    .select("id, organization_id, parceiro_id, expira_em, revogado_em")
    .eq("token_hash", hashDoToken(token))
    .maybeSingle();
  if (!link || link.revogado_em || Date.parse(link.expira_em as string) <= agora.getTime()) return null;
  const { data: p } = await admin
    .from("sfy_parceiros")
    .select("id, organization_id, codigo, nome, ativo")
    .eq("organization_id", link.organization_id as string)
    .eq("id", link.parceiro_id as string)
    .maybeSingle();
  if (!p || !p.ativo) return null;
  // Interruptor da organização: sem `settings.sfy.link_de_fechamento = true` o link não abre.
  const { data: org } = await admin.from("organizations").select("settings").eq("id", link.organization_id as string).maybeSingle();
  if ((org?.settings as { sfy?: { link_de_fechamento?: unknown } } | null)?.sfy?.link_de_fechamento !== true) return null;
  await admin.from("sfy_links_fechamento").update({ ultimo_uso_em: agora.toISOString() }).eq("id", link.id as string);
  return { link_id: link.id as string, parceiro: { id: p.id as string, organization_id: p.organization_id as string, codigo: p.codigo as string, nome: p.nome as string } };
}

const CODIGO_DO_ROTULO = /^\s*(\S+?)\s*[-–]/;

/** Os valores do campo "Parceiro responsável" que apontam para este parceiro (valor da opção = código, ou rótulo "código - nome"). */
export function valoresDoParceiro(
  opcoes: Map<string, string>,
  parceiro: Pick<ParceiroDoLink, "codigo" | "nome">,
): string[] {
  const valores = new Set<string>([parceiro.codigo]);
  for (const [valor, rotulo] of opcoes) {
    const codigo = CODIGO_DO_ROTULO.exec(rotulo)?.[1];
    if (valor === parceiro.codigo || codigo === parceiro.codigo || normalizaTexto(rotulo) === normalizaTexto(parceiro.nome)) valores.add(valor);
  }
  return [...valores];
}

/** Negócios ABERTOS do parceiro (e quais já têm pedido pendente). */
export async function negociosDoParceiro(admin: Admin, parceiro: ParceiroDoLink): Promise<NegocioDaPagina[]> {
  const org = parceiro.organization_id;
  const { data: funis } = await admin.from("crm_pipelines").select("settings").eq("organization_id", org);
  const chaves = chavesDoCampo(funis ?? [], "Parceiro responsável", normalizaTexto);
  if (chaves.length === 0) return [];
  const valores = valoresDoParceiro(rotulosDasOpcoes(funis ?? [], "Parceiro responsável", normalizaTexto), parceiro);

  const achados = new Map<string, { id: string; title: string | null; created_at: string; custom_fields: Record<string, unknown> | null; contacts: unknown }>();
  for (const chave of chaves) {
    const { data } = await admin
      .from("crm_leads")
      .select("id, title, created_at, custom_fields, contacts(name, display_name)")
      .eq("organization_id", org)
      .eq("status", "open")
      .in(`custom_fields->>${chave}`, valores)
      .order("created_at", { ascending: false })
      .limit(TETO_DE_NEGOCIOS_NA_PAGINA);
    for (const l of data ?? []) achados.set(l.id as string, l as never);
  }
  const ids = [...achados.keys()];
  const { data: pendentes } = ids.length
    ? await admin.from("sfy_fechamentos_sinalizados").select("lead_id").eq("organization_id", org).eq("parceiro_id", parceiro.id).eq("status", "pendente").in("lead_id", ids)
    : { data: [] as Array<{ lead_id: string }> };
  const jaInformados = new Set((pendentes ?? []).map((p) => p.lead_id as string));

  return [...achados.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, TETO_DE_NEGOCIOS_NA_PAGINA)
    .map((l) => {
      const c = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as { name?: string | null; display_name?: string | null } | null | undefined;
      const cf = l.custom_fields ?? {};
      return {
        id: l.id,
        nome: nomeCurto(rotuloEscolhido(c, l.title)),
        cidade: typeof cf.cidade === "string" ? cf.cidade : "",
        uf: typeof cf.uf === "string" ? cf.uf : "",
        recebido_em: l.created_at,
        ja_informado: jaInformados.has(l.id),
      };
    });
}

export type ResultadoDoPedido =
  | { ok: true }
  | { ok: false; motivo: "valor_invalido" | "negocio_nao_e_seu" | "ja_informado" | "nota_invalida" | "erro" };

/** Registra o pedido. O negócio TEM de estar na lista aberta do próprio parceiro (conferido aqui, não só na tela). */
export async function registrarFechamento(
  admin: Admin,
  alvo: { link_id: string; parceiro: ParceiroDoLink },
  entrada: { lead_id: string; valor: string; nota_fiscal: string; observacao?: string },
): Promise<ResultadoDoPedido> {
  const centavos = valorEmCentavos(entrada.valor);
  if (centavos === null) return { ok: false, motivo: "valor_invalido" };
  const nota = entrada.nota_fiscal.replace(/[\r\n]+/g, " ").trim();
  if (nota.length === 0 || nota.length > 60) return { ok: false, motivo: "nota_invalida" };
  const obs = (entrada.observacao ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);

  const meus = await negociosDoParceiro(admin, alvo.parceiro);
  const negocio = meus.find((n) => n.id === entrada.lead_id);
  if (!negocio) return { ok: false, motivo: "negocio_nao_e_seu" };
  if (negocio.ja_informado) return { ok: false, motivo: "ja_informado" };

  const { error } = await admin.from("sfy_fechamentos_sinalizados").insert({
    organization_id: alvo.parceiro.organization_id,
    lead_id: entrada.lead_id,
    parceiro_id: alvo.parceiro.id,
    link_id: alvo.link_id,
    valor_centavos: centavos,
    nota_fiscal: nota,
    observacao: obs,
  });
  if (error) return { ok: false, motivo: error.code === "23505" ? "ja_informado" : "erro" };
  return { ok: true };
}
