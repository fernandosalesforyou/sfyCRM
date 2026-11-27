"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * sfy — quem entra como "Somente leitura" não deve ver botão que o servidor vai
 * recusar. É apresentação: quem autoriza continua sendo cada rota e a RLS.
 *
 * Contexto próprio, com padrão `false`: tela montada sem o provedor (testes,
 * prévias) se comporta como antes.
 */
const Contexto = createContext(false);

export function ProvedorSoConsulta({ soConsulta, children }: { soConsulta: boolean; children: ReactNode }) {
  return <Contexto.Provider value={soConsulta}>{children}</Contexto.Provider>;
}

export function useSoConsulta(): boolean {
  return useContext(Contexto);
}
