/**
 * sfy (fork Sales for You, etapa 7B) — a lista do campo "Parceiro responsável" acompanha o cadastro.
 *
 * O campo do negócio é uma lista de opções (`pipelines.settings.fields[].options`): o VALOR gravado no
 * negócio é o CÓDIGO do parceiro e o rótulo é só o que a tela mostra ("código - nome"). Por isso:
 *   - renomear um parceiro troca só o rótulo (o valor, e portanto os negócios antigos, não mudam);
 *   - parceiro novo ganha uma opção nova;
 *   - quem sai continua na lista com "(saiu)", porque negócios antigos ainda apontam para ele.
 * A distribuição e os relatórios acham a opção pelo código; opção que não existe é pulada.
 *
 * Aqui só a conta pura sobre o JSON do funil (preserva tudo o que não é a lista de opções) e a
 * gravação, que lê e regrava só os funis que têm o campo e só quando algo mudou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const ROTULO_DO_CAMPO = "Parceiro responsável";
const TIPOS_DE_LISTA = new Set(["select", "searchable_select", "multiselect"]);
const MAXIMO_DE_APELIDOS = 20;

export interface ParceiroParaOpcao {
  codigo: string;
  nome: string;
  ativo: boolean;
  apelidos?: string[];
}

interface OpcaoBruta {
  value: string;
  label: string;
  aliases?: string[];
  [outra: string]: unknown;
}

export interface ResultadoDaSincronia {
  settings: Record<string, unknown>;
  criadas: number;
  renomeadas: number;
}

function normaliza(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function rotuloDaOpcao(p: Pick<ParceiroParaOpcao, "codigo" | "nome" | "ativo">): string {
  const base = `${p.codigo} - ${p.nome.trim()}`;
  const rotulo = p.ativo ? base : `${base} (saiu)`;
  return rotulo.slice(0, 200);
}

/** Apelidos que cabem na opção: sem repetir o valor nem o rótulo, no máximo 20, cada um de 1 a 80 letras. */
function apelidosDaOpcao(p: ParceiroParaOpcao, rotulo: string, existentes: string[]): string[] {
  const vistos = new Set([normaliza(p.codigo), normaliza(rotulo)]);
  const saida: string[] = [];
  for (const a of [...existentes, ...(p.apelidos ?? [])]) {
    const limpo = a.trim().slice(0, 80);
    const n = normaliza(limpo);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    saida.push(limpo);
    if (saida.length >= MAXIMO_DE_APELIDOS) break;
  }
  return saida;
}

function acharOpcao(opcoes: OpcaoBruta[], codigo: string): number {
  const porValor = opcoes.findIndex((o) => o.value === codigo);
  if (porValor >= 0) return porValor;
  const re = new RegExp(`^\\s*${codigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–]`);
  return opcoes.findIndex((o) => re.test(o.label));
}

/**
 * Aplica os parceiros às opções de UM campo. Devolve a lista nova e quantas opções nasceram ou
 * mudaram de rótulo/apelido. Nunca remove opção e nunca troca o `value` de uma que já existe.
 */
export function aplicarParceirosNasOpcoes(
  opcoes: OpcaoBruta[],
  parceiros: ParceiroParaOpcao[],
): { opcoes: OpcaoBruta[]; criadas: number; renomeadas: number } {
  const lista = opcoes.map((o) => ({ ...o }));
  let criadas = 0;
  let renomeadas = 0;
  for (const p of parceiros) {
    const rotulo = rotuloDaOpcao(p);
    const i = acharOpcao(lista, p.codigo);
    if (i < 0) {
      const apelidos = apelidosDaOpcao(p, rotulo, []);
      lista.push({ value: p.codigo, label: rotulo, ...(apelidos.length ? { aliases: apelidos } : {}) });
      criadas += 1;
      continue;
    }
    const atual = lista[i]!;
    const apelidos = apelidosDaOpcao(p, rotulo, atual.aliases ?? []);
    const mesmosApelidos = JSON.stringify(apelidos) === JSON.stringify(atual.aliases ?? []);
    if (atual.label === rotulo && mesmosApelidos) continue;
    atual.label = rotulo;
    if (apelidos.length) atual.aliases = apelidos;
    else delete atual.aliases;
    renomeadas += 1;
  }
  return { opcoes: lista, criadas, renomeadas };
}

