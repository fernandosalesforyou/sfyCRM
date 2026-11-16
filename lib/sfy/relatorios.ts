/**
 * sfy (fork Sales for You, Bloco D) — as contas dos relatórios, sem banco.
 *
 * O banco (migration 5006) conta; aqui se junta, ordena e dá nome. Regras que a tela não fura:
 * - % de fechamento = ganhos ÷ (ganhos + perdidos); sem negócio encerrado é `null` ("—"), nunca 0.
 * - Valor fechado POR MOEDA; nunca um total que some reais com dólares.
 * - O total é a soma das linhas, nunca um número à parte.
 * - Negócio sem parceiro/supervisor/categoria/origem aparece numa linha própria ("" na conta,
 *   rótulo dado pela tela), nunca some.
 */
import { camposDoFunil } from "@/lib/leads/campos-do-funil";

export interface LinhaDestinoBruta {
  grupo: string;
  moeda: string;
  leads: number;
  abertos: number;
  ganhos: number;
  perdidos: number;
  valor_ganho_centavos: number;
  mediana_dias_ate_ganho: number | null;
}

export interface LinhaDestino {
  grupo: string;
  /** Nome para mostrar (o rótulo da opção do campo); ausente = mostrar o próprio `grupo`. */
  rotulo?: string;
  leads: number;
  abertos: number;
  ganhos: number;
  perdidos: number;
  /** `null` quando nada foi encerrado. */
  percentual_fechamento: number | null;
  /** Centavos por moeda ("" = sem moeda). */
  valor_ganho_por_moeda: Record<string, number>;
  /** Mediana entre as moedas não existe: pega a do grupo com mais ganhos. `null` = não medido. */
  mediana_dias_ate_ganho: number | null;
}

export function percentualDeFechamento(ganhos: number, perdidos: number): number | null {
  const encerrados = ganhos + perdidos;
  return encerrados > 0 ? ganhos / encerrados : null;
}

/** Junta as linhas (uma por grupo e moeda) em uma por grupo. Ordem: mais leads primeiro. */
export function juntarPorGrupo(brutas: LinhaDestinoBruta[]): LinhaDestino[] {
  const mapa = new Map<string, LinhaDestino & { _ganhosDaMediana: number }>();
  for (const b of brutas) {
    let l = mapa.get(b.grupo);
    if (!l) {
      l = {
        grupo: b.grupo, leads: 0, abertos: 0, ganhos: 0, perdidos: 0,
        percentual_fechamento: null, valor_ganho_por_moeda: {}, mediana_dias_ate_ganho: null,
        _ganhosDaMediana: 0,
      };
      mapa.set(b.grupo, l);
    }
    l.leads += Number(b.leads);
    l.abertos += Number(b.abertos);
    l.ganhos += Number(b.ganhos);
    l.perdidos += Number(b.perdidos);
    if (Number(b.valor_ganho_centavos) !== 0) {
      l.valor_ganho_por_moeda[b.moeda] = (l.valor_ganho_por_moeda[b.moeda] ?? 0) + Number(b.valor_ganho_centavos);
    }
    if (b.mediana_dias_ate_ganho !== null && Number(b.ganhos) > l._ganhosDaMediana) {
      l.mediana_dias_ate_ganho = Number(b.mediana_dias_ate_ganho);
      l._ganhosDaMediana = Number(b.ganhos);
    }
  }
  return [...mapa.values()]
    .map(({ _ganhosDaMediana: _omitido, ...l }) => ({
      ...l,
      percentual_fechamento: percentualDeFechamento(l.ganhos, l.perdidos),
    }))
    .sort((a, b) => b.leads - a.leads || a.grupo.localeCompare(b.grupo, "pt-BR"));
}

