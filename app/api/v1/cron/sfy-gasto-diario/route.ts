/**
 * sfy (fork Sales for You, Bloco D, D3) — uma vez por dia, grava o gasto por campanha da Meta.
 *
 * Só as organizações que ligaram `settings.sfy.gasto_de_anuncio = true` (nasce desligado) e
 * que não estão paradas. Relê os últimos 7 dias, não só ontem: a plataforma reprocessa a
 * atribuição por alguns dias, e o upsert corrige o dia já gravado. Os leads não passam por
 * aqui: o custo cruza gasto e leads no banco (`fn_sfy_custo_por_campanha`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { sincronizarGastoDaMeta } from "@/lib/sfy/gasto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DIAS_RELIDOS = 7;
const MAXIMO_DE_ORGANIZACOES = 50;

function data(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("settings->sfy->>gasto_de_anuncio", "true")
    .limit(MAXIMO_DE_ORGANIZACOES);
  if (error) {
    logger.error("[sfy-gasto-diario] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar organizações.", 500, { requestId });
  }

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const ate = data(new Date(Date.now() - 24 * 60 * 60 * 1000)); // ontem: o dia corrente está incompleto
  const de = data(new Date(Date.now() - DIAS_RELIDOS * 24 * 60 * 60 * 1000));

  let linhas = 0;
  let falhas = 0;
  let examinadas = 0;
  for (const org of orgs ?? []) {
    if (paradas.has(org.id as string)) continue;
    examinadas += 1;
    const r = await sincronizarGastoDaMeta(admin, org.id as string, de, ate);
    linhas += r.linhas;
    falhas += r.falhas.length;
    if (r.falhas.length > 0) {
      logger.warn("[sfy-gasto-diario] falhas na leitura", { organizationId: org.id, falhas: r.falhas, requestId });
    }
  }
  return ok({ organizacoes: examinadas, linhas, falhas, janela: { de, ate } }, { requestId });
}

export const GET = handle;
export const POST = handle;
