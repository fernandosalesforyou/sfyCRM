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
  type RelatorioPorDestino,
  type RelatorioPorOrigem,
  type RelatorioPorPeriodo,
  type TotalDoRelatorio,
} from "@/hooks/metrics/useRelatoriosSfy";
import { formatCents } from "@/lib/money";
import type { LinhaDestino } from "@/lib/sfy/relatorios";

type Visao = "parceiro" | "supervisor" | "periodo" | "origem";
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
        <Table>
          <TableHeader>
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
          <TableBody>
            {ordenadas.map((l) => (
              <TableRow key={l.grupo}>
                <TableCell className={l.grupo ? "" : "text-muted-foreground"}>{(l.rotulo ?? l.grupo) || rotuloVazio(v)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(l.leads)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(l.abertos)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(l.ganhos)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(l.perdidos)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.percentual_fechamento)}</TableCell>
                <TableCell className="text-right tabular-nums">{valor(l.valor_ganho_por_moeda)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.mediana_dias_ate_ganho === null ? "—" : l.mediana_dias_ate_ganho.toLocaleString(tag, { maximumFractionDigits: 1 })}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-medium">
              <TableCell>{t("Total")}</TableCell>
              <TableCell className="text-right tabular-nums">{n(total.leads)}</TableCell>
              <TableCell className="text-right tabular-nums">{n(total.abertos)}</TableCell>
              <TableCell className="text-right tabular-nums">{n(total.ganhos)}</TableCell>
              <TableCell className="text-right tabular-nums">{n(total.perdidos)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(total.percentual_fechamento)}</TableCell>
              <TableCell className="text-right tabular-nums">{valor(total.valor_ganho_por_moeda)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  }

  const ativo = visao === "periodo" ? periodo : visao === "origem" ? origem : destino;

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Período")}</TableHead>
              {p.categorias.map((c) => (
                <TableHead key={c} className="text-right">{c || t("Sem categoria")}</TableHead>
              ))}
              <TableHead className="text-right">{t("Total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.baldes.map((b) => (
              <TableRow key={b}>
                <TableCell>{new Date(`${b}T00:00:00`).toLocaleDateString(tag)}</TableCell>
                {p.categorias.map((c) => (
                  <TableCell key={c} className="text-right tabular-nums">{n(p.matriz[b]?.[c] ?? 0)}</TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
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
            <input type="checkbox" checked={historico} onChange={(e) => setHistorico(e.target.checked)} />
            {t("Incluir histórico importado")}
          </label>
        </div>
      </CardHeader>
      <CardContent>{corpo}</CardContent>
    </Card>
  );
}
