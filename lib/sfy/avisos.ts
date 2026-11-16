/**
 * sfy (fork Sales for You, Bloco C) — avisos da distribuição.
 *
 * Depois que o negócio é encaminhado, três pessoas precisam saber:
 *   - o CLIENTE recebe, no texto que a IA envia, quem é o supervisor (nome, e-mail, telefone);
 *   - o PARCEIRO e o SUPERVISOR recebem os dados do lead por WhatsApp (número interno de avisos,
 *     o mesmo cadastrado em Avisos; não abre conversa nem cria contato);
 *   - o PARCEIRO e o SUPERVISOR recebem o e-mail do negócio, com cópia FIXA por categoria.
 *
 * NADA sai enquanto `organizations.settings.sfy.avisos_da_distribuicao` não for `true`: a regra
 * nasce desligada (como as do Bloco A e B) para não falar com parceiro real antes da entrega.
 * Falha de aviso nunca desfaz a distribuição: volta no resumo, e o negócio segue encaminhado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhoneBR } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import type { DestinoEscolhido } from "@/lib/sfy/distribuicao";

export interface PessoaDoAviso {
  nome: string;
  whatsapp: string | null;
  email: string | null;
}

export interface DadosDoAviso {
  categoria: "climabrisa" | "agro";
  cidade: string;
  uf: string;
  lead: { nome: string; telefone: string | null; email: string | null };
  parceiro: PessoaDoAviso | null;
  supervisor: PessoaDoAviso | null;
  urlPublica: string;
}

export interface ConfigDosAvisos {
  ligado: boolean;
  copias: { climabrisa: string[]; agro: string[] };
}

export interface DependenciasDosAvisos {
  enviaWhatsapp(para: string, texto: string): Promise<void>;
  enviaEmail(pedido: { to: string[]; subject: string; text: string; html: string }): Promise<{ ok: boolean }>;
}

export interface ResumoDosAvisos {
  enviados: string[];
  falhas: string[];
  pulados: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rotuloDaCategoria = (c: "climabrisa" | "agro") => (c === "agro" ? "Climabrisa Agro" : "Climabrisa");

const limpa = (s: string | null | undefined) => (s ?? "").replace(/[\r\n]+/g, " ").trim();

/** Dados do lead que parceiro e supervisor recebem por WhatsApp. */
export function textoDoLeadParaQuemAtende(d: DadosDoAviso, papel: "parceiro" | "supervisor"): string {
  const linhas = [
    papel === "parceiro" ? "Novo cliente para você — Climabrisa" : "Novo negócio sob sua supervisão — Climabrisa",
    `Categoria: ${rotuloDaCategoria(d.categoria)}`,
    `Cliente: ${limpa(d.lead.nome) || "(sem nome)"}`,
    d.lead.telefone ? `Telefone: ${limpa(d.lead.telefone)}` : null,
    d.lead.email ? `E-mail: ${limpa(d.lead.email)}` : null,
    `Cidade: ${limpa(d.cidade)}/${limpa(d.uf).toUpperCase()}`,
    papel === "supervisor" && d.parceiro ? `Parceiro encaminhado: ${limpa(d.parceiro.nome)}` : null,
    "Por favor, entre em contato com o cliente em até 24 horas.",
    d.urlPublica ? `Abrir no CRM: ${d.urlPublica}` : null,
  ];
  return linhas.filter((l): l is string => Boolean(l)).join("\n");
}

/** Texto que a IA entrega ao cliente com os dados do supervisor (só o supervisor, nunca o parceiro). */
export function textoParaOCliente(supervisor: PessoaDoAviso | null): string | null {
  if (!supervisor) return null;
  const partes = [`Seu atendimento será conduzido por ${limpa(supervisor.nome)}, supervisor da Climabrisa.`];
  const contatos = [
    supervisor.whatsapp ? `Telefone: ${limpa(supervisor.whatsapp)}` : null,
    supervisor.email ? `E-mail: ${limpa(supervisor.email)}` : null,
  ].filter(Boolean);
  if (contatos.length) partes.push(`Contato: ${contatos.join(" | ")}.`);
  return partes.join(" ");
}

export function assuntoDoEmail(d: DadosDoAviso): string {
  return `Novo negócio ${rotuloDaCategoria(d.categoria)}: ${limpa(d.lead.nome) || "cliente"} (${limpa(d.cidade)}/${limpa(d.uf).toUpperCase()})`;
}

const escapa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function corpoDoEmail(d: DadosDoAviso): { text: string; html: string } {
  const text = textoDoLeadParaQuemAtende(d, "supervisor").replace(/^.*\n/, "Novo negócio encaminhado\n");
  const html = `<p>${escapa(text).replace(/\n/g, "<br>")}</p>`;
  return { text, html };
}

/** Quem recebe o e-mail: parceiro e supervisor com e-mail válido + cópia fixa da categoria (sem repetir). */
export function destinatariosDoEmail(d: DadosDoAviso, copias: string[]): string[] {
  const todos = [d.parceiro?.email, d.supervisor?.email, ...copias]
    .map((e) => limpa(e).toLowerCase())
    .filter((e) => EMAIL.test(e));
  return [...new Set(todos)];
}