export function somarLinhas(linhas: LinhaDestino[]): Omit<LinhaDestino, "grupo" | "mediana_dias_ate_ganho"> {
  const t = { leads: 0, abertos: 0, ganhos: 0, perdidos: 0, percentual_fechamento: null as number | null, valor_ganho_por_moeda: {} as Record<string, number> };
  for (const l of linhas) {
    t.leads += l.leads; t.abertos += l.abertos; t.ganhos += l.ganhos; t.perdidos += l.perdidos;
    for (const [m, v] of Object.entries(l.valor_ganho_por_moeda)) t.valor_ganho_por_moeda[m] = (t.valor_ganho_por_moeda[m] ?? 0) + v;
  }
  t.percentual_fechamento = percentualDeFechamento(t.ganhos, t.perdidos);
  return t;
}

/** As chaves distintas que um rótulo de campo tem nos funis (a chave pode variar de funil para funil). */
export function chavesDoCampo(funis: Array<{ settings: unknown }>, rotulo: string, normaliza: (t: string) => string): string[] {
  const alvo = normaliza(rotulo);
  const chaves = new Set<string>();
  for (const f of funis) {
    for (const c of camposDoFunil((f.settings ?? null) as Record<string, unknown> | null)) {
      if (normaliza(c.label) === alvo) chaves.add(c.key);
    }
  }
  return [...chaves];
}

export interface LinhaPeriodoBruta {
  balde: string;
  categoria: string;
  origem: string;
  leads: number;
}

export interface SeriePorPeriodo {
  baldes: string[];
  categorias: string[];
  /** `matriz[balde][categoria]`. Balde e categoria sem lead valem 0, nunca somem. */
  matriz: Record<string, Record<string, number>>;
  total: number;
}

/** Junta (balde, categoria) somando as origens e preenche o que não teve lead com 0. */
export function montarSerie(brutas: LinhaPeriodoBruta[], baldesDaJanela: string[]): SeriePorPeriodo {
  const categorias = [...new Set(brutas.map((b) => b.categoria))].sort();
  const matriz: Record<string, Record<string, number>> = {};
  for (const balde of baldesDaJanela) {
    matriz[balde] = Object.fromEntries(categorias.map((c) => [c, 0]));
  }
  let total = 0;
  for (const b of brutas) {
    const linha = matriz[b.balde] ?? (matriz[b.balde] = Object.fromEntries(categorias.map((c) => [c, 0])));
    linha[b.categoria] = (linha[b.categoria] ?? 0) + Number(b.leads);
    total += Number(b.leads);
  }
  return { baldes: Object.keys(matriz).sort(), categorias, matriz, total };
}

/** Segundas-feiras/dias/meses (AAAA-MM-DD) entre duas datas de parede, na ordem do tempo. */
export function baldesDaJanela(deISO: string, ateISO: string, granularidade: "dia" | "semana" | "mes"): string[] {
  const ini = new Date(`${deISO}T00:00:00Z`);
  const fim = new Date(`${ateISO}T00:00:00Z`);
  const saida: string[] = [];
  const cursor = new Date(ini);
  if (granularidade === "mes") cursor.setUTCDate(1);
  if (granularidade === "semana") cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  while (cursor < fim && saida.length < 800) {
    saida.push(cursor.toISOString().slice(0, 10));
    if (granularidade === "dia") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularidade === "semana") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return saida;
}

/** Valor da opção → rótulo ("27108" → "27108 - Nome do parceiro"), pelos campos de todos os funis. */
export function rotulosDasOpcoes(funis: Array<{ settings: unknown }>, rotulo: string, normaliza: (t: string) => string): Map<string, string> {
  const alvo = normaliza(rotulo);
  const mapa = new Map<string, string>();
  for (const f of funis) {
    for (const c of camposDoFunil((f.settings ?? null) as Record<string, unknown> | null)) {
      if (normaliza(c.label) !== alvo) continue;
      for (const o of c.options ?? []) if (!mapa.has(o.value)) mapa.set(o.value, o.label);
    }
  }
  return mapa;
}
