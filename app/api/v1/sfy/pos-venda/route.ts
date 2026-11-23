/**
 * sfy (fork Sales for You, etapa 10) — o bloco "Pós-venda" do cartão do negócio ganho.
 *
 * GET ?lead_id=...  → a situação da sequência daquele negócio (ou `null`).
 * PATCH             → ação do atendente: pausar, retomar, cancelar, colar o link à mão, liberar o
 *                     aviso SEM rastreio (transportadora sem rastreio), marcar a instalação.
 *
 * Quem pode: quem enxerga e pode editar o negócio (decisão D1). A visibilidade é conferida com o
 * cliente DO USUÁRIO (RLS dos perfis do Bloco A); a escrita é do servidor, com a organização
 * explícita (a tabela não é do usuário).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { validateRequest } from "@/lib/schemas";
import { linkPermitido } from "@/lib/sfy/microsys";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = "id,lead_id,nfe_numero,nfe_serie,link_rastreio,link_valido_ate,origem_link,situacao_rastreio,entregue_em,instalacao_confirmada_em,situacao,msg1_em,msg2_em,msg2_repetida_em,msg3_em,ultima_consulta_em,ultimo_erro,criado_em";

const patchSchema = z.discriminatedUnion("acao", [
  z.object({ lead_id: z.string().uuid(), acao: z.literal("pausar") }).strict(),
  z.object({ lead_id: z.string().uuid(), acao: z.literal("retomar") }).strict(),
  z.object({ lead_id: z.string().uuid(), acao: z.literal("cancelar") }).strict(),
  z.object({ lead_id: z.string().uuid(), acao: z.literal("colar_link"), link: z.string().url().max(500) }).strict(),
  z.object({ lead_id: z.string().uuid(), acao: z.literal("liberar_sem_rastreio") }).strict(),
  z.object({ lead_id: z.string().uuid(), acao: z.literal("instalacao_confirmada") }).strict(),
]);

async function negocioVisivel(leadId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("crm_leads").select("id").eq("id", leadId).maybeSingle();
  return !!data;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const leadId = z.string().uuid().safeParse(new URL(req.url).searchParams.get("lead_id"));
  if (!leadId.success) return fail("validation_error", "lead_id inválido.", 400, { requestId });
  if (!(await negocioVisivel(leadId.data))) return fail("not_found", traduzir("Negócio não encontrado.", authz.user.idioma), 404, { requestId });

  const { data, error } = await createAdminClient()
    .from("sfy_pedidos_pos_venda").select(COLUNAS).eq("organization_id", authz.org.orgId).eq("lead_id", leadId.data).maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ pedido: data ?? null }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let input;
  try {
    input = await validateRequest(patchSchema, req);
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    throw err;
  }
  if (!(await negocioVisivel(input.lead_id))) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { data: p } = await admin.from("sfy_pedidos_pos_venda").select("id,situacao,msg1_em,msg2_em").eq("organization_id", org).eq("lead_id", input.lead_id).maybeSingle();
  if (!p) return fail("not_found", t("Este negócio ainda não entrou no pós-venda."), 404, { requestId });

  const agora = new Date().toISOString();
  let mudanca: Record<string, unknown>;
  switch (input.acao) {
    case "pausar":
      mudanca = { situacao: "pausada" };
      break;
    case "cancelar":
      mudanca = { situacao: "cancelada" };
      break;
    case "retomar":
      if (p.situacao !== "pausada") return fail("conflict", t("Só dá para retomar uma sequência pausada."), 409, { requestId });
      mudanca = { situacao: p.msg1_em ? "ativa" : "aguardando_link", tentativas: 0, ultimo_erro: "" };
      break;
    case "colar_link":
      if (!linkPermitido(input.link)) return fail("validation_error", t("O link precisa ser https e do endereço da Climabrisa."), 422, { requestId });
      if (p.msg1_em) return fail("conflict", t("O aviso de rastreio já foi enviado."), 409, { requestId });
      mudanca = { link_rastreio: input.link, link_valido_ate: null, origem_link: "manual", ultimo_erro: "", ...(p.situacao === "pausada" ? { situacao: "aguardando_link", tentativas: 0 } : {}) };
      break;
    case "liberar_sem_rastreio":
      if (p.msg1_em) return fail("conflict", t("O aviso de rastreio já foi enviado."), 409, { requestId });
      mudanca = { situacao: "ativa", tentativas: 0, ultimo_erro: "" };
      break;
    case "instalacao_confirmada":
      mudanca = { instalacao_confirmada_em: agora };
      break;
  }

  const { error } = await admin.from("sfy_pedidos_pos_venda").update({ ...mudanca, atualizado_em: agora }).eq("organization_id", org).eq("id", p.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "sfy.pos_venda_acao",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "sfy_pedidos_pos_venda",
    resourceId: p.id as string,
    requestId,
    metadata: { acao: input.acao },
  });
  return ok({ id: p.id, acao: input.acao }, { requestId });
}
