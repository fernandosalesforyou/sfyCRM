"use client";
/**
 * sfy (fork Sales for You, Bloco C e etapa 7B) — painel de parceiros e supervisores.
 *
 * O CRM é a fonte de verdade dos parceiros: aqui a Mariana cria, renomeia, certifica, pausa e dá
 * saída; edita as cidades de cada um (da lista do IBGE) e confere "para quem vai este lead?" sem
 * gastar a vez do rodízio. Cada parceiro é um cartão (cabe no celular); os campos de texto salvam
 * ao sair do campo e a situação, ao escolher.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { SITUACOES, situacaoDosCampos, type ImpactoDasCidades, type Situacao } from "@/lib/sfy/cadastro";
import type { DestinoEscolhido } from "@/lib/sfy/distribuicao";

const ROTA = "/api/v1/sfy/parceiros";
const CHAVE = ["sfy", "parceiros"] as const;
const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI",
  "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

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
  certificado: boolean;
  recebe_leads: boolean;
  cidades: number;
}
interface Dados {
  supervisores: Supervisor[];
  parceiros: Parceiro[];
  municipios_carregados: boolean;
}
type Edicao = { tipo: "parceiro" | "supervisor"; id: string } & Partial<{
  whatsapp: string | null;
  email: string | null;
  ativo: boolean;
  supervisor_id: string | null;
  nome: string;
  situacao: Situacao;
  padrao: boolean;
}>;
interface CidadeDoParceiro {
  uf: string;
  cidade_norm: string;
  nome: string;
  codigo_ibge: number | null;
}
type Filtro = "todos" | "recebem" | "pausados" | "nao_certificados" | "sairam" | "sem_contato" | "sem_supervisor";

const CAMPO = "min-h-11 w-full rounded-md border bg-background px-2 text-sm";

function rotuloDaSituacao(s: Situacao, t: (x: string) => string): string {
  switch (s) {
    case "certificado_recebe":
      return t("Certificado, recebe leads");
    case "certificado_pausado":
      return t("Certificado, não passar leads");
    case "nao_certificado":
      return t("Não é certificado");
    case "saiu":
      return t("Saiu da empresa");
  }
}

function textoDoDestino(d: DestinoEscolhido, t: (x: string) => string): string {
  switch (d.motivo) {
    case "parceiro_unico":
      return t("Único parceiro da cidade.");
    case "rodizio":
      return t("Rodízio entre os parceiros da cidade: este é o próximo.");
    case "supervisor_da_cidade":
      return t("Cidade sem parceiro que receba: vai ao supervisor da região.");
    case "supervisor_padrao":
      return t("Cidade fora das listas: vai ao supervisor padrão.");
    case "agro_por_uf":
      return t("Agro: supervisor do estado.");
    default:
      return t("Sem destino: a equipe decide.");
  }
}

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

/** "Para quem vai este lead?": simula o destino, sem gastar a vez do rodízio. */
function Simulador() {
  const t = useT();
  const [categoria, setCategoria] = useState<"climabrisa" | "agro">("climabrisa");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const consulta = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({ categoria, cidade: cidade.trim(), uf });
      return (await apiClient.get<{ data: { destino: DestinoEscolhido } }>(`/api/v1/sfy/destino?${q.toString()}`)).data.destino;
    },
    onError: showApiError,
  });
  const d = consulta.data;
  const pronto = (categoria === "agro" || cidade.trim().length > 0) && uf.length === 2;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("Para quem vai este lead?")}</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("Confere o destino sem gastar a vez do rodízio e sem criar nada.")}
      </p>
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr_6rem_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("Categoria")}
            <select className={CAMPO} value={categoria} onChange={(e) => setCategoria(e.target.value as "climabrisa" | "agro")}>
              <option value="climabrisa">{t("Climabrisa")}</option>
              <option value="agro">{t("Agro")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("Cidade")}
            <Input className="min-h-11" value={cidade} onChange={(e) => setCidade(e.target.value)} disabled={categoria === "agro"} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("UF")}
            <select className={CAMPO} value={uf} onChange={(e) => setUf(e.target.value)}>
              <option value="">{t("UF")}</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" className="min-h-11" disabled={!pronto || consulta.isPending} onClick={() => consulta.mutate()}>
            {t("Ver destino")}
          </Button>
        </div>
        {d && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm" role="status">
            <p className="font-medium">{textoDoDestino(d, t)}</p>
            {d.parceiro_nome && (
              <p>
                {t("Parceiro")}: {d.parceiro_codigo} · {d.parceiro_nome}
              </p>
            )}
            {d.supervisor_nome && (
              <p>
                {t("Supervisor")}: {d.supervisor_nome}
              </p>
            )}
            {d.elegiveis && d.elegiveis.length > 1 && (
              <p className="text-muted-foreground">
                {t("Ordem do rodízio")}: {d.elegiveis.map((e) => e.codigo).join(" → ")}
              </p>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

/** Cria um parceiro: nasce sem receber lead até alguém escolher a situação. */
function NovoParceiro({ supervisores, aoCriar }: { supervisores: Supervisor[]; aoCriar: () => void }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const criar = useMutation({
    mutationFn: () =>
      apiClient.post(ROTA, { codigo: codigo.trim(), nome: nome.trim(), supervisor_id: supervisorId || null }),
    onSuccess: () => {
      toast.success(t("Parceiro criado."));
      setCodigo("");
      setNome("");
      setSupervisorId("");
      setAberto(false);
      aoCriar();
    },
    onError: showApiError,
  });
  if (!aberto) {
    return (
      <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => setAberto(true)}>
        {t("Novo parceiro")}
      </Button>
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Código")}
          <Input className="min-h-11" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
          {t("Nome")}
          <Input className="min-h-11" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
          {t("Supervisor")}
          <select className={CAMPO} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            <option value="">{t("Sem supervisor")}</option>
            {supervisores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("O parceiro novo começa como \"Não é certificado\" e só recebe lead depois que você escolher a situação.")}
      </p>
      <div className="flex gap-2">
        <Button type="button" className="min-h-11" disabled={!codigo.trim() || !nome.trim() || criar.isPending} onClick={() => criar.mutate()}>
          {t("Criar parceiro")}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setAberto(false)}>
          {t("Cancelar")}
        </Button>
      </div>
    </Card>
  );
}

/** As cidades de um parceiro: lista, busca no IBGE e troca com aviso do impacto. */
function EditorDeCidades({ parceiro, podeEditar, municipiosCarregados }: { parceiro: Parceiro; podeEditar: boolean; municipiosCarregados: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const rota = `${ROTA}/${parceiro.id}/cidades`;
  const [uf, setUf] = useState("");
  const [q, setQ] = useState("");

  const atuais = useQuery({
    queryKey: ["sfy", "parceiro-cidades", parceiro.id],
    queryFn: async () => (await apiClient.get<{ data: { cidades: CidadeDoParceiro[] } }>(rota)).data.cidades,
  });
  const achadas = useQuery({
    queryKey: ["sfy", "municipios", uf, q],
    enabled: uf.length === 2 && municipiosCarregados,
    queryFn: async () =>
      (await apiClient.get<{ data: { municipios: { codigo_ibge: number; nome: string; uf: string }[] } }>(
        `/api/v1/sfy/municipios?uf=${uf}&q=${encodeURIComponent(q)}`,
      )).data.municipios,
  });

  const trocar = useMutation({
    mutationFn: (corpo: { adicionar?: number[]; remover?: number[]; remover_nomes?: { uf: string; cidade_norm: string }[] }) =>
      apiClient.put<{ data: ImpactoDasCidades & { recalculo?: { erro?: string } } }>(rota, corpo),
    onSuccess: (r) => {
      toast.success(t("Cidades atualizadas."));
      const i = r.data;
      if (i.recalculo?.erro) toast.warning(t("Salvo, mas o supervisor das cidades não foi recalculado. Tente de novo."));
      if (i.entram_em_rodizio > 0) {
        toast.info(`${i.entram_em_rodizio} ${t("cidades passam a ter mais de um parceiro (rodízio).")}`);
      }
      if (i.ficam_sem_parceiro > 0) {
        toast.warning(`${i.ficam_sem_parceiro} ${t("cidades ficaram sem parceiro e vão para o supervisor.")}`);
      }
      void qc.invalidateQueries({ queryKey: ["sfy", "parceiro-cidades", parceiro.id] });
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: showApiError,
  });

  const jaTem = new Set((atuais.data ?? []).map((c) => `${c.uf}|${c.cidade_norm}`));

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <h3 className="text-sm font-medium">{t("Cidades atendidas")}</h3>
      <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto" aria-label={t("Cidades atendidas")}>
        {(atuais.data ?? []).length === 0 && !atuais.isLoading && (
          <p className="text-sm text-muted-foreground">{t("Nenhuma cidade ainda.")}</p>
        )}
        {(atuais.data ?? []).map((c) => (
          <span key={`${c.uf}|${c.cidade_norm}`} className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-muted/40 pl-3 text-xs">
            {c.nome} · {c.uf}
            {podeEditar && (
              <button
                type="button"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full hover:bg-muted"
                aria-label={`${t("Remover")}: ${c.nome}`}
                disabled={trocar.isPending}
                onClick={() =>
                  trocar.mutate(c.codigo_ibge ? { remover: [c.codigo_ibge] } : { remover_nomes: [{ uf: c.uf, cidade_norm: c.cidade_norm }] })
                }
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {podeEditar && (
        <div className="flex flex-col gap-2">
          {!municipiosCarregados ? (
            <p className="text-sm text-muted-foreground">{t("A lista de municípios do IBGE ainda não foi carregada.")}</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
                <select className={CAMPO} aria-label={t("UF")} value={uf} onChange={(e) => setUf(e.target.value)}>
                  <option value="">{t("UF")}</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <Input className="min-h-11" placeholder={t("Buscar cidade")} value={q} onChange={(e) => setQ(e.target.value)} disabled={!uf} />
              </div>
              {uf && achadas.data && achadas.data.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("Nenhuma cidade encontrada.")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(achadas.data ?? []).map((m) => {
                  const tem = jaTem.has(`${m.uf}|${m.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}`);
                  return (
                    <Button
                      key={m.codigo_ibge}
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={tem || trocar.isPending}
                      onClick={() => trocar.mutate({ adicionar: [m.codigo_ibge] })}
                    >
                      {tem ? "✓ " : "+ "}
                      {m.nome}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PainelDeParceiros({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Dados }>(ROTA)).data,
  });

  const salvar = useMutation({
    mutationFn: (e: Edicao) => apiClient.put<{ data: { recalculo?: { erro?: string } | null; opcoes?: { erro?: string } | null } }>(ROTA, e),
    onSuccess: (r) => {
      toast.success(t("Cadastro atualizado."));
      if (r.data.recalculo?.erro) toast.warning(t("Salvo, mas o supervisor das cidades não foi recalculado. Tente de novo."));
      if (r.data.opcoes?.erro) toast.warning(t("Salvo, mas a lista de parceiros dos negócios não foi atualizada. Tente de novo."));
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
      const s = situacaoDosCampos(p);
      if (filtro === "recebem" && s !== "certificado_recebe") return false;
      if (filtro === "pausados" && s !== "certificado_pausado") return false;
      if (filtro === "nao_certificados" && s !== "nao_certificado") return false;
      if (filtro === "sairam" && s !== "saiu") return false;
      if (filtro === "sem_contato" && (p.whatsapp || p.email)) return false;
      if (filtro === "sem_supervisor" && p.supervisor_id) return false;
      return !termo || `${p.codigo} ${p.nome}`.toLowerCase().includes(termo);
    });
  }, [data, busca, filtro]);

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">{t("Carregando...")}</p>;

  const todos = data.parceiros;
  const contagem = {
    recebem: todos.filter((p) => situacaoDosCampos(p) === "certificado_recebe").length,
    semContato: todos.filter((p) => !p.whatsapp && !p.email).length,
  };
  const alterna = (id: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-8">
      <Simulador />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("Supervisores")}</h2>
        <div className="flex flex-col gap-3">
          {data.supervisores.map((s) => (
            <Card key={s.id} className="grid gap-3 p-4 sm:grid-cols-[12rem_1fr_1fr_auto] sm:items-end">
              <div>
                <p className="font-medium">{s.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {s.categoria === "agro"
                    ? s.padrao
                      ? t("Agro: demais estados")
                      : `${t("Agro")}: ${s.ufs.join(", ")}`
                    : t("Climabrisa")}
                  {" · "}
                  {s.user_id ? t("Ligado") : t("Ainda não ligado")}
                </p>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("WhatsApp")}
                <Contato valor={s.whatsapp} rotulo={`${t("WhatsApp")}: ${s.nome}`} desabilitado={!podeEditar || salvar.isPending}
                  aoSalvar={(v) => salvar.mutate({ tipo: "supervisor", id: s.id, whatsapp: v })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("E-mail")}
                <Contato valor={s.email} rotulo={`${t("E-mail")}: ${s.nome}`} desabilitado={!podeEditar || salvar.isPending}
                  aoSalvar={(v) => salvar.mutate({ tipo: "supervisor", id: s.id, email: v })} />
              </label>
              {s.categoria === "climabrisa" && (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={s.padrao}
                    disabled={!podeEditar || salvar.isPending}
                    aria-label={`${t("Supervisor padrão")}: ${s.nome}`}
                    onChange={(e) => salvar.mutate({ tipo: "supervisor", id: s.id, padrao: e.target.checked })}
                  />
                  {t("Supervisor padrão")}
                </label>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">{t("Parceiros")}</h2>
          <span className="text-xs text-muted-foreground">
            {todos.length} {t("parceiros")} · {contagem.recebem} {t("recebem leads")} · {contagem.semContato} {t("sem nenhum contato")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input className="min-h-11 max-w-xs" placeholder={t("Buscar por código ou nome")} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className={`${CAMPO} max-w-[14rem]`} aria-label={t("Filtrar")} value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="todos">{t("Todos")}</option>
            <option value="recebem">{t("Recebem leads")}</option>
            <option value="pausados">{t("Pausados")}</option>
            <option value="nao_certificados">{t("Não certificados")}</option>
            <option value="sairam">{t("Saíram")}</option>
            <option value="sem_contato">{t("Só sem contato")}</option>
            <option value="sem_supervisor">{t("Sem supervisor")}</option>
          </select>
          {podeEditar && <NovoParceiro supervisores={supervisoresClima} aoCriar={() => void qc.invalidateQueries({ queryKey: CHAVE })} />}
        </div>

        <div className="flex flex-col gap-3">
          {parceiros.map((p) => {
            const situacao = situacaoDosCampos(p);
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-4">
                <div className="grid gap-3 sm:grid-cols-[6rem_1fr_16rem]">
                  <p className="pt-2 text-sm text-muted-foreground">{p.codigo}</p>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("Nome")}
                    <Input
                      key={p.nome}
                      className="min-h-11"
                      defaultValue={p.nome}
                      aria-label={`${t("Nome")}: ${p.codigo}`}
                      disabled={!podeEditar || salvar.isPending}
                      onBlur={(e) => {
                        const novo = e.target.value.trim();
                        if (novo && novo !== p.nome) salvar.mutate({ tipo: "parceiro", id: p.id, nome: novo });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("Situação")}
                    <select
                      className={CAMPO}
                      aria-label={`${t("Situação")}: ${p.nome}`}
                      value={situacao}
                      disabled={!podeEditar || salvar.isPending}
                      onChange={(e) => salvar.mutate({ tipo: "parceiro", id: p.id, situacao: e.target.value as Situacao })}
                    >
                      {SITUACOES.map((s) => (
                        <option key={s} value={s}>
                          {rotuloDaSituacao(s, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("Supervisor")}
                    <select
                      className={CAMPO}
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
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("WhatsApp")}
                    <Contato valor={p.whatsapp} rotulo={`${t("WhatsApp")}: ${p.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "parceiro", id: p.id, whatsapp: v })} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("E-mail")}
                    <Contato valor={p.email} rotulo={`${t("E-mail")}: ${p.nome}`} desabilitado={!podeEditar || salvar.isPending}
                      aoSalvar={(v) => salvar.mutate({ tipo: "parceiro", id: p.id, email: v })} />
                  </label>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {p.cidades} {t("cidades")}
                    {!p.whatsapp && !p.email ? ` · ${t("sem nenhum contato")}` : ""}
                  </span>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => alterna(p.id)}>
                    {abertos.has(p.id) ? t("Fechar") : t("Editar cidades")}
                  </Button>
                </div>
                {abertos.has(p.id) && (
                  <EditorDeCidades parceiro={p} podeEditar={podeEditar} municipiosCarregados={data.municipios_carregados} />
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
