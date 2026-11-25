"use client";
/**
 * sfy (etapa 10) — bloco "Pós-venda" do negócio ganho: a situação da sequência (rastreio, "já
 * instalou?" aos 45 dias, manutenção aos 8 meses) e as ações do atendente. Só aparece quando o
 * negócio tem NF-e e entrou na sequência; sem pedido, nada é desenhado.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

interface Pedido {
  nfe_numero: string;
  situacao: "aguardando_link" | "ativa" | "pausada" | "cancelada" | "concluida";
  link_rastreio: string | null;
  situacao_rastreio: string;
  entregue_em: string | null;
  instalacao_confirmada_em: string | null;
  msg1_em: string | null;
  msg2_em: string | null;
  msg3_em: string | null;
  ultimo_erro: string;
}

type Acao = "pausar" | "retomar" | "cancelar" | "colar_link" | "liberar_sem_rastreio" | "instalacao_confirmada";

export function PosVendaDoNegocio({ leadId, podeAgir }: { leadId: string; podeAgir: boolean }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [link, setLink] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    return fetch(`/api/v1/sfy/pos-venda?lead_id=${encodeURIComponent(leadId)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPedido((j?.data?.pedido as Pedido | null) ?? null))
      .catch(() => undefined);
  }, [leadId]);

  useEffect(() => {
    // Adiado de propósito: é secundário e não pode ser a primeira chamada do dossiê.
    const adiado = setTimeout(() => void carregar(), 0);
    return () => clearTimeout(adiado);
  }, [carregar]);

  if (!pedido) return null;

  async function agir(acao: Acao, extra: Record<string, string> = {}) {
    setOcupado(true);
    try {
      const r = await fetch("/api/v1/sfy/pos-venda", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, acao, ...extra }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error?.message ?? t("Não foi possível concluir."));
        return;
      }
      setLink("");
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  const dia = (v: string | null) => (v ? new Date(v).toLocaleDateString(tag) : t("ainda não"));
  const rotulo: Record<Pedido["situacao"], string> = {
    aguardando_link: t("Aguardando o link de rastreio"),
    ativa: t("Em andamento"),
    pausada: t("Pausada"),
    cancelada: t("Cancelada"),
    concluida: t("Concluída"),
  };
  const parada = pedido.situacao === "pausada" || pedido.situacao === "cancelada" || pedido.situacao === "concluida";

  return (
    <section className="rounded-md border p-3 text-sm space-y-2" data-testid="pos-venda">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("Pós-venda do pedido")}</h3>
        <span className="text-muted-foreground">{rotulo[pedido.situacao]}</span>
      </div>
      <p className="text-muted-foreground">
        {t("NF-e")} {pedido.nfe_numero}
        {pedido.situacao_rastreio ? ` · ${pedido.situacao_rastreio}` : ""}
        {pedido.entregue_em ? ` · ${t("entregue em")} ${dia(pedido.entregue_em)}` : ""}
      </p>
      <ul className="space-y-0.5">
        <li>{t("Rastreio enviado")}: {dia(pedido.msg1_em)}</li>
        <li>{t("Pergunta da instalação")}: {dia(pedido.msg2_em)}{pedido.instalacao_confirmada_em ? ` · ${t("instalado em")} ${dia(pedido.instalacao_confirmada_em)}` : ""}</li>
        <li>{t("Lembrete de manutenção")}: {dia(pedido.msg3_em)}</li>
      </ul>
      {pedido.ultimo_erro ? <p className="text-destructive break-words">{pedido.ultimo_erro}</p> : null}
      {podeAgir ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!parada ? <Button size="sm" variant="outline" disabled={ocupado} onClick={() => agir("pausar")}>{t("Pausar")}</Button> : null}
          {pedido.situacao === "pausada" ? <Button size="sm" variant="outline" disabled={ocupado} onClick={() => agir("retomar")}>{t("Retomar")}</Button> : null}
          {!parada || pedido.situacao === "pausada" ? <Button size="sm" variant="outline" disabled={ocupado} onClick={() => agir("cancelar")}>{t("Cancelar")}</Button> : null}
          {!pedido.msg1_em && pedido.situacao !== "cancelada" ? (
            <>
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => agir("liberar_sem_rastreio")}>{t("Avisar sem rastreio")}</Button>
              <div className="flex w-full flex-wrap items-center gap-2">
                <Input className="min-w-0 flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("Colar o link de rastreio")} />
                <Button size="sm" disabled={ocupado || !link.trim()} onClick={() => agir("colar_link", { link: link.trim() })}>{t("Salvar link")}</Button>
              </div>
            </>
          ) : null}
          {pedido.msg1_em && !pedido.instalacao_confirmada_em && pedido.situacao === "ativa" ? (
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => agir("instalacao_confirmada")}>{t("Marcar como instalado")}</Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
