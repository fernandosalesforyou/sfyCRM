"use client";
/**
 * sfy (Bloco D) — lista dos fechamentos informados pelos parceiros. Cartões (cabem no celular).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { formatCents } from "@/lib/money";

const ROTA = "/api/v1/sfy/fechamentos";
const CHAVE = ["sfy", "fechamentos"] as const;

interface Pedido {
  id: string;
  lead_id: string;
  parceiro: string;
  negocio_titulo: string;
  negocio_status: string;
  valor_centavos: number;
  moeda: string;
  nota_fiscal: string;
  observacao: string;
  status: "pendente" | "tratado" | "recusado";
  criado_em: string;
}

export function PainelDeFechamentos({ podeTratar }: { podeTratar: boolean }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: { pedidos: Pedido[] } }>(ROTA)).data.pedidos,
  });
  const decidir = useMutation({
    mutationFn: (v: { id: string; status: "tratado" | "recusado" }) => apiClient.patch(ROTA, v),
    onSuccess: () => {
      toast.success(t("Pedido atualizado."));
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: showApiError,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (isError || !data) return <p className="text-sm text-destructive">{t("Erro ao carregar os fechamentos.")}</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{t("Nenhum fechamento informado ainda.")}</p>;

  const rotuloDoStatus = { pendente: t("Aguardando conferência"), tratado: t("Tratado"), recusado: t("Recusado") } as const;

  return (
    <div className="flex flex-col gap-3">
      {data.map((p) => (
        <Card key={p.id} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{p.parceiro}</span>
            <span className={`text-sm ${p.status === "pendente" ? "font-medium text-amber-700" : "text-muted-foreground"}`}>
              {rotuloDoStatus[p.status]}
            </span>
          </div>
          <div className="text-sm">
            {t("Negócio")}: {p.negocio_titulo || "—"}
          </div>
          <div className="text-sm tabular-nums">
            {t("Valor informado")}: {formatCents(p.valor_centavos, p.moeda || "BRL")} · {t("Nota")}: {p.nota_fiscal}
          </div>
          {p.observacao ? <div className="text-sm text-muted-foreground">{p.observacao}</div> : null}
          <div className="text-xs text-muted-foreground">{new Date(p.criado_em).toLocaleString(tag)}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/app/leads/${p.lead_id}`} className="inline-flex min-h-11 items-center text-sm underline">
              {t("Abrir negócio")}
            </Link>
            {podeTratar && p.status === "pendente" ? (
              <>
                <Button size="sm" className="min-h-11" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, status: "tratado" })}>
                  {t("Marcar como tratado")}
                </Button>
                <Button size="sm" variant="outline" className="min-h-11" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, status: "recusado" })}>
                  {t("Recusar")}
                </Button>
              </>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
