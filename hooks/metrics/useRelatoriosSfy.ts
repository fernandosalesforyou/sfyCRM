"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { LinhaDestino, SeriePorPeriodo } from "@/lib/sfy/relatorios";

export type TotalDoRelatorio = Omit<LinhaDestino, "grupo" | "mediana_dias_ate_ganho">;

export interface RelatorioPorDestino {
  janela: { de: string; ate: string };
  campo_encontrado: boolean;
  linhas: LinhaDestino[];
  total: TotalDoRelatorio;
}
export interface RelatorioPorOrigem {
  janela: { de: string; ate: string };
  linhas: LinhaDestino[];
  total: TotalDoRelatorio;
}
export interface RelatorioPorPeriodo extends SeriePorPeriodo {
  janela: { de: string; ate: string };
  campo_encontrado: boolean;
  origens: Array<{ origem: string; leads: number }>;
}

/** Os relatórios do Bloco D: `GET /api/v1/sfy/relatorios` (manager+). */
export function useRelatorioSfy<T>(parametros: Record<string, string>, habilitado = true) {
  const query = new URLSearchParams(parametros).toString();
  return useQuery({
    queryKey: ["sfy", "relatorios", query],
    queryFn: async () => (await apiClient.get<{ data: T }>(`/api/v1/sfy/relatorios?${query}`)).data,
    staleTime: 30_000,
    enabled: habilitado,
  });
}
