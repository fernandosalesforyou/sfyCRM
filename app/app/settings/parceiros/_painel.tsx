"use client";
/**
 * sfy (fork Sales for You, Bloco C) — painel de parceiros e supervisores.
 * Cada linha edita WhatsApp, e-mail, ativo (e o supervisor, no parceiro) e salva ao sair do campo.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

const ROTA = "/api/v1/sfy/parceiros";
const CHAVE = ["sfy", "parceiros"] as const;

interface Supervisor {
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
interface Parceiro {
  id: string;
  codigo: string;
  nome: string;
  whatsapp: string | null;
  email: string | null;
  supervisor_id: string | null;
  ativo: boolean;
  cidades: number;
}
interface Dados {
  supervisores: Supervisor[];
  parceiros: Parceiro[];
}
type Edicao = { tipo: "parceiro" | "supervisor"; id: string } & Partial<{
  whatsapp: string | null;
  email: string | null;
  ativo: boolean;
  supervisor_id: string | null;
}>;

function Contato({
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

export function PainelDeParceiros({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [soSemContato, setSoSemContato] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Dados }>(ROTA)).data,
  });

  const salvar = useMutation({
    mutationFn: (e: Edicao) => apiClient.put(ROTA, e),
    onSuccess: () => {
      toast.success(t("Cadastro atualizado."));
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      showApiError(e);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
  });

  const supervisoresClima = useMemo(() => (data?.supervisores ?? []).filter((s) => s.categoria === "climabrisa"), [data]);
  const parceiros = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.parceiros ?? []).filter((p) => {
      if (soSemContato && (p.whatsapp || p.email)) return false;
      return !termo || `${p.codigo} ${p.nome}`.toLowerCase().includes(termo);
    });
  }, [data, busca, soSemContato]);
  const semContato = (data?.parceiros ?? []).filter((p) => !p.whatsapp && !p.email).length;

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">{t("Carregando...")}</p>;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("Supervisores")}</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">{t("Nome")}</th>
                <th className="p-3">{t("Área")}</th>
                <th className="p-3">{t("WhatsApp")}</th>
                <th className="p-3">{t("E-mail")}</th>
                <th className="p-3">{t("Usuário no CRM")}</th>
              </tr>
            </thead>
            <tbody>
              {data.supervisores.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-3 font-medium">{s.nome}</td>
                  <td className="p-3">
                    {s.categoria === "agro"
                      ? s.padrao
                        ? t("Agro: demais estados")
                        : `${t("Agro")}: ${s.ufs.join(", ")}`
                      : t("Climabrisa")}
                  </td>
                  <td className="p-3">
                    <Contato valor={s.whatsapp} rotulo={`${t("WhatsApp")}: ${s.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "supervisor", id: s.id, whatsapp: v })} />
                  </td>
                  <td className="p-3">
                    <Contato valor={s.email} rotulo={`${t("E-mail")}: ${s.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "supervisor", id: s.id, email: v })} />
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{s.user_id ? t("Ligado") : t("Ainda não ligado")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">{t("Parceiros")}</h2>
          <span className="text-xs text-muted-foreground">
            {data.parceiros.length} {t("parceiros")} · {semContato} {t("sem nenhum contato")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Input className="max-w-xs" placeholder={t("Buscar por código ou nome")} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={soSemContato} onChange={(e) => setSoSemContato(e.target.checked)} />
            {t("Só sem contato")}
          </label>
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">{t("Código")}</th>
                <th className="p-3">{t("Nome")}</th>
                <th className="p-3">{t("Cidades")}</th>
                <th className="p-3">{t("Supervisor")}</th>
                <th className="p-3">{t("WhatsApp")}</th>
                <th className="p-3">{t("E-mail")}</th>
                <th className="p-3">{t("Ativo")}</th>
              </tr>
            </thead>
            <tbody>
              {parceiros.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.codigo}</td>
                  <td className="p-3">{p.nome}</td>
                  <td className="p-3">{p.cidades}</td>
                  <td className="p-3">
                    <select
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      aria-label={`${t("Supervisor")}: ${p.nome}`}
                      value={p.supervisor_id ?? ""}
                      disabled={!podeEditar || salvar.isPending}
                      onChange={(e) => salvar.mutate({ tipo: "parceiro", id: p.id, supervisor_id: e.target.value || null })}
                    >
                      <option value="">{t("Sem supervisor")}</option>
                      {supervisoresClima.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <Contato valor={p.whatsapp} rotulo={`${t("WhatsApp")}: ${p.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "parceiro", id: p.id, whatsapp: v })} />
                  </td>
                  <td className="p-3">
                    <Contato valor={p.email} rotulo={`${t("E-mail")}: ${p.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "parceiro", id: p.id, email: v })} />
                  </td>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={p.ativo}
                      aria-label={`${t("Ativo")}: ${p.nome}`}
                      disabled={!podeEditar || salvar.isPending}
                      onChange={(e) => salvar.mutate({ tipo: "parceiro", id: p.id, ativo: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
