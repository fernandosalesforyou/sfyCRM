/**
 * sfy (etapa 9) — o envio de e-mail pelo CRM está pronto? E com qual endereço este usuário sai?
 * GET: { configurado, de }. Não expõe chave nem configuração.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { isEmailConfigured } from "@/lib/email/resend";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { dominioDe } from "@/lib/sfy/email-usuario";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const configurado = await isEmailConfigured();
  const remetente = configurado ? (await valorDaInstalacao("RESEND_FROM_EMAIL")).valor : null;
  const proprio = dominioDe(authz.user.email) === dominioDe(remetente);
  return ok({ configurado, de: proprio ? authz.user.email : remetente }, { requestId });
}
