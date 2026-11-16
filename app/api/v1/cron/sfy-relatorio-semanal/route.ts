/**
 * sfy (fork Sales for You, Bloco D, D4) — relatório semanal por parceiro e supervisor.
 *
 * Roda toda segunda (09h de Brasília). Só as organizações com `settings.sfy.relatorio_semanal =
 * true` (nasce DESLIGADO) e que não estão paradas. Em modo de teste (`relatorio_semanal_teste`)
 * nada vai a parceiro ou supervisor. Ver `lib/sfy/semanal.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { executarRelatorioSemanal } from "@/lib/sfy/semanal";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAXIMO_DE_ORGANIZACOES = 20;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id")
    .eq("settings->sfy->>relatorio_semanal", "true")
    .limit(MAXIMO_DE_ORGANIZACOES);
  if (error) {
    logger.error("[sfy-relatorio-semanal] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar organizações.", 500, { requestId });
  }

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const resultados: Array<{ modo: string; enviados: number; falhas: number; pulados: number }> = [];
  for (const org of orgs ?? []) {
    if (paradas.has(org.id as string)) continue;
    try {
      const r = await executarRelatorioSemanal(admin, org.id as string, new Date());
      resultados.push({ modo: r.modo, enviados: r.enviados, falhas: r.falhas.length, pulados: r.pulados.length });
      if (r.falhas.length > 0) logger.warn("[sfy-relatorio-semanal] falhas de envio", { organizationId: org.id, falhas: r.falhas, requestId });
    } catch (e) {
      logger.error("[sfy-relatorio-semanal] falhou", { organizationId: org.id, error: e instanceof Error ? e.message : String(e), requestId });
      resultados.push({ modo: "erro", enviados: 0, falhas: 1, pulados: 0 });
    }
  }
  return ok({ organizacoes: resultados.length, resultados }, { requestId });
}

export const GET = handle;
export const POST = handle;
