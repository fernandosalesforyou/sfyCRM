/**
 * sfy (fork Sales for You, Bloco A) — as regras opt-in por organização.
 *
 * Moram em `organizations.settings.sfy` e são aplicadas no BANCO (migration
 * 5001: gatilhos que lançam `sfy_delete_admin_only` / `sfy_won_value_admin_only`
 * com SQLSTATE 42501). Este módulo só:
 *   1. lê as chaves (para a tela e para recusar cedo, com mensagem clara);
 *   2. traduz o erro do banco em 403 de negócio, nunca 500.
 *
 * Ausente ou qualquer valor que não seja `true` = desligado (o original).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";

export const REGRAS_SFY = [
  "exclusao_so_admin",
  "valor_do_ganho_so_admin",
  "origem_protegida",
  "origem_manual_sem_identificacao",
] as const;
export type RegraSfy = (typeof REGRAS_SFY)[number];

export const MENSAGEM_EXCLUSAO_SO_ADMIN = "Só o administrador pode excluir negócios e contatos.";
export const MENSAGEM_GANHO_SO_ADMIN =
  "Só o administrador pode alterar o valor ou reabrir um negócio ganho.";

export const MENSAGEM_ORIGEM_SO_ADMIN =
  "Só o administrador pode alterar a origem de um contato ou negócio que veio de anúncio, site ou integração.";

/** Leitura pura de `organizations.settings`. */
export function regraSfyLigada(settings: unknown, regra: RegraSfy): boolean {
  if (!settings || typeof settings !== "object") return false;
  const sfy = (settings as { sfy?: unknown }).sfy;
  if (!sfy || typeof sfy !== "object") return false;
  return (sfy as Record<string, unknown>)[regra] === true;
}

/** Lê a regra da organização. Falha de leitura = desligada: o banco continua sendo a trava. */
export async function regraSfyDaOrganizacao(
  supabase: SupabaseClient,
  organizationId: string,
  regra: RegraSfy,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error || !data) return false;
    return regraSfyLigada((data as { settings?: unknown }).settings, regra);
  } catch {
    return false;
  }
}

type ErroDoBanco = { code?: string; message?: string } | null | undefined;

export function ehRecusaSfyDeExclusao(erro: ErroDoBanco): boolean {
  return erro?.code === "42501" && (erro.message?.includes("sfy_delete_admin_only") ?? false);
}

export function ehRecusaSfyDoGanho(erro: ErroDoBanco): boolean {
  return erro?.code === "42501" && (erro.message?.includes("sfy_won_value_admin_only") ?? false);
}

export function ehRecusaSfyDaOrigem(erro: ErroDoBanco): boolean {
  return erro?.code === "42501" && (erro.message?.includes("sfy_origin_admin_only") ?? false);
}

/** O erro do banco vira 403 de negócio; `null` quando não é uma trava sfy. */
export function recusaSfyDoBanco(
  erro: ErroDoBanco,
  requestId: string,
  idioma?: Idioma | null,
): ApiError | null {
  const lingua = idioma ?? IDIOMA_PADRAO;
  if (ehRecusaSfyDeExclusao(erro)) {
    return new ApiError(
      403,
      "sfy_delete_admin_only",
      undefined,
      requestId,
      traduzir(MENSAGEM_EXCLUSAO_SO_ADMIN, lingua),
    );
  }
  if (ehRecusaSfyDoGanho(erro)) {
    return new ApiError(
      403,
      "sfy_won_value_admin_only",
      undefined,
      requestId,
      traduzir(MENSAGEM_GANHO_SO_ADMIN, lingua),
    );
  }
  if (ehRecusaSfyDaOrigem(erro)) {
    return new ApiError(
      403,
      "sfy_origin_admin_only",
      undefined,
      requestId,
      traduzir(MENSAGEM_ORIGEM_SO_ADMIN, lingua),
    );
  }
  return null;
}
