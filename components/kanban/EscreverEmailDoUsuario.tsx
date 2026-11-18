"use client";
/**
 * sfy (etapa 9) — "Escrever e-mail" no negócio. Sai com o endereço do usuário (Resend), a resposta
 * volta para a caixa dele e ele recebe uma cópia. Só envia. Se o envio não está configurado neste
 * CRM, nada é desenhado.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

const TETO_BYTES = 3 * 1024 * 1024;

interface Props {
  leadId: string;
  emailDoContato?: string;
  /** Só quem pode editar o negócio envia. */
  podeEnviar: boolean;
}

interface Anexo {
  nome: string;
  tipo: string;
  base64: string;
  bytes: number;
}

function lerArquivo(f: File): Promise<Anexo> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("leitura"));
    r.onload = () => {
      const url = String(r.result);
      resolve({ nome: f.name, tipo: f.type, base64: url.slice(url.indexOf(",") + 1), bytes: f.size });
    };
    r.readAsDataURL(f);
  });
}

export function EscreverEmailDoUsuario({ leadId, emailDoContato, podeEnviar }: Props) {
  const t = useT();
  const [de, setDe] = useState<string | null>(null);
  const [configurado, setConfigurado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState(emailDoContato ?? "");
  const [cc, setCc] = useState("");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!podeEnviar) return;
    let vivo = true;
    fetch("/api/v1/sfy/email/situacao", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.data) {
          setConfigurado(Boolean(j.data.configurado));
          setDe((j.data.de as string | null) ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [podeEnviar]);

  if (!podeEnviar || !configurado) return null;

  const totalAnexos = anexos.reduce((s, a) => s + a.bytes, 0);
  const lista = (s: string) => s.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);

  async function aoEscolher(files: FileList | null) {
    if (!files) return;
    const novos: Anexo[] = [];
    for (const f of Array.from(files)) novos.push(await lerArquivo(f));
    const todos = [...anexos, ...novos];
    if (todos.reduce((s, a) => s + a.bytes, 0) > TETO_BYTES || todos.length > 5) {
      toast.error(t("Os anexos passam de 3 MB no total (ou de 5 arquivos)."));
      return;
    }
    setAnexos(todos);
  }

  async function enviar() {
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/sfy/email/enviar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          para: lista(para),
          cc: lista(cc),
          assunto,
          corpo,
          anexos: anexos.map(({ nome, tipo, base64 }) => ({ nome, tipo, base64 })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        toast.success(t("E-mail enviado. Você recebe uma cópia na sua caixa."));
        setAberto(false);
        setAssunto("");
        setCorpo("");
        setCc("");
        setAnexos([]);
      } else {
        toast.error(j?.error?.message ?? t("Não foi possível enviar o e-mail."));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>
        {t("Escrever e-mail")}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Escrever e-mail")}</DialogTitle>
            <DialogDescription>
              {t("Sai em nome de")} {de ?? ""}. {t("A resposta do cliente chega na sua caixa e você recebe uma cópia do que enviar.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email-para">{t("Para")}</Label>
              <Input id="email-para" value={para} onChange={(e) => setPara(e.target.value)} placeholder="nome@empresa.com.br" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-cc">{t("Cópia (opcional)")}</Label>
              <Input id="email-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-assunto">{t("Assunto")}</Label>
              <Input id="email-assunto" value={assunto} maxLength={250} onChange={(e) => setAssunto(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-corpo">{t("Mensagem")}</Label>
              <Textarea id="email-corpo" rows={8} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-anexos">{t("Anexos (até 3 MB no total)")}</Label>
              <Input id="email-anexos" type="file" multiple onChange={(e) => void aoEscolher(e.target.files)} />
              {anexos.length > 0 && (
                <p className="text-xs text-text-muted">
                  {anexos.map((a) => a.nome).join(", ")} · {(totalAnexos / 1024).toFixed(0)} KB
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={enviando}>
                {t("Cancelar")}
              </Button>
              <Button type="button" onClick={enviar} disabled={enviando || !lista(para).length || !assunto.trim() || !corpo.trim()}>
                {enviando ? t("Enviando…") : t("Enviar")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
