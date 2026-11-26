"use client";
/** sfy (fork Sales for You, etapa 7B) — tipos e peças usados pelas duas seções da tela de parceiros. */
import { useState } from "react";

import { Input } from "@/components/ui/input";
import type { Situacao } from "@/lib/sfy/cadastro";

export const CAMPO = "min-h-11 w-full rounded-md border bg-background px-2 text-sm";

export interface Supervisor {
  id: string;
  nome: string;
  categoria: "climabrisa" | "agro";
  whatsapp: string | null;
  email: string | null;
  user_id: string | null;
  ufs: string[];
  padrao: boolean;
  ativo: boolean;
}
export type Edicao = { tipo: "parceiro" | "supervisor"; id: string } & Partial<{
  whatsapp: string | null;
  email: string | null;
  ativo: boolean;
  supervisor_id: string | null;
  nome: string;
  situacao: Situacao;
  padrao: boolean;
  ufs: string[];
  substituto_id: string | null;
}>;
export function Contato({
  valor,
  rotulo,
  desabilitado,
  aoSalvar,
}: {
  valor: string | null;
  rotulo: string;
  desabilitado: boolean;
  aoSalvar: (novo: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor ?? "");
  return (
    <Input
      className="min-h-11"
      value={texto}
      aria-label={rotulo}
      disabled={desabilitado}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const novo = texto.trim() || null;
        if (novo !== (valor ?? null)) aoSalvar(novo);
      }}
    />
  );
}
