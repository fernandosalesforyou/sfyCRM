/**
 * sfy (fork Sales for You, Bloco D, D3) — do gasto lido da plataforma à tabela `sfy_gasto_anuncio`.
 *
 * Duas partes: a conta PURA (`linhasDeGasto`: texto da plataforma → linha da tabela, sem
 * adivinhar) e a sincronização, que lê as contas de anúncio da organização e grava os últimos
 * dias (a plataforma reprocessa a atribuição por dias, então relê uma janela, não só ontem).
 * Opt-in por organização: `settings.sfy.gasto_de_anuncio = true` (liga-se na entrega).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { lerGastoDiario, listarContas, type LinhaDeGastoDiarioCrua } from "@/lib/plataformas-de-anuncio/meta/insights";

export interface LinhaDeGasto {
  organization_id: string;
  plataforma: "meta_ads";
  conta_id: string;
  campanha_id: string;
  campanha_nome: string;
  dia: string;
  moeda: string;
  gasto_centavos: number;
  impressoes: number;
  cliques: number;
}

/** "123.45" → 12345. Texto que não é número vira `null` (a linha é descartada, não zerada). */
export function centavosDoTexto(valor: string | undefined): number | null {
  if (valor === undefined || valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function inteiro(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Descarta linha sem campanha, sem dia ou sem gasto legível; nunca inventa valor. */
export function linhasDeGasto(
  organizationId: string,
  contaId: string,
  moedaDaConta: string,
  cruas: LinhaDeGastoDiarioCrua[],
): LinhaDeGasto[] {
  const saida: LinhaDeGasto[] = [];
  for (const c of cruas) {
    const gasto = centavosDoTexto(c.spend);
    if (!c.campaign_id || !c.date_start || !/^\d{4}-\d{2}-\d{2}$/.test(c.date_start) || gasto === null) continue;
    saida.push({
      organization_id: organizationId,
      plataforma: "meta_ads",
      conta_id: contaId,
      campanha_id: c.campaign_id,
      campanha_nome: c.campaign_name ?? "",
      dia: c.date_start,
      moeda: c.account_currency || moedaDaConta || "BRL",
      gasto_centavos: gasto,
      impressoes: inteiro(c.impressions),
      cliques: inteiro(c.inline_link_clicks),
    });
  }
  return saida;
}

export interface ResumoDaSincronizacao {
  contas: number;
  linhas: number;
  falhas: string[];
}

/** Lê as contas de anúncio da Meta da organização e grava (upsert) o gasto de `de` a `ate`. */
export async function sincronizarGastoDaMeta(
  admin: SupabaseClient,
  organizationId: string,
  de: string,
  ate: string,
): Promise<ResumoDaSincronizacao> {
  const resumo: ResumoDaSincronizacao = { contas: 0, linhas: 0, falhas: [] };
  const credencial = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (!credencial.ok) {
    resumo.falhas.push(`sem_conexao:${credencial.motivo}`);
    return resumo;
  }
  const token = credencial.credencial.accessToken;
  const contas = await listarContas(token);
  if (!contas.ok) {
    resumo.falhas.push(`contas:${contas.falha}`);
    return resumo;
  }
  for (const conta of contas.dados) {
    const leitura = await lerGastoDiario(token, conta.id, de, ate);
    if (!leitura.ok) {
      resumo.falhas.push(`${conta.id}:${leitura.falha}`);
      continue;
    }
    resumo.contas += 1;
    const linhas = linhasDeGasto(organizationId, conta.id, conta.moeda, leitura.dados);
    if (linhas.length === 0) continue;
    const { error } = await admin
      .from("sfy_gasto_anuncio")
      .upsert(linhas.map((l) => ({ ...l, lido_em: new Date().toISOString() })), {
        onConflict: "organization_id,plataforma,campanha_id,dia",
      });
    if (error) {
      logger.warn("[sfy.gasto] falha ao gravar", { contexto: "gasto", organizationId, conta: conta.id, motivo: error.message });
      resumo.falhas.push(`${conta.id}:gravacao`);
      continue;
    }
    resumo.linhas += linhas.length;
  }
  return resumo;
}
