/**
 * sfy — MODO "EM PREPARAÇÃO" (primeiro acesso da empresa).
 *
 * `SFY_TELAS_LIBERADAS` lista, separadas por vírgula, as telas que já podem ser
 * usadas (ex.: "/app/kanban,/app/contacts"). Com a lista definida, quem não é
 * dono do servidor vê um aviso no lugar de qualquer outra tela de `/app`. Sem a
 * variável, nada muda. Liberar uma tela nova é editar o `.env` e reiniciar o app.
 *
 * É apresentação, não autorização: papel e RLS seguem decidindo o que cada
 * pessoa alcança pela API.
 */

/** Portas da própria pessoa: trocar senha e dados nunca fica bloqueado. */
export const SEMPRE_LIBERADAS: readonly string[] = ["/app/settings/profile", "/app/settings/security"];

/** `null` = modo desligado. */
export function telasLiberadas(bruto: string | undefined): string[] | null {
  const telas = (bruto ?? "")
    .split(",")
    .map((t) => t.trim().replace(/\/+$/, ""))
    .filter((t) => t.startsWith("/app/"));
  return telas.length ? telas : null;
}

/** A tela (e as filhas dela) está fora da lista? `/app` só redireciona. */
export function emPreparacao(caminho: string, liberadas: readonly string[]): boolean {
  if (caminho === "/app" || !caminho.startsWith("/app/")) return false;
  return ![...liberadas, ...SEMPRE_LIBERADAS].some(
    (tela) => caminho === tela || caminho.startsWith(`${tela}/`),
  );
}
