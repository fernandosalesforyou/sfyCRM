/**
 * sfy (fork Sales for You, etapa 7B) — contas puras do cadastro de supervisores.
 *
 * A empresa cria, renomeia e desativa supervisores pela tela. Aqui ficam as regras que não dependem
 * do banco: nome sem repetição (inclusive contra nomes antigos, porque os negócios guardam o nome em
 * texto) e a leitura dos estados do Agro digitados à mão.
 */
// Cópia da regra de `normalizaTexto` (distribuicao.ts): este arquivo vai para o navegador e não pode
// importar aquele, que puxa código só de servidor.
function normalizaTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const UFS_DO_BRASIL = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI",
  "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export interface SupervisorCadastrado {
  id: string;
  nome: string;
  categoria: string;
  ufs: string[] | null;
  ativo: boolean;
  nomes_anteriores?: string[] | null;
}

/** "rs, sc; PR" → ["PR","RS","SC"]. Devolve também o que não é estado, para a tela avisar. */
export function lerUfs(texto: string): { ufs: string[]; invalidas: string[] } {
  const pedacos = texto.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const validas = new Set<string>(UFS_DO_BRASIL);
  return {
    ufs: [...new Set(pedacos.filter((p) => validas.has(p)))].sort(),
    invalidas: [...new Set(pedacos.filter((p) => !validas.has(p)))],
  };
}

/**
 * Quem já usa este nome (hoje ou antes), ignorando acento e maiúscula. O supervisor `ignorarId`
 * pode voltar a um nome que ele mesmo já teve.
 */
export function donoDoNome(
  supervisores: SupervisorCadastrado[],
  nome: string,
  ignorarId?: string,
): SupervisorCadastrado | null {
  const alvo = normalizaTexto(nome);
  return (
    supervisores.find(
      (s) => s.id !== ignorarId && [s.nome, ...(s.nomes_anteriores ?? [])].some((n) => normalizaTexto(n) === alvo),
    ) ?? null
  );
}

/** Estados já atendidos por OUTRO supervisor ativo do Agro (um estado tem um só responsável). */
export function ufsEmUso(
  supervisores: SupervisorCadastrado[],
  ufs: string[],
  ignorarId?: string,
): { uf: string; nome: string }[] {
  return ufs.flatMap((uf) => {
    const dono = supervisores.find(
      (s) => s.id !== ignorarId && s.categoria === "agro" && s.ativo && (s.ufs ?? []).includes(uf),
    );
    return dono ? [{ uf, nome: dono.nome }] : [];
  });
}

/** A lista de nomes antigos depois de uma troca de nome (sem repetir e sem o nome novo). */
export function nomesAnterioresApos(atual: SupervisorCadastrado, novoNome: string): string[] {
  const vistos = new Set([normalizaTexto(novoNome)]);
  const saida: string[] = [];
  for (const n of [...(atual.nomes_anteriores ?? []), atual.nome]) {
    const chave = normalizaTexto(n);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(n);
  }
  return saida;
}

/** Valor cru de um agrupamento por supervisor → nome atual (para somar os negócios do nome antigo). */
export function nomeAtualDe(supervisores: Pick<SupervisorCadastrado, "nome" | "nomes_anteriores">[], valor: string): string {
  const alvo = normalizaTexto(valor);
  if (supervisores.some((s) => normalizaTexto(s.nome) === alvo)) return valor;
  const dono = supervisores.find((s) => (s.nomes_anteriores ?? []).some((n) => normalizaTexto(n) === alvo));
  return dono ? dono.nome : valor;
}
