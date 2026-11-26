/**
 * GET /api/v1/sfy/relatorios — relatórios do Bloco D (migration 5006).
 *
 * `tipo=destino&agrupar=parceiro|supervisor` | `tipo=periodo&granularidade=dia|semana|mes` | `tipo=origem`.
 * Janela por data de parede no fuso da organização: `de` inclusive, `ate` inclusive (AAAA-MM-DD),
 * padrão últimos 30 dias. Negócios criados na janela (coorte). Histórico importado fica de fora
 * salvo `historico=1`. Só manager+ (mostra a organização inteira); leitura pelo servidor com a
 * organização explícita, como as rotas de métricas; as funções não são executáveis pelo usuário.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { diaLocalISO, instanteDe } from "@/lib/agenda/fuso";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizaTexto } from "@/lib/sfy/distribuicao";
import {
  baldesDaJanela,
  chavesDoCampo,
  juntarPorGrupo,
  montarCusto,
  montarSerie,
  rotulosDasOpcoes,
  somarLinhas,
  type LinhaDeCustoBruta,
  type LinhaDestinoBruta,
  type LinhaPeriodoBruta,
} from "@/lib/sfy/relatorios";
import { createAdminClient } from "@/lib/supabase/admin";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { nomeAtualDe } from "@/lib/sfy/supervisores";

export const dynamic = "force-dynamic";

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  tipo: z.enum(["destino", "periodo", "origem", "custo"]),
  agrupar: z.enum(["parceiro", "supervisor"]).optional(),
  granularidade: z.enum(["dia", "semana", "mes"]).optional(),
  de: dia.optional(),
  ate: dia.optional(),
  historico: z.enum(["0", "1"]).optional(),
});

const ROTULO_DO_CAMPO = { parceiro: "Parceiro responsável", supervisor: "Supervisor", categoria: "Categoria" } as const;

function partes(d: string) {
  const [ano = 0, mes = 0, diaDoMes = 0] = d.split("-").map(Number);
  return { ano, mes, dia: diaDoMes };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const q = parsed.data;
  const supabase = createAdminClient();

  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const fuso = fusoUtilizavel((org as { timezone?: string | null } | null)?.timezone);

  const hoje = diaLocalISO(new Date(), fuso);
  const ate = q.ate ?? hoje;
  const de = q.de ?? diaLocalISO(new Date(Date.now() - 29 * 86_400_000), fuso);
  if (de > ate) return fail("validation_failed", t("Janela inválida: 'from' deve ser anterior a 'to'."), 422, { requestId });
  const diaSeguinte = new Date(`${ate}T00:00:00Z`);
  diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
  const ateExclusivo = diaSeguinte.toISOString().slice(0, 10);
  const pDe = instanteDe(partes(de), fuso).toISOString();
  const pAte = instanteDe(partes(ateExclusivo), fuso).toISOString();
  const historico = q.historico === "1";
  const janela = { de, ate };

  if (q.tipo === "custo") {
    const { data, error } = await supabase.rpc("fn_sfy_custo_por_campanha", {
      p_org: orgId, p_de: pDe, p_ate: pAte, p_dia_de: de, p_dia_ate: ate,
      p_prefixo_etapa: "Em negociação", p_incluir_historico: historico,
    });
    if (error) return fail("internal_error", error.message, 500, { requestId });
    return ok({ janela, historico, ...montarCusto((data ?? []) as LinhaDeCustoBruta[]) }, { requestId });
  }

  if (q.tipo === "origem") {
    const { data, error } = await supabase.rpc("fn_sfy_relatorio_por_origem", {
      p_org: orgId, p_de: pDe, p_ate: pAte, p_incluir_historico: historico,
    });
    if (error) return fail("internal_error", error.message, 500, { requestId });
    const linhas = juntarPorGrupo(
      ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        grupo: String(r.origem ?? ""), moeda: String(r.moeda ?? ""), leads: Number(r.leads), abertos: Number(r.leads) - Number(r.ganhos) - Number(r.perdidos),
        ganhos: Number(r.ganhos), perdidos: Number(r.perdidos), valor_ganho_centavos: Number(r.valor_ganho_centavos), mediana_dias_ate_ganho: null,
      })),
    );
    return ok({ janela, historico, linhas, total: somarLinhas(linhas) }, { requestId });
  }

  // Campos personalizados: a chave pode variar de funil para funil; busca pelo rótulo.
  const { data: funis, error: erroFunis } = await supabase.from("crm_pipelines").select("settings").eq("organization_id", orgId);
  if (erroFunis) return fail("internal_error", erroFunis.message, 500, { requestId });
  const rotulo = q.tipo === "destino" ? ROTULO_DO_CAMPO[q.agrupar ?? "parceiro"] : ROTULO_DO_CAMPO.categoria;
  const chaves = chavesDoCampo(funis ?? [], rotulo, normalizaTexto);

  if (q.tipo === "destino") {
    // Sem o campo em nenhum funil, tudo cai em "sem parceiro/supervisor".
    const { data, error } = await supabase.rpc("fn_sfy_relatorio_por_destino", {
      p_org: orgId, p_de: pDe, p_ate: pAte, p_chaves: chaves, p_incluir_historico: historico,
    });
    if (error) return fail("internal_error", error.message, 500, { requestId });
    let brutas = (data ?? []) as LinhaDestinoBruta[];
    if (rotulo === ROTULO_DO_CAMPO.supervisor) {
      // Supervisor renomeado: os negócios antigos guardam o nome de antes; somam no nome atual.
      const { data: sups } = await supabase.from("sfy_supervisores").select("nome, nomes_anteriores").eq("organization_id", orgId);
      brutas = brutas.map((l) => ({ ...l, grupo: nomeAtualDe(sups ?? [], l.grupo) }));
    }
    const nomes = rotulosDasOpcoes(funis ?? [], rotulo, normalizaTexto);
    const linhas = juntarPorGrupo(brutas).map((l) => ({ ...l, rotulo: nomes.get(l.grupo) ?? l.grupo }));
    return ok(
      { janela, historico, agrupar: q.agrupar ?? "parceiro", campo_encontrado: chaves.length > 0, linhas, total: somarLinhas(linhas) },
      { requestId },
    );
  }

  const granularidade = q.granularidade ?? "dia";
  const brutas: LinhaPeriodoBruta[] = [];
  const { data, error } = await supabase.rpc("fn_sfy_leads_por_periodo", {
    p_org: orgId, p_de: pDe, p_ate: pAte, p_tz: fuso, p_granularidade: granularidade,
    p_chaves_categoria: chaves, p_incluir_historico: historico,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    brutas.push({ balde: String(r.balde), categoria: String(r.categoria ?? ""), origem: String(r.origem ?? ""), leads: Number(r.leads) });
  }
  const serie = montarSerie(brutas, baldesDaJanela(de, ateExclusivo, granularidade));
  const porOrigem = new Map<string, number>();
  for (const b of brutas) porOrigem.set(b.origem, (porOrigem.get(b.origem) ?? 0) + b.leads);
  return ok(
    {
      janela, historico, granularidade, campo_encontrado: chaves.length > 0, ...serie,
      origens: [...porOrigem.entries()].map(([origem, leads]) => ({ origem, leads })).sort((a, b) => b.leads - a.leads),
    },
    { requestId },
  );
}
