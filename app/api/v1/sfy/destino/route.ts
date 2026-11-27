/**
 * GET /api/v1/sfy/destino?categoria=climabrisa&cidade=Piraju&uf=SP — "para quem vai este lead?" (gerente+).
 *
 * Simula a distribuição: mostra quem receberia o lead e por quê, SEM gastar a vez do rodízio e sem
 * gravar nada (`p_simular`). Serve para a equipe conferir o cadastro antes de um lead real chegar.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { DestinoEscolhido } from "@/lib/sfy/distribuicao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const consulta = z.object({
  categoria: z.enum(["climabrisa", "agro"]),
  cidade: z.string().trim().min(1).max(80),
  uf: z.string().regex(/^[A-Za-z]{2}$/),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  const parsed = consulta.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "categoria, cidade e uf", 422, { requestId });

  const { data, error } = await createAdminClient().rpc("fn_sfy_escolher_destino", {
    p_org: authz.org.orgId,
    p_categoria: parsed.data.categoria,
    p_cidade: parsed.data.cidade,
    p_uf: parsed.data.uf.toUpperCase(),
    p_simular: true,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ destino: data as DestinoEscolhido }, { requestId });
}
