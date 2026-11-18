/**
 * sfy (fork Sales for You, etapa 7B) — contas puras do cadastro de parceiros.
 *
 * Na tela e na planilha a cliente escolhe UMA situação por parceiro; no banco isso vira três
 * chaves (`ativo`, `certificado`, `recebe_leads`) amarradas por restrição (migration 5010):
 * só recebe lead quem está ativo e certificado.
 */

export type Situacao = "certificado_recebe" | "certificado_pausado" | "nao_certificado" | "saiu";

export const SITUACOES: readonly Situacao[] = [
  "certificado_recebe",
  "certificado_pausado",
  "nao_certificado",
  "saiu",
] as const;

export interface CamposDaSituacao {
  ativo: boolean;
  certificado: boolean;
  recebe_leads: boolean;
  saiu_em: string | null;
}

export interface CamposDoParceiro {
  ativo: boolean;
  certificado: boolean;
  recebe_leads: boolean;
}

/**
 * Os campos do banco para uma situação. `saiu_em` guarda a data da saída (a primeira, se já havia);
 * quem volta a ficar ativo limpa a data. Quem sai continua certificado (é um fato histórico).
 */
export function camposDaSituacao(situacao: Situacao, hoje: string, saiuEmAtual: string | null): CamposDaSituacao {
  switch (situacao) {
    case "certificado_recebe":
      return { ativo: true, certificado: true, recebe_leads: true, saiu_em: null };
    case "certificado_pausado":
      return { ativo: true, certificado: true, recebe_leads: false, saiu_em: null };
    case "nao_certificado":
      return { ativo: true, certificado: false, recebe_leads: false, saiu_em: null };
    case "saiu":
      return { ativo: false, certificado: true, recebe_leads: false, saiu_em: saiuEmAtual ?? hoje };
  }
}

/** Faz o caminho de volta: qual situação os campos do banco representam. */
export function situacaoDosCampos(p: CamposDoParceiro): Situacao {
  if (!p.ativo) return "saiu";
  if (!p.certificado) return "nao_certificado";
  return p.recebe_leads ? "certificado_recebe" : "certificado_pausado";
}

/** Código do parceiro: curto, sem espaço (é a chave que fica gravada nos negócios). */
export function codigoValido(codigo: string): boolean {
  return /^[A-Za-z0-9._-]{1,20}$/.test(codigo);
}

/** Data `AAAA-MM-DD` que existe de verdade (rejeita 2026-02-31). */
export function dataValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

export interface ImpactoDasCidades {
  /** Cidades que acabaram de entrar e agora têm mais de um parceiro elegível (rodízio). */
  entram_em_rodizio: number;
  /** Cidades que acabaram de sair e ficaram sem parceiro elegível (vão para o supervisor). */
  ficam_sem_parceiro: number;
}

/**
 * Impacto de uma troca de cidades. `elegiveisPorCidade`: cidade (`uf|cidade_norm`) → quantos parceiros
 * elegíveis a atendem DEPOIS da troca.
 */
export function impactoDasCidades(
  adicionadas: string[],
  removidas: string[],
  elegiveisPorCidade: Map<string, number>,
): ImpactoDasCidades {
  return {
    entram_em_rodizio: adicionadas.filter((c) => (elegiveisPorCidade.get(c) ?? 0) > 1).length,
    ficam_sem_parceiro: removidas.filter((c) => (elegiveisPorCidade.get(c) ?? 0) === 0).length,
  };
}
