/**
 * sfy (fork Sales for You, etapa 10) — a rodada do pós-venda (banco + ponte + envio).
 *
 * Uma rodada, por organização que LIGOU (`settings.sfy.pos_venda = true`; nasce desligado):
 *   A) cria o pedido de pós-venda dos negócios GANHOS depois de `pos_venda_desde` que têm
 *      número de NF-e (campo `pos_venda_campo_nfe`, padrão `nfe_numero`). A data de início
 *      existe para o histórico importado NUNCA disparar mensagem;
 *   B) consulta a ponte da TI pela NF-e (poucas por rodada, respeitando o limitador);
 *   C) envia o que venceu, só em horário comercial. O carimbo é gravado ANTES do envio
 *      (reivindicação atômica): duas rodadas simultâneas nunca mandam a mesma mensagem.
 * Modo de teste (`pos_venda_teste_telefone`): tudo vai SÓ para esse número; e-mail não sai.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ensureConversation, sessaoProntaParaEnvio } from "@/lib/automation/start-conversation";
import { espacarEnvio } from "@/lib/automation/throttle";
import { env } from "@/lib/env";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import { consultarNfe, PonteIndisponivel, type ConsultaNfe } from "@/lib/sfy/microsys";
import {
  dentroDoHorarioComercial,
  emailDoCliente,
  montarMensagem,
  normalizaNfe,
  proximaEtapa,
  respostaDeInstalacao,
  type Etapa,
  type PedidoPosVenda,
} from "@/lib/sfy/pos-venda";

type Admin = SupabaseClient;

export interface ResumoDaRodada {
  modo: "desligado" | "teste" | "real";
  criados: number;
  consultados: number;
  respostas: number;
  enviados: number;
  falhas: string[];
  pulados: string[];
}

export interface DependenciasDoPosVenda {
  consulta: (numero: string, serie: string) => Promise<ConsultaNfe>;
  enviaWhatsapp: (organizationId: string, contactId: string, para: string, m: { modelo: string; valores: Record<string, string>; texto: string }) => Promise<void>;
  enviaEmail: (pedido: { to: string[]; subject: string; text: string; html: string }) => Promise<boolean>;
}

const MAX_CRIACOES = 200;
const MAX_CONSULTAS = 30;
const MAX_ENVIOS = 40;
const INTERVALO_DE_CONSULTA_MS = 2 * 3_600_000;
const INTERVALO_DE_ENTREGA_MS = 20 * 3_600_000;
const MAX_TENTATIVAS_DE_ENVIO = 3;

const LINHA = "id,organization_id,lead_id,contact_id,nfe_numero,nfe_serie,link_rastreio,link_valido_ate,entregue_em,instalacao_confirmada_em,instalacao_adiada_em,situacao,msg1_em,msg2_em,msg2_repetida_em,msg3_em,ultima_consulta_em,tentativas,criado_em";

type Linha = Record<string, unknown> & { id: string; contact_id: string | null; nfe_numero: string; nfe_serie: string; tentativas: number; ultima_consulta_em: string | null };

const data = (v: unknown): Date | null => (typeof v === "string" ? new Date(v) : null);

export function paraPedido(l: Linha): PedidoPosVenda {
  return {
    situacao: l.situacao as PedidoPosVenda["situacao"],
    link_rastreio: (l.link_rastreio as string | null) ?? null,
    link_valido_ate: data(l.link_valido_ate),
    entregue_em: data(l.entregue_em),
    instalacao_confirmada_em: data(l.instalacao_confirmada_em),
    instalacao_adiada_em: data(l.instalacao_adiada_em),
    msg1_em: data(l.msg1_em),
    msg2_em: data(l.msg2_em),
    msg2_repetida_em: data(l.msg2_repetida_em),
    msg3_em: data(l.msg3_em),
    criado_em: data(l.criado_em) ?? new Date(),
  };
}

const CAMPO_DO_CARIMBO: Record<string, string> = {
  msg1_com_link: "msg1_em",
  msg1_sem_link: "msg1_em",
  msg2: "msg2_em",
  msg2_repetida: "msg2_repetida_em",
  msg3: "msg3_em",
};

export function dependenciasReais(admin: Admin): DependenciasDoPosVenda {
  return {
    consulta: (numero, serie) => consultarNfe({ url: env.MICROSYS_API_URL, token: env.MICROSYS_API_TOKEN }, numero, serie),
    enviaWhatsapp: async (organizationId, contactId, _para, m) => {
      const canalId = await sessaoProntaParaEnvio(admin, organizationId);
      if (!canalId) throw new Error("sem_canal_de_whatsapp");
      await espacarEnvio(canalId);
      const conversaId = await ensureConversation(admin, organizationId, contactId, canalId);
      const msg = await sendMessageHandler(
        admin as Parameters<typeof sendMessageHandler>[0],
        { organization_id: organizationId, actor: { type: "webhook_source", id: "sfy-pos-venda" }, requestId: `pos-venda:${contactId}:${m.modelo}:${Date.now()}` },
        { conversation_id: conversaId, type: "template", template_name: m.modelo, template_language: "pt_BR", template_values: m.valores, body: m.texto } as Parameters<typeof sendMessageHandler>[2],
      );
      if ((msg as { status?: string } | null)?.status === "failed") throw new Error("whatsapp_recusou_o_envio");
    },
    enviaEmail: async (pedido) => {
      const { sendEmail } = await import("@/lib/email/roteador");
      const res = await sendEmail({ ...pedido, tags: [{ name: "origem", value: "sfy-pos-venda" }] });
      return res.ok;
    },
  };
}

async function configDaOrg(admin: Admin, orgId: string) {
  const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const sfy = ((org?.settings as Record<string, unknown> | null)?.sfy ?? {}) as Record<string, unknown>;
  return {
    ligado: sfy.pos_venda === true,
    desde: typeof sfy.pos_venda_desde === "string" ? new Date(sfy.pos_venda_desde) : null,
    campoNfe: typeof sfy.pos_venda_campo_nfe === "string" && sfy.pos_venda_campo_nfe ? sfy.pos_venda_campo_nfe : "nfe_numero",
    campoSerie: typeof sfy.pos_venda_campo_serie === "string" ? sfy.pos_venda_campo_serie : "",
    testeTelefone: typeof sfy.pos_venda_teste_telefone === "string" && sfy.pos_venda_teste_telefone ? sfy.pos_venda_teste_telefone : null,
  };
}

export async function executarPosVenda(
  admin: Admin,
  orgId: string,
  agora: Date,
  deps: DependenciasDoPosVenda = dependenciasReais(admin),
): Promise<ResumoDaRodada> {
  const config = await configDaOrg(admin, orgId);
  const r: ResumoDaRodada = { modo: config.ligado ? (config.testeTelefone ? "teste" : "real") : "desligado", criados: 0, consultados: 0, respostas: 0, enviados: 0, falhas: [], pulados: [] };
  if (!config.ligado) return r;
  if (!config.desde || Number.isNaN(config.desde.getTime())) {
    r.pulados.push("sem_data_de_inicio");
    return { ...r, modo: "desligado" };
  }

  // A) criar os pedidos dos negócios ganhos com NF-e
  const { data: ganhos } = await admin
    .from("crm_leads")
    .select("id,contact_id,custom_fields")
    .eq("organization_id", orgId)
    .eq("status", "won")
    .gte("closed_at", config.desde.toISOString())
    .order("closed_at", { ascending: true })
    .limit(MAX_CRIACOES);
  const ids = (ganhos ?? []).map((g) => g.id as string);
  const jaTem = new Set<string>();
  if (ids.length) {
    const { data: existentes } = await admin.from("sfy_pedidos_pos_venda").select("lead_id").eq("organization_id", orgId).in("lead_id", ids);
    for (const e of existentes ?? []) jaTem.add(e.lead_id as string);
  }
  for (const g of ganhos ?? []) {
    if (jaTem.has(g.id as string)) continue;
    const campos = (g.custom_fields ?? {}) as Record<string, unknown>;
    const nfe = normalizaNfe(campos[config.campoNfe]);
    if (!nfe) continue;
    const serie = config.campoSerie ? String(campos[config.campoSerie] ?? "").trim().slice(0, 5) : "";
    const { error } = await admin.from("sfy_pedidos_pos_venda").insert({ organization_id: orgId, lead_id: g.id, contact_id: g.contact_id, nfe_numero: nfe, nfe_serie: serie });
    if (!error) r.criados += 1;
    else if (error.code === "23505") r.pulados.push(`nfe_repetida:${nfe}`);
    else r.falhas.push(`criar:${error.message.slice(0, 80)}`);
  }

  // B) consultar a ponte (aguardando link; e a entrega, 1x por dia, de quem já recebeu a 1ª)
  const limiteConsulta = new Date(agora.getTime() - INTERVALO_DE_CONSULTA_MS).toISOString();
  const limiteEntrega = new Date(agora.getTime() - INTERVALO_DE_ENTREGA_MS).toISOString();
  const { data: aguardando } = await admin
    .from("sfy_pedidos_pos_venda").select(LINHA).eq("organization_id", orgId).eq("situacao", "aguardando_link")
    .or(`ultima_consulta_em.is.null,ultima_consulta_em.lt.${limiteConsulta}`).order("ultima_consulta_em", { ascending: true, nullsFirst: true }).limit(MAX_CONSULTAS);
  const { data: emTransito } = await admin
    .from("sfy_pedidos_pos_venda").select(LINHA).eq("organization_id", orgId).eq("situacao", "ativa")
    .not("msg1_em", "is", null).is("entregue_em", null).is("msg2_em", null)
    .or(`ultima_consulta_em.is.null,ultima_consulta_em.lt.${limiteEntrega}`).limit(MAX_CONSULTAS);
  let orcamento = MAX_CONSULTAS;
  for (const l of [...((aguardando ?? []) as Linha[]), ...((emTransito ?? []) as Linha[])]) {
    if (orcamento-- <= 0) break;
    try {
      const c = await deps.consulta(l.nfe_numero, l.nfe_serie);
      r.consultados += 1;
      const mudanca: Record<string, unknown> = { ultima_consulta_em: agora.toISOString(), ultimo_erro: "", atualizado_em: agora.toISOString() };
      if (c.encontrado) {
        mudanca.situacao_rastreio = c.situacao;
        if (c.vendaNumero) mudanca.venda_numero = c.vendaNumero;
        if (c.entregueEm) mudanca.entregue_em = c.entregueEm.toISOString();
        if (c.link && l.situacao === "aguardando_link") {
          mudanca.link_rastreio = c.link;
          mudanca.link_valido_ate = c.validoAte?.toISOString() ?? null;
          mudanca.origem_link = "microsys";
        }
      }
      await admin.from("sfy_pedidos_pos_venda").update(mudanca).eq("id", l.id);
    } catch (e) {
      const motivo = e instanceof PonteIndisponivel ? e.message : "consulta_falhou";
      await admin.from("sfy_pedidos_pos_venda").update({ ultima_consulta_em: agora.toISOString(), tentativas: l.tentativas + 1, ultimo_erro: motivo, atualizado_em: agora.toISOString() }).eq("id", l.id);
      r.falhas.push(motivo);
      // Limite, token recusado ou ponte parada: insistir só piora. Para a rodada de consultas.
      if (["ponte_limite_de_consultas", "ponte_recusou_o_token", "ponte_nao_configurada", "ponte_sem_https", "ponte_fora_do_ar", "ponte_demorou"].includes(motivo)) break;
    }
  }

  // B2) ler as respostas "Já instalei" / "Ainda não" da pergunta de instalação
  r.respostas = await lerRespostasDeInstalacao(admin, orgId, agora);

  // C) enviar o que venceu (só em horário comercial)
  if (!dentroDoHorarioComercial(agora)) {
    r.pulados.push("fora_do_horario_comercial");
    return r;
  }
  const { data: candidatos } = await admin
    .from("sfy_pedidos_pos_venda").select(LINHA).eq("organization_id", orgId).in("situacao", ["aguardando_link", "ativa"]).limit(500);
  let envios = 0;
  for (const l of (candidatos ?? []) as Linha[]) {
    if (envios >= MAX_ENVIOS) { r.pulados.push("limite_de_envios_da_rodada"); break; }
    const pedido = paraPedido(l);
    const etapa = proximaEtapa(pedido, agora);
    if (!etapa || etapa === "consultar") continue;
    if (etapa === "desistir") {
      await admin.from("sfy_pedidos_pos_venda").update({ situacao: "pausada", ultimo_erro: "sem_link_em_30_dias", atualizado_em: agora.toISOString() }).eq("id", l.id);
      continue;
    }
    envios += 1;
    const res = await enviarEtapa(admin, orgId, l, etapa, agora, config.testeTelefone, deps);
    if (res === "ok") r.enviados += 1;
    else r.falhas.push(`${etapa}:${res}`);
  }
  return r;
}

async function enviarEtapa(
  admin: Admin,
  orgId: string,
  l: Linha,
  etapa: Exclude<Etapa, "consultar" | "desistir">,
  agora: Date,
  testeTelefone: string | null,
  deps: DependenciasDoPosVenda,
): Promise<string> {
  const parar = async (motivo: string) => {
    await admin.from("sfy_pedidos_pos_venda").update({ situacao: "pausada", ultimo_erro: motivo, atualizado_em: agora.toISOString() }).eq("id", l.id);
    return motivo;
  };
  const { data: contato } = l.contact_id
    ? await admin.from("contacts").select("id,name,display_name,email,phone_number,is_blocked,is_anonymized").eq("id", l.contact_id).maybeSingle()
    : { data: null };
  if (!contato || contato.is_blocked || contato.is_anonymized) return parar("contato_indisponivel");
  const telefone = testeTelefone ?? ((contato.phone_number as string | null) || null);
  const email = testeTelefone ? null : emailDoCliente(contato.email as string | null);
  if (!telefone && !email) return parar("contato_sem_telefone_nem_email");

  const msg = montarMensagem(etapa, { nome: (contato.display_name ?? contato.name) as string | null, nfe: l.nfe_numero, link: (l.link_rastreio as string | null) ?? null });

  // Reivindica o carimbo ANTES de enviar. Só quem muda de vazio para preenchido envia.
  const campo = CAMPO_DO_CARIMBO[etapa]!;
  const virarAtiva = l.situacao === "aguardando_link" ? { situacao: "ativa" } : {};
  const { data: reivindicou } = await admin
    .from("sfy_pedidos_pos_venda").update({ [campo]: agora.toISOString(), ...virarAtiva, atualizado_em: agora.toISOString() })
    .eq("id", l.id).is(campo, null).select("id");
  if (!reivindicou?.length) return "ja_reivindicado";

  try {
    let saiu = false;
    if (telefone) {
      await deps.enviaWhatsapp(orgId, l.contact_id!, telefone, msg);
      saiu = true;
    }
    // O e-mail acompanha só a 1ª mensagem (rastreio). Falha de e-mail sozinha não desfaz o WhatsApp.
    if (email && (etapa === "msg1_com_link" || etapa === "msg1_sem_link")) {
      const corpo = msg.texto.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      if (await deps.enviaEmail({ to: [email], subject: msg.assunto, text: msg.texto, html: `<p>${corpo}</p>` })) saiu = true;
    }
    if (!saiu) throw new Error("nada_foi_enviado");
    if (etapa === "msg3") await admin.from("sfy_pedidos_pos_venda").update({ situacao: "concluida", atualizado_em: agora.toISOString() }).eq("id", l.id);
    return "ok";
  } catch (e) {
    // Organização parada no meio do envio (suspensão): não é falha do pedido. Devolve o carimbo sem
    // contar tentativa nem pausar, e a sequência retoma sozinha quando a organização voltar.
    if (e instanceof OrgNaoOperanteError) {
      await admin.from("sfy_pedidos_pos_venda").update({ [campo]: null, ...(l.situacao === "aguardando_link" ? { situacao: "aguardando_link" } : {}), atualizado_em: agora.toISOString() }).eq("id", l.id);
      return "org_nao_operante";
    }
    const motivo = (e instanceof Error ? e.message : "envio_falhou").slice(0, 120);
    const tentativas = l.tentativas + 1;
    // Falha clara: devolve o carimbo para tentar de novo na próxima rodada (até 3 vezes).
    await admin.from("sfy_pedidos_pos_venda").update({
      [campo]: null,
      ...(l.situacao === "aguardando_link" ? { situacao: "aguardando_link" } : {}),
      tentativas,
      ultimo_erro: motivo,
      ...(tentativas >= MAX_TENTATIVAS_DE_ENVIO ? { situacao: "pausada" } : {}),
      atualizado_em: agora.toISOString(),
    }).eq("id", l.id);
    return motivo;
  }
}


const JANELA_DE_RESPOSTA_MS = 90 * 86_400_000;

/**
 * O botão do modelo de instalação chega como mensagem do cliente com o texto do botão. Em vez de
 * plantar um gancho no pipeline de mensagens recebidas (núcleo, atrapalha os merges do upstream),
 * a rodada lê a conversa dos pedidos que estão esperando essa resposta.
 */
