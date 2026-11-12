"use server";
/**
 * sfy (fork Sales for You, Bloco A) — liga/desliga as regras da organização em
 * `organizations.settings.sfy` (exclusão e valor do ganho só pelo admin).
 *
 * Mesmo portão de `atualizarInterfaceDaEmpresa`: admin da organização ativa
 * (ou plataforma), sem suporte em modo leitura, MFA em dia. A escrita vai pelo
 * admin client porque a única policy de escrita de `organizations` é de
 * plataforma (issue #144); a organização vem da SESSÃO, nunca do corpo. Só a
 * chave `sfy` é trocada — o resto de `settings` é preservado.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

const regrasSchema = z
  .object({
    exclusao_so_admin: z.boolean(),
    valor_do_ganho_so_admin: z.boolean(),
    origem_protegida: z.boolean(),
    origem_manual_sem_identificacao: z.boolean(),
  })
  .strict();

export type RegrasSfyInput = z.infer<typeof regrasSchema>;
export type RegrasSfyResult = { ok: true } | { ok: false; error: string };

export async function atualizarRegrasSfy(input: RegrasSfyInput): Promise<RegrasSfyResult> {
  const entrada = regrasSchema.safeParse(input);
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(authUser, activeOrg)) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const orgId = activeOrg.orgId;
  const supabase = createAdminClient();
  const hdrs = await headers();

  const { data: atual, error: erroLeitura } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: "internal_error" };

  const settings = ((atual?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const sfyAnterior = (settings.sfy as Record<string, unknown> | undefined) ?? {};
  const sfy = { ...sfyAnterior, ...entrada.data };

  invalidarOrg(orgId);
  const { error } = await supabase
    .from("organizations")
    .update({ settings: { ...settings, sfy } })
    .eq("id", orgId);
  if (error) return { ok: false, error: "internal_error" };
  invalidarOrg(orgId);

  await audit({
    action: "sfy.org_rules_changed",
    organizationId: orgId,
    actorUserId: authUser.id,
    resourceType: "organization",
    resourceId: orgId,
    requestId: hdrs.get("x-request-id"),
    ip: ipDoCliente(hdrs),
    userAgent: hdrs.get("user-agent") ?? null,
    metadata: {
      antes: {
        exclusao_so_admin: sfyAnterior.exclusao_so_admin === true,
        valor_do_ganho_so_admin: sfyAnterior.valor_do_ganho_so_admin === true,
        origem_protegida: sfyAnterior.origem_protegida === true,
        origem_manual_sem_identificacao: sfyAnterior.origem_manual_sem_identificacao === true,
      },
      depois: entrada.data,
    },
  });

  revalidatePath("/app/settings/tenant");
  return { ok: true };
}
