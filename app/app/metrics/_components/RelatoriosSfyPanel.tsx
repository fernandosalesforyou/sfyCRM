"use client";

/**
 * sfy (Bloco D) — relatórios do Desempenho: por parceiro, por supervisor, leads por período
 * (por categoria) e por origem. Só apresenta: as contas são do banco (migration 5006) e de
 * `lib/sfy/relatorios.ts`. Negócios criados no período; histórico importado fora por padrão.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useRelatorioSfy,
  type RelatorioDeCusto,
  type RelatorioPorDestino,
  type RelatorioPorOrigem,
  type RelatorioPorPeriodo,
  type TotalDoRelatorio,
} from "@/hooks/metrics/useRelatoriosSfy";
import { formatCents } from "@/lib/money";
import type { LinhaDestino } from "@/lib/sfy/relatorios";

type Visao = "parceiro" | "supervisor" | "periodo" | "origem" | "custo";
const DIAS = ["30", "60", "90"] as const;

function dia(offsetDias: number): string {
  const d = new Date(Date.now() - offsetDias * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function baixarCsv(nome: string, linhas: string[][]) {
  const texto = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** No celular a linha vira um cartão "Rótulo valor" (o mesmo padrão da tabela por atendente). */
const CELULA = "text-right tabular-nums max-md:p-0 max-md:text-left max-md:before:mr-1 max-md:before:text-muted-foreground max-md:before:content-[attr(data-rotulo)]";
const LINHA = "max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:py-2";

type Ordem = "leads" | "ganhos" | "percentual_fechamento" | "grupo";

