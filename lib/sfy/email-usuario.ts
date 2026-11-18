/**
 * sfy (fork Sales for You, etapa 9) — e-mail do usuário pelo CRM.
 *
 * A Climabrisa não tem Exchange Online (e-mail no TurboCloud, Outlook instalado), então o envio
 * sai pelo Resend com o endereço do próprio usuário no "De" e no "Responder para": a resposta do
 * cliente cai no Outlook dele. Uma cópia oculta vai para a caixa do usuário (substitui o "Itens
 * Enviados"). O CRM só ENVIA: não lê caixa, não sincroniza, não faz envio em massa.
 *
 * Anti-falsificação: o "De" só pode ser um endereço do MESMO domínio do remetente verificado da
 * instalação (RESEND_FROM_EMAIL). Qualquer outro usuário sai pelo remetente padrão, com o nome
 * dele e o "Responder para" apontando para ele.
 */
export const TETO_DE_ANEXOS_BYTES = 3 * 1024 * 1024;
export const MAX_DESTINATARIOS = 20;

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function emailValido(e: string): boolean {
  return e.length <= 254 && EMAIL_RE.test(e);
}

export function dominioDe(email: string | null | undefined): string | null {
  const m = /@([^@\s]+)$/.exec((email ?? "").trim().toLowerCase());
  return m ? m[1]! : null;
}

function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Tamanho real (bytes) de um anexo em base64. */
export function bytesDoBase64(b64: string): number {
  const limpo = b64.replace(/\s+/g, "");
  const pad = limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0;
  return Math.floor((limpo.length * 3) / 4) - pad;
}

export interface AnexoEntrada {
  nome: string;
  tipo: string;
  base64: string;
}

export interface EmailEntrada {
  para: string[];
  cc?: string[];
  assunto: string;
  corpo: string; // texto simples
  anexos?: AnexoEntrada[];
}

export interface Usuario {
  email: string;
  nome: string | null;
}

export interface EnvioMontado {
  fromEndereco: string | undefined; // undefined = remetente padrão da instalação
  fromName: string;
  replyTo: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: string; contentType?: string }[];
}

/**
 * Valida e monta o envio. Lança Error com mensagem em português.
 * `dominioDoRemetente` = domínio de RESEND_FROM_EMAIL (null se não configurado).
 */
export function montarEnvio(usuario: Usuario, dominioDoRemetente: string | null, e: EmailEntrada): EnvioMontado {
  const meu = usuario.email.trim().toLowerCase();
  if (!emailValido(meu)) throw new Error("O seu usuário não tem um e-mail válido cadastrado.");
  const para = e.para.map((x) => x.trim()).filter(Boolean);
  const cc = (e.cc ?? []).map((x) => x.trim()).filter(Boolean);
  if (para.length === 0) throw new Error("Informe ao menos um destinatário.");
  if (para.length + cc.length > MAX_DESTINATARIOS) throw new Error(`No máximo ${MAX_DESTINATARIOS} destinatários por e-mail.`);
  for (const x of [...para, ...cc]) if (!emailValido(x)) throw new Error(`Endereço de e-mail inválido: ${x}`);
  const assunto = e.assunto.replace(/[\r\n]+/g, " ").trim();
  if (!assunto) throw new Error("Escreva o assunto.");
  if (assunto.length > 250) throw new Error("O assunto é longo demais (máximo 250 caracteres).");
  if (!e.corpo.trim()) throw new Error("Escreva a mensagem.");
  if (e.corpo.length > 100_000) throw new Error("A mensagem é longa demais.");
  const anexos = e.anexos ?? [];
  if (anexos.reduce((s, a) => s + bytesDoBase64(a.base64), 0) > TETO_DE_ANEXOS_BYTES) throw new Error("Os anexos passam de 3 MB no total.");

  const mesmoDominio = dominioDoRemetente !== null && dominioDe(meu) === dominioDoRemetente;
  const jaRecebe = [...para, ...cc].some((x) => x.toLowerCase() === meu);
  const nome = (usuario.nome ?? "").trim() || meu.split("@")[0]!;
  return {
    fromEndereco: mesmoDominio ? meu : undefined,
    fromName: mesmoDominio ? nome : `${nome} (via CRM)`,
    replyTo: meu,
    to: para,
    cc,
    bcc: jaRecebe ? [] : [meu],
    subject: assunto,
    html: escaparHtml(e.corpo).replace(/\r?\n/g, "<br>"),
    text: e.corpo,
    attachments: anexos.map((a) => ({
      filename: a.nome.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 150) || "anexo",
      content: a.base64.replace(/\s+/g, ""),
      ...(a.tipo ? { contentType: a.tipo } : {}),
    })),
  };
}