export async function lerRespostasDeInstalacao(admin: Admin, orgId: string, agora: Date): Promise<number> {
  const { data } = await admin
    .from("sfy_pedidos_pos_venda")
    .select("id,contact_id,msg2_em,msg2_repetida_em,instalacao_adiada_em")
    .eq("organization_id", orgId).eq("situacao", "ativa").is("instalacao_confirmada_em", null).is("msg3_em", null).not("msg2_em", "is", null).limit(200);
  let tratadas = 0;
  for (const l of data ?? []) {
    if (!l.contact_id) continue;
    const adiada = data_(l.instalacao_adiada_em);
    const repetida = data_(l.msg2_repetida_em);
    // Já disse "ainda não" e a pergunta repetida ainda não saiu: nada a ler.
    if (adiada && !repetida) continue;
    // Já disse "ainda não" também na repetida: a pergunta acabou, só resta a manutenção.
    if (adiada && repetida && adiada.getTime() >= repetida.getTime()) continue;
    const pergunta = repetida ?? data_(l.msg2_em);
    if (!pergunta || agora.getTime() - pergunta.getTime() > JANELA_DE_RESPOSTA_MS) continue;
    const { data: msgs } = await admin
      .from("messages").select("body,created_at")
      .eq("organization_id", orgId).eq("contact_id", l.contact_id).eq("direction", "inbound")
      .gt("created_at", pergunta.toISOString()).order("created_at", { ascending: true }).limit(20);
    for (const m of msgs ?? []) {
      const resposta = respostaDeInstalacao(m.body as string | null);
      if (!resposta) continue;
      const quando = m.created_at as string;
      const mudanca = resposta === "instalou" ? { instalacao_confirmada_em: quando } : { instalacao_adiada_em: quando };
      await admin.from("sfy_pedidos_pos_venda").update({ ...mudanca, atualizado_em: agora.toISOString() }).eq("id", l.id);
      tratadas += 1;
      break;
    }
  }
  return tratadas;
}

function data_(v: unknown): Date | null {
  return typeof v === "string" ? new Date(v) : null;
}