export async function enviarAvisos(
  deps: DependenciasDosAvisos,
  config: ConfigDosAvisos,
  d: DadosDoAviso,
): Promise<ResumoDosAvisos> {
  const r: ResumoDosAvisos = { enviados: [], falhas: [], pulados: [] };
  if (!config.ligado) {
    r.pulados.push("avisos_desligados");
    return r;
  }

  for (const [papel, pessoa] of [["parceiro", d.parceiro], ["supervisor", d.supervisor]] as const) {
    const numero = normalizePhoneBR(pessoa?.whatsapp ?? "");
    if (!pessoa) continue;
    if (!numero) {
      r.pulados.push(`whatsapp_${papel}_sem_numero`);
      continue;
    }
    try {
      await deps.enviaWhatsapp(numero, textoDoLeadParaQuemAtende(d, papel));
      r.enviados.push(`whatsapp_${papel}`);
    } catch {
      r.falhas.push(`whatsapp_${papel}`);
    }
  }

  const para = destinatariosDoEmail(d, config.copias[d.categoria]);
  if (para.length === 0) {
    r.pulados.push("email_sem_destinatario");
  } else {
    try {
      const { text, html } = corpoDoEmail(d);
      const res = await deps.enviaEmail({ to: para, subject: assuntoDoEmail(d), text, html });
      (res.ok ? r.enviados : r.falhas).push("email");
    } catch {
      r.falhas.push("email");
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Ligação com o banco e com os transportes reais
// ---------------------------------------------------------------------------

/** Lê `organizations.settings.sfy`: avisos ligados e cópias fixas por categoria. */
export function configDosAvisos(settings: unknown): ConfigDosAvisos {
  const sfy = ((settings as { sfy?: Record<string, unknown> } | null)?.sfy ?? {}) as Record<string, unknown>;
  const lista = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && EMAIL.test(x.trim())).map((x) => x.trim()) : [];
  const copias = (sfy.copias_de_email ?? {}) as Record<string, unknown>;
  return {
    ligado: sfy.avisos_da_distribuicao === true,
    copias: { climabrisa: lista(copias.climabrisa), agro: lista(copias.agro) },
  };
}

interface ContextoDosAvisos {
  organization_id: string;
  lead_id: string;
  categoria: "climabrisa" | "agro";
  cidade: string;
  uf: string;
  destino: DestinoEscolhido;
}

export async function avisarDaDistribuicao(
  supabase: SupabaseClient,
  ctx: ContextoDosAvisos,
): Promise<ResumoDosAvisos & { texto_para_o_cliente: string | null }> {
  const { data: org } = await supabase.from("organizations").select("settings").eq("id", ctx.organization_id).maybeSingle();
  const config = configDosAvisos(org?.settings);

  const pessoa = async (tabela: "sfy_parceiros" | "sfy_supervisores", id: string | null | undefined): Promise<PessoaDoAviso | null> => {
    if (!id) return null;
    const { data } = await supabase
      .from(tabela)
      .select("nome, whatsapp, email")
      .eq("organization_id", ctx.organization_id)
      .eq("id", id)
      .maybeSingle();
    return data ? { nome: data.nome, whatsapp: data.whatsapp, email: data.email } : null;
  };
  const [parceiro, supervisor] = await Promise.all([
    pessoa("sfy_parceiros", ctx.destino.parceiro_id),
    pessoa("sfy_supervisores", ctx.destino.supervisor_id),
  ]);
  const texto_para_o_cliente = textoParaOCliente(supervisor);
  if (!config.ligado) return { enviados: [], falhas: [], pulados: ["avisos_desligados"], texto_para_o_cliente };

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("title, contacts(name, display_name, phone_number, email)")
    .eq("organization_id", ctx.organization_id)
    .eq("id", ctx.lead_id)
    .maybeSingle();
  const contato = (Array.isArray(lead?.contacts) ? lead?.contacts[0] : lead?.contacts) as
    | { name?: string | null; display_name?: string | null; phone_number?: string | null; email?: string | null }
    | null
    | undefined;

  const { env } = await import("@/lib/env");
  const dados: DadosDoAviso = {
    categoria: ctx.categoria,
    cidade: ctx.cidade,
    uf: ctx.uf,
    lead: {
      nome: contato ? rotuloDoContato(contato) : (lead?.title ?? ""),
      telefone: contato?.phone_number ?? null,
      email: contato?.email ?? null,
    },
    parceiro,
    supervisor,
    urlPublica: env.NEXT_PUBLIC_APP_URL ?? "",
  };

  const deps: DependenciasDosAvisos = {
    enviaWhatsapp: async (para, texto) => {
      const { data: cfg } = await supabase
        .from("config_aviso_de_caso")
        .select("channel_session_id")
        .eq("organization_id", ctx.organization_id)
        .maybeSingle();
      const canalId = cfg?.channel_session_id as string | undefined;
      if (!canalId) throw new Error("sem_numero_de_avisos");
      const { criarTransporteDoAviso } = await import("@/lib/escalacao/aviso-ao-suporte.handler");
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const transporte = await criarTransporteDoAviso(createAdminClient());
      const canal = { id: canalId, status: "connected", archived_at: null, aceitaMensagemLivre: true } as Parameters<typeof transporte.envia>[1];
      if (!(await transporte.configurado(ctx.organization_id, canal))) throw new Error("canal_nao_configurado");
      const destino = await transporte.resolveDestino(ctx.organization_id, canal, para);
      if (!destino) throw new Error("destino_invalido");
      await transporte.envia(ctx.organization_id, canal, destino, texto);
    },
    enviaEmail: async (pedido) => {
      const { sendEmail } = await import("@/lib/email/roteador");
      const res = await sendEmail({ ...pedido, tags: [{ name: "origem", value: "sfy-distribuicao" }] });
      return { ok: res.ok };
    },
  };
  const resumo = await enviarAvisos(deps, config, dados);
  return { ...resumo, texto_para_o_cliente };
}