export function RelatoriosSfyPanel() {
  const t = useT();
  const tag = useTagDeIdioma();
  const [visao, setVisao] = useState<Visao>("parceiro");
  const [dias, setDias] = useState<(typeof DIAS)[number]>("30");
  const [historico, setHistorico] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>("leads");
  const [granularidade, setGranularidade] = useState("dia");

  const base = { de: dia(Number(dias) - 1), ate: dia(0), historico: historico ? "1" : "0" };
  const destino = useRelatorioSfy<RelatorioPorDestino>(
    { tipo: "destino", agrupar: visao === "supervisor" ? "supervisor" : "parceiro", ...base },
    visao === "parceiro" || visao === "supervisor",
  );
  const periodo = useRelatorioSfy<RelatorioPorPeriodo>({ tipo: "periodo", granularidade, ...base }, visao === "periodo");
  const origem = useRelatorioSfy<RelatorioPorOrigem>({ tipo: "origem", ...base }, visao === "origem");
  const custo = useRelatorioSfy<RelatorioDeCusto>({ tipo: "custo", ...base }, visao === "custo");

  const n = (v: number) => v.toLocaleString(tag);
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString(tag, { maximumFractionDigits: 1 })}%`);
  const valor = (m: Record<string, number>) => {
    const itens = Object.entries(m);
    return itens.length === 0 ? "—" : itens.map(([moeda, c]) => formatCents(c, moeda || "BRL")).join(" + ");
  };
  const rotuloVazio = (v: Visao) =>
    v === "parceiro" ? t("Sem parceiro") : v === "supervisor" ? t("Sem supervisor") : t("Sem identificação");

  const ordenar = (linhas: LinhaDestino[]) =>
    [...linhas].sort((a, b) => {
      if (ordem === "grupo") return (a.rotulo ?? a.grupo).localeCompare(b.rotulo ?? b.grupo, tag);
      const va = a[ordem] ?? -1;
      const vb = b[ordem] ?? -1;
      return (vb as number) - (va as number);
    });

  function tabelaDeDestino(linhas: LinhaDestino[], total: TotalDoRelatorio, rotuloGrupo: string, v: Visao) {
    const ordenadas = ordenar(linhas);
    return (
      <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select value={ordem} onValueChange={(o) => setOrdem(o as Ordem)}>
            <SelectTrigger className="w-48" aria-label={t("Ordenar por")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="leads">{t("Mais negócios")}</SelectItem>
              <SelectItem value="ganhos">{t("Mais ganhos")}</SelectItem>
              <SelectItem value="percentual_fechamento">{t("Maior % de fechamento")}</SelectItem>
              <SelectItem value="grupo">{t("Nome")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              baixarCsv(`relatorio-${v}-${base.de}-${base.ate}.csv`, [
                [rotuloGrupo, t("Negócios"), t("Em aberto"), t("Ganhos"), t("Perdidos"), t("% de fechamento"), t("Valor fechado"), t("Mediana de dias até ganhar")],
                ...ordenadas.map((l) => [
                  (l.rotulo ?? l.grupo) || rotuloVazio(v), String(l.leads), String(l.abertos), String(l.ganhos), String(l.perdidos),
                  pct(l.percentual_fechamento), valor(l.valor_ganho_por_moeda),
                  l.mediana_dias_ate_ganho === null ? "—" : l.mediana_dias_ate_ganho.toLocaleString(tag, { maximumFractionDigits: 1 }),
                ]),
              ])
            }
          >
            {t("Exportar CSV")}
          </Button>
        </div>
        <Table className="max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow>
              <TableHead>{rotuloGrupo}</TableHead>
              <TableHead className="text-right">{t("Negócios")}</TableHead>
              <TableHead className="text-right">{t("Em aberto")}</TableHead>
              <TableHead className="text-right">{t("Ganhos")}</TableHead>
              <TableHead className="text-right">{t("Perdidos")}</TableHead>
              <TableHead className="text-right">{t("% de fechamento")}</TableHead>
              <TableHead className="text-right">{t("Valor fechado")}</TableHead>
              <TableHead className="text-right">{t("Mediana de dias até ganhar")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {ordenadas.map((l) => (
              <TableRow key={l.grupo} className={LINHA}>
                <TableCell className={`max-md:col-span-2 max-md:p-0 max-md:font-medium ${l.grupo ? "" : "text-muted-foreground"}`}>{(l.rotulo ?? l.grupo) || rotuloVazio(v)}</TableCell>
                <TableCell data-rotulo={t("Negócios")} className={CELULA}>{n(l.leads)}</TableCell>
                <TableCell data-rotulo={t("Em aberto")} className={CELULA}>{n(l.abertos)}</TableCell>
                <TableCell data-rotulo={t("Ganhos")} className={CELULA}>{n(l.ganhos)}</TableCell>
                <TableCell data-rotulo={t("Perdidos")} className={CELULA}>{n(l.perdidos)}</TableCell>
                <TableCell data-rotulo={t("% de fechamento")} className={CELULA}>{pct(l.percentual_fechamento)}</TableCell>
                <TableCell data-rotulo={t("Valor fechado")} className={CELULA}>{valor(l.valor_ganho_por_moeda)}</TableCell>
                <TableCell data-rotulo={t("Mediana de dias até ganhar")} className={`${CELULA} max-md:col-span-2`}>
                  {l.mediana_dias_ate_ganho === null ? "—" : l.mediana_dias_ate_ganho.toLocaleString(tag, { maximumFractionDigits: 1 })}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className={`font-medium ${LINHA}`}>
              <TableCell className="max-md:col-span-2 max-md:p-0">{t("Total")}</TableCell>
              <TableCell data-rotulo={t("Negócios")} className={CELULA}>{n(total.leads)}</TableCell>
              <TableCell data-rotulo={t("Em aberto")} className={CELULA}>{n(total.abertos)}</TableCell>
              <TableCell data-rotulo={t("Ganhos")} className={CELULA}>{n(total.ganhos)}</TableCell>
              <TableCell data-rotulo={t("Perdidos")} className={CELULA}>{n(total.perdidos)}</TableCell>
              <TableCell data-rotulo={t("% de fechamento")} className={CELULA}>{pct(total.percentual_fechamento)}</TableCell>
              <TableCell data-rotulo={t("Valor fechado")} className={CELULA}>{valor(total.valor_ganho_por_moeda)}</TableCell>
              <TableCell className="max-md:hidden" />
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  }

  const ativo = visao === "periodo" ? periodo : visao === "origem" ? origem : visao === "custo" ? custo : destino;

  let corpo: React.ReactNode = null;
  if (ativo.isLoading) {
    corpo = <Skeleton className="h-48 w-full" aria-busy="true" />;
  } else if (ativo.isError || !ativo.data) {
    corpo = <p className="text-sm text-destructive">{t("Erro ao carregar o relatório.")}</p>;
  } else if (visao === "parceiro" || visao === "supervisor") {
    const d = destino.data as RelatorioPorDestino;
    corpo = (
      <>
        {!d.campo_encontrado ? (
          <p className="mb-2 text-sm text-muted-foreground">
            {t("O funil ainda não tem o campo deste agrupamento: todos os negócios aparecem juntos.")}
          </p>
        ) : null}
        {tabelaDeDestino(d.linhas, d.total, visao === "parceiro" ? t("Parceiro") : t("Supervisor"), visao)}
      </>
    );
  } else if (visao === "custo") {
    const c = custo.data as RelatorioDeCusto;
    const dinheiro = (cents: number | null, moeda: string) => (cents === null ? "—" : formatCents(Math.round(cents), moeda || "BRL"));
    const razao = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(tag, { maximumFractionDigits: 2 })}x`);
    const semGasto = c.linhas.every((l) => l.gasto_centavos === 0);
    const linhaDoCusto = (l: (typeof c.linhas)[number]) => {
      const nome = l.campanha_id === "" ? t("Sem campanha identificada") : l.campanha_nome || l.campanha_id;
      return (
        <TableRow key={`${l.plataforma}-${l.campanha_id}`} className={LINHA}>
          <TableCell className={`max-md:col-span-2 max-md:p-0 max-md:font-medium ${l.campanha_id === "" ? "text-muted-foreground" : ""}`}>{nome}</TableCell>
          <TableCell data-rotulo={t("Gasto")} className={CELULA}>{l.campanha_id === "" ? "—" : dinheiro(l.gasto_centavos, l.moeda)}</TableCell>
          <TableCell data-rotulo={t("Leads")} className={CELULA}>{n(l.leads)}</TableCell>
          <TableCell data-rotulo={t("Custo por lead")} className={CELULA}>{dinheiro(l.custo_por_lead_centavos, l.moeda)}</TableCell>
          <TableCell data-rotulo={t("Oportunidades")} className={CELULA}>{n(l.oportunidades)}</TableCell>
          <TableCell data-rotulo={t("Custo por oportunidade")} className={CELULA}>{dinheiro(l.custo_por_oportunidade_centavos, l.moeda)}</TableCell>
          <TableCell data-rotulo={t("Ganhos")} className={CELULA}>{n(l.ganhos)}</TableCell>
          <TableCell data-rotulo={t("Retorno")} className={CELULA}>{razao(l.retorno)}</TableCell>
        </TableRow>
      );
    };
    corpo = (
      <>
        {semGasto ? (
          <p className="mb-2 text-sm text-muted-foreground">
            {t("Nenhum gasto de anúncio guardado neste período. A leitura diária do gasto é ligada na entrega.")}
          </p>
        ) : null}
        <Table className="max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow>
              <TableHead>{t("Campanha")}</TableHead>
              <TableHead className="text-right">{t("Gasto")}</TableHead>
              <TableHead className="text-right">{t("Leads")}</TableHead>
              <TableHead className="text-right">{t("Custo por lead")}</TableHead>
              <TableHead className="text-right">{t("Oportunidades")}</TableHead>
              <TableHead className="text-right">{t("Custo por oportunidade")}</TableHead>
              <TableHead className="text-right">{t("Ganhos")}</TableHead>
              <TableHead className="text-right">{t("Retorno")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {c.linhas.map(linhaDoCusto)}
            <TableRow className={`font-medium ${LINHA}`}>
              <TableCell className="max-md:col-span-2 max-md:p-0">{t("Total")}</TableCell>
              <TableCell data-rotulo={t("Gasto")} className={CELULA}>{dinheiro(c.total.gasto_centavos, c.total.moeda)}</TableCell>
              <TableCell data-rotulo={t("Leads")} className={CELULA}>{n(c.total.leads)}</TableCell>
              <TableCell data-rotulo={t("Custo por lead")} className={CELULA}>{dinheiro(c.total.custo_por_lead_centavos, c.total.moeda)}</TableCell>
              <TableCell data-rotulo={t("Oportunidades")} className={CELULA}>{n(c.total.oportunidades)}</TableCell>
              <TableCell data-rotulo={t("Custo por oportunidade")} className={CELULA}>{dinheiro(c.total.custo_por_oportunidade_centavos, c.total.moeda)}</TableCell>
              <TableCell data-rotulo={t("Ganhos")} className={CELULA}>{n(c.total.ganhos)}</TableCell>
              <TableCell data-rotulo={t("Retorno")} className={CELULA}>{razao(c.total.retorno)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  } else if (visao === "origem") {
    const o = origem.data as RelatorioPorOrigem;
    corpo = tabelaDeDestino(o.linhas, o.total, t("Origem"), "origem");
  } else {
    const p = periodo.data as RelatorioPorPeriodo;
    corpo = (
      <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select value={granularidade} onValueChange={setGranularidade}>
            <SelectTrigger className="w-32" aria-label={t("Granularidade")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dia">{t("Dia")}</SelectItem>
              <SelectItem value="semana">{t("Semana")}</SelectItem>
              <SelectItem value="mes">{t("Mês")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("Negócios criados no período")}: {n(p.total)}
          </span>
        </div>
        <Table className="max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow>
              <TableHead>{t("Período")}</TableHead>
              {p.categorias.map((c) => (
                <TableHead key={c} className="text-right">{c || t("Sem categoria")}</TableHead>
              ))}
              <TableHead className="text-right">{t("Total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {p.baldes.map((b) => (
              <TableRow key={b} className={LINHA}>
                <TableCell className="max-md:col-span-2 max-md:p-0 max-md:font-medium">{new Date(`${b}T00:00:00`).toLocaleDateString(tag)}</TableCell>
                {p.categorias.map((c) => (
                  <TableCell key={c} data-rotulo={c || t("Sem categoria")} className={CELULA}>{n(p.matriz[b]?.[c] ?? 0)}</TableCell>
                ))}
                <TableCell data-rotulo={t("Total")} className={CELULA}>
                  {n(p.categorias.reduce((s, c) => s + (p.matriz[b]?.[c] ?? 0), 0))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("Relatórios da operação")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={visao} onValueChange={(v) => setVisao(v as Visao)}>
            <SelectTrigger className="w-52" aria-label={t("Relatório")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="parceiro">{t("Por parceiro")}</SelectItem>
              <SelectItem value="supervisor">{t("Por supervisor")}</SelectItem>
              <SelectItem value="periodo">{t("Leads por período e categoria")}</SelectItem>
              <SelectItem value="origem">{t("Por origem")}</SelectItem>
              <SelectItem value="custo">{t("Custo por campanha")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dias} onValueChange={(v) => setDias(v as (typeof DIAS)[number])}>
            <SelectTrigger className="w-40" aria-label={t("Período")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIAS.map((d) => (
                <SelectItem key={d} value={d}>{t("Últimos")} {d} {t("dias")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" className="size-4 max-md:size-11" checked={historico} onChange={(e) => setHistorico(e.target.checked)} />
            {t("Incluir histórico importado")}
          </label>
        </div>
      </CardHeader>
      <CardContent>{corpo}</CardContent>
    </Card>
  );
}
