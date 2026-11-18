/**
 * GET /api/v1/sfy/municipios?uf=SP&q=pira — busca de município na lista do IBGE (gerente+).
 *
 * Alimenta a escolha de cidades de um parceiro: só municípios da lista fechada, nunca texto livre.
 * A tabela é só do servidor (sem política para o navegador), então a leitura é pelo admin client,
 * depois de conferir o papel. Devolve no máximo 30, ordenados por nome.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { normalizaTexto } from "@/lib/sfy/distribuicao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const consulta = z.object({
  uf: z.string().regex(/^[A-Za-z]{2}$/),
  q: z.string().trim().max(60).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  const parsed = consulta.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "uf", 422, { requestId });
  const uf = parsed.data.uf.toUpperCase();
  // Sem os curingas do LIKE: o texto do usuário não vira padrão.
  const termo = normalizaTexto(parsed.data.q ?? "").replace(/[%_\\]/g, "");

  let busca = createAdminClient()
    .from("sfy_municipios")
    .select("codigo_ibge, nome, uf")
    .eq("uf", uf)
    .order("nome")
    .limit(30);
  if (termo) busca = busca.ilike("nome_norm", `%${termo}%`);
  const { data, error } = await busca;
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ municipios: data ?? [] }, { requestId });
}
