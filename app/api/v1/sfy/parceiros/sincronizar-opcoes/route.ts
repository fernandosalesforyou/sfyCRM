import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/sfy/parceiros/sincronizar-opcoes — põe a lista do campo "Parceiro responsável" em dia
 * com o cadastro, para TODOS os parceiros de uma vez (admin).
 *
 * Serve para a carga inicial e para consertar uma divergência: cria a opção de quem não tem, atualiza
 * o rótulo e os apelidos de quem mudou, e nunca remove opção nem troca o valor (o código). Repetir é
 * seguro: o que já está em dia não conta.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { sincronizarOpcoesDosParceiros } from "@/lib/sfy/opcoes-parceiro";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;

  let relatorio;
  try {
    relatorio = await sincronizarOpcoesDosParceiros(createAdminClient(), authz.org.orgId);
  } catch {
    return fail("internal_error", "sincronizacao_falhou", 500, { requestId });
  }

  await audit({
    action: "sfy.distribuicao_cadastro_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "sfy_parceiros",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { tipo: "parceiro", campos: ["opcoes_do_campo"], ...relatorio },
  });

  return ok(relatorio, { requestId });
}