/**
 * Aplica os parceiros ao `settings` de um funil: acha o campo "Parceiro responsável" (lista) e mexe
 * só nas opções dele. `null` quando o funil não tem o campo ou nada precisou mudar.
 */
export function aplicarParceirosNoSettings(
  settings: Record<string, unknown> | null | undefined,
  parceiros: ParceiroParaOpcao[],
): ResultadoDaSincronia | null {
  if (!settings || !Array.isArray(settings.fields)) return null;
  const alvo = normaliza(ROTULO_DO_CAMPO);
  let criadas = 0;
  let renomeadas = 0;
  const fields = (settings.fields as unknown[]).map((f) => {
    if (!f || typeof f !== "object") return f;
    const campo = f as Record<string, unknown>;
    if (typeof campo.label !== "string" || normaliza(campo.label) !== alvo) return f;
    if (typeof campo.type !== "string" || !TIPOS_DE_LISTA.has(campo.type)) return f;
    const atuais = Array.isArray(campo.options) ? (campo.options as OpcaoBruta[]) : [];
    const r = aplicarParceirosNasOpcoes(atuais, parceiros);
    if (r.criadas === 0 && r.renomeadas === 0) return f;
    criadas += r.criadas;
    renomeadas += r.renomeadas;
    return { ...campo, options: r.opcoes };
  });
  if (criadas === 0 && renomeadas === 0) return null;
  return { settings: { ...settings, fields }, criadas, renomeadas };
}

export interface RelatorioDaSincronia {
  funis_atualizados: number;
  opcoes_criadas: number;
  opcoes_renomeadas: number;
}

/**
 * Grava a sincronia em todos os funis da organização que têm o campo. Lê os apelidos do cadastro.
 * `codigos` limita a quem mexeu (omitido = todos os parceiros, para conserto e carga inicial).
 */
export async function sincronizarOpcoesDosParceiros(
  admin: SupabaseClient,
  organizationId: string,
  codigos?: string[],
): Promise<RelatorioDaSincronia> {
  let consulta = admin
    .from("sfy_parceiros")
    .select("id, codigo, nome, ativo")
    .eq("organization_id", organizationId)
    .limit(5000);
  if (codigos && codigos.length > 0) consulta = consulta.in("codigo", codigos);
  const { data: parceiros, error } = await consulta;
  if (error) throw new Error(`sfy_opcoes_parceiros: ${error.message}`);
  if (!parceiros || parceiros.length === 0) return { funis_atualizados: 0, opcoes_criadas: 0, opcoes_renomeadas: 0 };

  const apelidosPorParceiro = new Map<string, string[]>();
  const { data: apelidos } = await admin
    .from("sfy_parceiro_apelidos")
    .select("parceiro_id, apelido")
    .eq("organization_id", organizationId)
    .in("parceiro_id", parceiros.map((p) => p.id as string))
    .limit(20000);
  for (const a of apelidos ?? []) {
    const id = a.parceiro_id as string;
    apelidosPorParceiro.set(id, [...(apelidosPorParceiro.get(id) ?? []), a.apelido as string]);
  }
  const lista: ParceiroParaOpcao[] = parceiros.map((p) => ({
    codigo: p.codigo as string,
    nome: p.nome as string,
    ativo: p.ativo as boolean,
    apelidos: apelidosPorParceiro.get(p.id as string) ?? [],
  }));

  const { data: funis, error: erroFunis } = await admin
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", organizationId);
  if (erroFunis) throw new Error(`sfy_opcoes_funis: ${erroFunis.message}`);

  const relatorio: RelatorioDaSincronia = { funis_atualizados: 0, opcoes_criadas: 0, opcoes_renomeadas: 0 };
  for (const funil of funis ?? []) {
    const r = aplicarParceirosNoSettings(funil.settings as Record<string, unknown> | null, lista);
    if (!r) continue;
    const { error: erroGravar } = await admin
      .from("crm_pipelines")
      .update({ settings: r.settings })
      .eq("organization_id", organizationId)
      .eq("id", funil.id as string);
    if (erroGravar) throw new Error(`sfy_opcoes_gravar: ${erroGravar.message}`);
    relatorio.funis_atualizados += 1;
    relatorio.opcoes_criadas += r.criadas;
    relatorio.opcoes_renomeadas += r.renomeadas;
  }
  return relatorio;
}
