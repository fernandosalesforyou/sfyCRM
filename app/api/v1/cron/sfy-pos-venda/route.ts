/**
 * sfy (fork Sales for You, etapa 10) — rodada do pós-venda: rastreio, "já instalou?" e manutenção.
 *
 * Só as organizações com `settings.sfy.pos_venda = true` (nasce DESLIGADO) e que não estão
 * paradas. Envia só em horário comercial de Brasília. Ver `lib/sfy/pos-venda-exec.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { executarPosVenda } from "@/lib/sfy/pos-venda-exec";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAXIMO_DE_ORGANIZACOES = 20;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id")
    .eq("settings->sfy->>pos_venda", "true")
    .limit(MAXIMO_DE_ORGANIZACOES);
  if (error) {
    logger.error("[sfy-pos-venda] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar organizações.", 500, { requestId });
  }

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const resultados: Array<{ modo: string; criados: number; consultados: number; respostas: number; enviados: number; falhas: number; pulados: number }> = [];
  for (const org of orgs ?? []) {
    if (paradas.has(org.id as string)) continue;
    try {
      const r = await executarPosVenda(admin, org.id as string, new Date());
      resultados.push({ modo: r.modo, criados: r.criados, consultados: r.consultados, respostas: r.respostas, enviados: r.enviados, falhas: r.falhas.length, pulados: r.pulados.length });
      if (r.falhas.length > 0) logger.warn("[sfy-pos-venda] falhas", { organizationId: org.id, falhas: r.falhas.slice(0, 10), requestId });
    } catch (e) {
      logger.error("[sfy-pos-venda] falhou", { organizationId: org.id, error: e instanceof Error ? e.message : String(e), requestId });
      resultados.push({ modo: "erro", criados: 0, consultados: 0, respostas: 0, enviados: 0, falhas: 1, pulados: 0 });
    }
  }
  return ok({ organizacoes: resultados.length, resultados }, { requestId });
}

export const GET = handle;
export const POST = handle;
