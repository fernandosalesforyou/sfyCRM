/**
 * POST /api/v1/sfy/fechamento/<token> — o parceiro informa que fechou um negócio (valor e nota).
 *
 * Público (a página `/fechamento/<token>` posta aqui). Só grava um PEDIDO para o administrador
 * tratar; nunca muda o negócio. Limite de tentativas por link e por IP, token de forma validada
 * antes de qualquer consulta, e resposta idêntica para link inexistente, expirado ou revogado.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { fail } from "@/lib/api/wrappers";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { acharLinkValido, hashDoToken, registrarFechamento, tokenComFormaValida } from "@/lib/sfy/fechamento";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * 303 para a própria página, com endereço RELATIVO: atrás do proxy, `req.url` traz o host interno
 * do servidor (ex.: 0.0.0.0), e um redirecionamento absoluto levaria o parceiro a um endereço
 * que não abre.
 */
function volta(token: string, resultado: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: `/fechamento/${token}?r=${encodeURIComponent(resultado)}` } });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!tokenComFormaValida(token)) return fail("not_found", "Not found", 404, { requestId });

  const ip = ipDoCliente(req.headers) ?? "sem-ip";
  const [porLink, porIp] = await Promise.all([
    checkRateLimit(`sfy_fechamento:${hashDoToken(token).slice(0, 16)}`, 30, 60),
    checkRateLimit(`sfy_fechamento_ip:${ip}`, 60, 60),
  ]);
  if (!porLink.allowed || !porIp.allowed) {
    return fail("rate_limited", "Too many requests.", 429, { requestId, headers: { "Retry-After": "60" } });
  }

  const admin = createAdminClient();
  const alvo = await acharLinkValido(admin, token);
  if (!alvo) return fail("not_found", "Not found", 404, { requestId });

  const form = await req.formData().catch(() => null);
  const campo = (n: string) => (typeof form?.get(n) === "string" ? (form!.get(n) as string) : "");
  const leadId = campo("lead_id");
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return volta(token, "negocio_nao_e_seu");

  const r = await registrarFechamento(admin, alvo, {
    lead_id: leadId,
    valor: campo("valor"),
    nota_fiscal: campo("nota_fiscal"),
    observacao: campo("observacao"),
  });
  return volta(token, r.ok ? "ok" : r.motivo);
}
