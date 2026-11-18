/**
 * sfy (etapa 9) — envia um e-mail do usuário pelo Resend (De e Reply-To = o endereço dele, cópia
 * oculta para ele) e registra na linha do tempo do negócio. O negócio é lido com o cliente DO
 * USUÁRIO (a RLS decide se ele o enxerga). Só envia: não lê respostas nem caixa de entrada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { sendEmail } from "@/lib/email/resend";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { traduzir } from "@/lib/i18n/dicionario";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { validateRequest } from "@/lib/schemas";
import { dominioDe, montarEnvio } from "@/lib/sfy/email-usuario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z
  .object({
    lead_id: z.string().uuid(),
    para: z.array(z.string()).min(1).max(20),
    cc: z.array(z.string()).max(20).optional(),
    assunto: z.string().min(1).max(250),
    corpo: z.string().min(1).max(100_000),
    anexos: z
      .array(z.object({ nome: z.string().min(1).max(200), tipo: z.string().max(120), base64: z.string().max(4_300_000) }).strict())
      .max(5)
      .optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const org = authz.org.orgId;

  let input;
  try {
    input = await validateRequest(schema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    }
    throw err;
  }

  const remetente = (await valorDaInstalacao("RESEND_FROM_EMAIL")).valor;
  let envio;
  try {
    envio = montarEnvio(
      { email: authz.user.email, nome: authz.user.full_name },
      dominioDe(remetente),
      { para: input.para, cc: input.cc, assunto: input.assunto, corpo: input.corpo, anexos: input.anexos },
    );
  } catch (err) {
    return fail("validation_error", err instanceof Error ? err.message : t("E-mail inválido."), 422, { requestId });
  }

  // O negócio precisa ser visível para QUEM envia (RLS do cliente do request).
  const supabase = await createClient();
  const { data: lead } = await supabase.from("crm_leads").select("id, contact_id").eq("id", input.lead_id).eq("organization_id", org).maybeSingle();
  if (!lead) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const r = await sendEmail({
    to: envio.to,
    cc: envio.cc,
    bcc: envio.bcc,
    subject: envio.subject,
    html: envio.html,
    text: envio.text,
    replyTo: envio.replyTo,
    fromEndereco: envio.fromEndereco,
    fromName: envio.fromName,
    attachments: envio.attachments,
    tags: [{ name: "origem", value: "sfy_crm_usuario" }],
  });
  if (!r.ok) {
    if (r.error === "not_configured") return fail("not_configured", t("O envio de e-mail ainda não foi configurado neste CRM."), 422, { requestId });
    logger.warn("[sfy.email] envio falhou", { requestId, erro: r.error });
    const status = r.error === "rate_limited" ? 429 : 502;
    return fail("email_send_failed", t("Não foi possível enviar o e-mail."), status, { requestId });
  }

  const total = envio.to.length + envio.cc.length;
  void emitLeadActivity(createAdminClient(), {
    organizationId: org,
    leadId: lead.id as string,
    contactId: (lead.contact_id as string | null) ?? null,
    type: "note",
    sourceModule: "sfy_email",
    actor: { type: "user", id: authz.user.id },
    reason: `E-mail enviado pelo CRM: ${envio.subject.slice(0, 120)}`,
    payload: { canal: "email_usuario", destinatarios: total, anexos: envio.attachments.length },
  }).then((x) => {
    if (!x.ok) logger.warn("[sfy.email] atividade não gravada", { requestId, erro: x.error });
  });

  await audit({
    action: "sfy.email_enviado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "crm_leads",
    resourceId: lead.id as string,
    requestId,
    metadata: { destinatarios: total, anexos: envio.attachments.length },
  });
  return ok({ enviado: true }, { requestId });
}
