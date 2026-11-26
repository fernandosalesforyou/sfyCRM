"use client";
/**
 * sfy (fork Sales for You, etapa 7B) — a seção de supervisores: criar, renomear, trocar contatos e
 * estados, escolher o padrão, desativar (passando tudo para um substituto) e reativar.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { lerUfs } from "@/lib/sfy/supervisores";

import { CAMPO, Contato, type Edicao, type Supervisor } from "./_comum";

type Categoria = Supervisor["categoria"];

function NovoSupervisor({ aoCriar }: { aoCriar: () => void }) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("climabrisa");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [estados, setEstados] = useState("");
  const lidas = lerUfs(estados);
  const criar = useMutation({
    mutationFn: () =>
      apiClient.post("/api/v1/sfy/supervisores", {
        nome: nome.trim(),
        categoria,
        whatsapp: whatsapp.trim() || null,
        email: email.trim() || null,
        ...(categoria === "agro" ? { ufs: lidas.ufs } : {}),
      }),
    onSuccess: () => {
      toast.success(t("Supervisor criado."));
      setNome("");
      setWhatsapp("");
      setEmail("");
      setEstados("");
      setAberto(false);
      aoCriar();
    },
    onError: showApiError,
  });
  if (!aberto) {
    return (
      <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => setAberto(true)}>
        {t("Novo supervisor")}
      </Button>
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Nome")}
          <Input className="min-h-11" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Categoria")}
          <select className={CAMPO} value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
            <option value="climabrisa">{t("Climabrisa")}</option>
            <option value="agro">{t("Agro")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("WhatsApp")}
          <Input className="min-h-11" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("E-mail")}
          <Input className="min-h-11" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {categoria === "agro" && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            {t("Estados atendidos (ex.: RS, SC, PR)")}
            <Input className="min-h-11" value={estados} onChange={(e) => setEstados(e.target.value)} />
            {lidas.invalidas.length > 0 && (
              <span className="text-destructive">
                {t("Não é estado:")} {lidas.invalidas.join(", ")}
              </span>
            )}
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={!nome.trim() || (categoria === "agro" && lidas.invalidas.length > 0) || criar.isPending}
          onClick={() => criar.mutate()}
        >
          {t("Criar supervisor")}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setAberto(false)}>
          {t("Cancelar")}
        </Button>
      </div>
    </Card>
  );
}

function CartaoDoSupervisor({
  s,
  substitutos,
  parceiros,
  podeEditar,
  salvando,
  salvar,
}: {
  s: Supervisor;
  substitutos: Supervisor[];
  parceiros: number;
  podeEditar: boolean;
  salvando: boolean;
  salvar: (e: Edicao, aoSalvar?: () => void) => void;
}) {
  const t = useT();
  const [desativando, setDesativando] = useState(false);
  const [substituto, setSubstituto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const travado = !podeEditar || salvando;
  // Quem tem parceiros ou estados só sai passando para alguém.
  const exigeSubstituto = parceiros > 0 || (s.categoria === "agro" && (s.ufs.length > 0 || s.padrao));
  const linha =
    s.categoria === "agro"
      ? `${t("Agro")}: ${[...s.ufs, ...(s.padrao ? [t("demais estados")] : [])].join(", ") || t("sem estados")}`
      : `${t("Climabrisa")} · ${parceiros} ${t("parceiros")}`;

  if (!s.ativo) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 opacity-70">
        <div>
          <p className="font-medium">{s.nome}</p>
          <p className="text-xs text-muted-foreground">
            {s.categoria === "agro" ? t("Agro") : t("Climabrisa")} · {t("Desativado")}
          </p>
        </div>
        {podeEditar && (
          <Button type="button" variant="outline" className="min-h-11" disabled={salvando}
            onClick={() => salvar({ tipo: "supervisor", id: s.id, ativo: true })}>
            {t("Reativar")}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        {linha} · {s.user_id ? t("Ligado") : t("Ainda não ligado")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Nome")}
          <Input
            key={s.nome}
            className="min-h-11"
            defaultValue={s.nome}
            aria-label={`${t("Nome")}: ${s.nome}`}
            disabled={travado}
            onBlur={(e) => {
              const novo = e.target.value.trim();
              if (novo && novo !== s.nome) salvar({ tipo: "supervisor", id: s.id, nome: novo });
              else e.target.value = s.nome;
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("WhatsApp")}
          <Contato valor={s.whatsapp} rotulo={`${t("WhatsApp")}: ${s.nome}`} desabilitado={travado}
            aoSalvar={(v) => salvar({ tipo: "supervisor", id: s.id, whatsapp: v })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("E-mail")}
          <Contato valor={s.email} rotulo={`${t("E-mail")}: ${s.nome}`} desabilitado={travado}
            aoSalvar={(v) => salvar({ tipo: "supervisor", id: s.id, email: v })} />
        </label>
      </div>
      {s.categoria === "agro" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Estados atendidos (ex.: RS, SC, PR)")}
          <Contato
            key={s.ufs.join()}
            valor={s.ufs.join(", ") || null}
            rotulo={`${t("Estados atendidos (ex.: RS, SC, PR)")}: ${s.nome}`}
            desabilitado={travado}
            aoSalvar={(v) => {
              const r = lerUfs(v ?? "");
              if (r.invalidas.length > 0) {
                setAviso(`${t("Não é estado:")} ${r.invalidas.join(", ")}`);
                return;
              }
              setAviso(null);
              salvar({ tipo: "supervisor", id: s.id, ufs: r.ufs });
            }}
          />
          {aviso && <span className="text-destructive">{aviso}</span>}
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={s.padrao}
            disabled={travado}
            aria-label={`${t("Supervisor padrão")}: ${s.nome}`}
            onChange={(e) => salvar({ tipo: "supervisor", id: s.id, padrao: e.target.checked })}
          />
          {t("Supervisor padrão")}
        </label>
        {podeEditar && !desativando && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDesativando(true)}>
            {t("Desativar")}
          </Button>
        )}
      </div>
      {desativando && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <p>
            {t("Quem assume os parceiros, as cidades e os estados deste supervisor? Negócios já abertos no nome dele não mudam.")}
          </p>
          <select className={CAMPO} aria-label={`${t("Substituto")}: ${s.nome}`} value={substituto} onChange={(e) => setSubstituto(e.target.value)}>
            <option value="">{exigeSubstituto ? t("Escolha o substituto") : t("Ninguém")}</option>
            {substitutos.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={salvando || (exigeSubstituto && !substituto)}
              onClick={() =>
                salvar({ tipo: "supervisor", id: s.id, ativo: false, substituto_id: substituto || null }, () => {
                  setDesativando(false);
                  setSubstituto("");
                })
              }
            >
              {t("Confirmar desativação")}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDesativando(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Supervisores({
  supervisores,
  parceirosPorSupervisor,
  podeEditar,
  salvando,
  salvar,
  aoCriar,
}: {
  supervisores: Supervisor[];
  parceirosPorSupervisor: Map<string, number>;
  podeEditar: boolean;
  salvando: boolean;
  salvar: (e: Edicao, aoSalvar?: () => void) => void;
  aoCriar: () => void;
}) {
  const t = useT();
  const ordenados = [...supervisores].sort((a, b) => Number(b.ativo) - Number(a.ativo));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("Supervisores")}</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("O supervisor padrão recebe o que o sistema não sabe localizar. Para tirar alguém, use \"Desativar\".")}
      </p>
      {podeEditar && <NovoSupervisor aoCriar={aoCriar} />}
      <div className="flex flex-col gap-3">
        {ordenados.map((s) => (
          <CartaoDoSupervisor
            key={s.id}
            s={s}
            substitutos={supervisores.filter((o) => o.ativo && o.id !== s.id && o.categoria === s.categoria)}
            parceiros={parceirosPorSupervisor.get(s.id) ?? 0}
            podeEditar={podeEditar}
            salvando={salvando}
            salvar={salvar}
          />
        ))}
      </div>
    </section>
  );
}
