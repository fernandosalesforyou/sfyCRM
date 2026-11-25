/**
 * sfy (fork Sales for You, etapa 10) — regras PURAS do pós-venda. Sem banco, sem rede.
 *
 * A sequência, por NF-e de negócio ganho:
 *   1) rastreio (assim que existe link da ponte do Microsys, ou link colado à mão);
 *   2) "já instalou?" 45 dias depois da ENTREGA (se a ponte informou) ou do envio da 1ª;
 *      "Ainda não" repete UMA vez, 30 dias depois;
 *   3) manutenção 8 meses depois da instalação confirmada; sem confirmação, 8 meses depois
 *      da pergunta (decisão D2).
 *
 * `situacao`: aguardando_link = ainda consultando a ponte; ativa = pode enviar (com link, ou
 * sem link se o atendente liberou o aviso sem rastreio); pausada/cancelada/concluida = parada.
 */

export type SituacaoPosVenda = "aguardando_link" | "ativa" | "pausada" | "cancelada" | "concluida";

export interface PedidoPosVenda {
  situacao: SituacaoPosVenda;
  link_rastreio: string | null;
  link_valido_ate: Date | null;
  entregue_em: Date | null;
  instalacao_confirmada_em: Date | null;
  instalacao_adiada_em: Date | null;
  msg1_em: Date | null;
  msg2_em: Date | null;
  msg2_repetida_em: Date | null;
  msg3_em: Date | null;
  criado_em: Date;
}

export type Etapa = "consultar" | "msg1_com_link" | "msg1_sem_link" | "msg2" | "msg2_repetida" | "msg3" | "desistir";

export const DIAS_ATE_A_PERGUNTA = 45;
export const DIAS_PARA_REPETIR = 30;
export const MESES_ATE_A_MANUTENCAO = 8;
export const DIAS_PARA_DESISTIR_DO_LINK = 30;

const DIA_MS = 86_400_000;

export function somaDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * DIA_MS);
}

/** Soma meses no calendário (UTC). 31/08 + 6 meses = 28/02 (ou 29): nunca estoura para o mês seguinte. */
export function somaMeses(d: Date, meses: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(ano, mes, Math.min(d.getUTCDate(), ultimoDia), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
  );
}

/** O link existe e ainda vale? Sem data de validade, vale. */
export function linkVale(p: Pick<PedidoPosVenda, "link_rastreio" | "link_valido_ate">, agora: Date): boolean {
  if (!p.link_rastreio) return false;
  return !p.link_valido_ate || p.link_valido_ate.getTime() > agora.getTime();
}

/**
 * Qual é a próxima coisa a fazer com este pedido (ou `null` se nada, hoje).
 * Uma etapa por rodada: o cron roda várias vezes ao dia e as outras esperam a próxima.
 */
export function proximaEtapa(p: PedidoPosVenda, agora: Date): Etapa | null {
  if (p.situacao === "pausada" || p.situacao === "cancelada" || p.situacao === "concluida") return null;

  if (p.situacao === "aguardando_link") {
    if (p.link_rastreio) return "msg1_com_link";
    return agora.getTime() - p.criado_em.getTime() > DIAS_PARA_DESISTIR_DO_LINK * DIA_MS ? "desistir" : "consultar";
  }

  // situacao === "ativa"
  if (!p.msg1_em) return linkVale(p, agora) ? "msg1_com_link" : "msg1_sem_link";

  if (!p.msg2_em && !p.instalacao_confirmada_em) {
    const base = p.entregue_em ?? p.msg1_em;
    return somaDias(base, DIAS_ATE_A_PERGUNTA).getTime() <= agora.getTime() ? "msg2" : null;
  }

  if (p.msg3_em) return null;

  // "Ainda não": aguarda 30 dias e pergunta uma única vez de novo.
  if (p.instalacao_adiada_em && !p.msg2_repetida_em && !p.instalacao_confirmada_em) {
    return somaDias(p.instalacao_adiada_em, DIAS_PARA_REPETIR).getTime() <= agora.getTime() ? "msg2_repetida" : null;
  }

  const base = p.instalacao_confirmada_em ?? p.msg2_repetida_em ?? p.msg2_em;
  if (!base) return null;
  return somaMeses(base, MESES_ATE_A_MANUTENCAO).getTime() <= agora.getTime() ? "msg3" : null;
}

/** Brasília não tem horário de verão desde 2019: UTC-3 fixo. Segunda a sábado, das 9h às 18h. */
export function dentroDoHorarioComercial(agora: Date): boolean {
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  const dia = local.getUTCDay();
  const hora = local.getUTCHours();
  return dia >= 1 && dia <= 6 && hora >= 9 && hora < 18;
}

/** O e-mail do cliente, nunca um da própria empresa (a ponte já devolveu o remetente como "cliente"). */
export function emailDoCliente(email: string | null | undefined, dominioDaEmpresa: string): string | null {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  const dominio = dominioDaEmpresa.trim().toLowerCase();
  if (dominio && e.endsWith(`@${dominio}`)) return null;
  return e;
}

export type NomeDoModelo = "climabrisa_pedido_enviado" | "climabrisa_pedido_enviado_sem_rastreio" | "climabrisa_instalacao" | "climabrisa_manutencao";

export interface MensagemMontada {
  modelo: NomeDoModelo;
  /** Valores por slot, na chave do `slotKey` (corpo: "1", "2"; botão de link: "button0:1"). */
  valores: Record<string, string>;
  /** Texto equivalente, para o histórico da conversa e para o e-mail. */
  texto: string;
  assunto: string;
}

export function primeiroNome(nome: string | null | undefined): string {
  const n = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!n || /^\d/.test(n) || n.includes("@")) return "cliente";
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** O pedaço do link depois de `/r/`, que é a parte variável do botão do modelo. */
export function codigoDoLink(link: string): string | null {
  const m = /^https:\/\/[^/]+\/r\/([A-Za-z0-9_-]+)\/?$/.exec(link.trim());
  return m ? m[1]! : null;
}

export function montarMensagem(
  etapa: Exclude<Etapa, "consultar" | "desistir">,
  d: { nome: string | null | undefined; nfe: string; link: string | null },
): MensagemMontada {
  const nome = primeiroNome(d.nome);
  switch (etapa) {
    case "msg1_com_link": {
      const codigo = d.link ? codigoDoLink(d.link) : null;
      // Link fora do formato do Rastreio Brisa: não cabe no botão do modelo; vai o aviso sem botão + link no texto.
      if (!d.link || !codigo) return montarMensagem("msg1_sem_link", d);
      return {
        modelo: "climabrisa_pedido_enviado",
        valores: { "1": nome, "2": d.nfe, "button0:1": codigo },
        texto: `Olá, ${nome}! Seu pedido da Climabrisa (NF-e ${d.nfe}) foi enviado. Acompanhe a entrega: ${d.link}`,
        assunto: `Seu pedido Climabrisa foi enviado (NF-e ${d.nfe})`,
      };
    }
    case "msg1_sem_link":
      return {
        modelo: "climabrisa_pedido_enviado_sem_rastreio",
        valores: { "1": nome, "2": d.nfe },
        texto: `Olá, ${nome}! Seu pedido da Climabrisa (NF-e ${d.nfe}) foi faturado e enviado. Qualquer dúvida, responda esta mensagem.`,
        assunto: `Seu pedido Climabrisa foi enviado (NF-e ${d.nfe})`,
      };
    case "msg2":
    case "msg2_repetida":
      return {
        modelo: "climabrisa_instalacao",
        valores: { "1": nome, "2": d.nfe },
        texto: `Olá, ${nome}! O seu equipamento Climabrisa (NF-e ${d.nfe}) já foi instalado?`,
        assunto: `Seu equipamento Climabrisa já foi instalado? (NF-e ${d.nfe})`,
      };
    case "msg3":
      return {
        modelo: "climabrisa_manutencao",
        valores: { "1": nome },
        texto: `Olá, ${nome}! Já faz 8 meses que o seu equipamento Climabrisa foi instalado. Recomendamos a manutenção preventiva. Responda esta mensagem para agendar.`,
        assunto: "Hora da manutenção preventiva do seu equipamento Climabrisa",
      };
  }
}

/** Número da NF-e como vem digitado no negócio: só dígitos, sem zeros à esquerda, até 20. */
export function normalizaNfe(valor: unknown): string | null {
  const t = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor : "";
  const digitos = t.replace(/\D/g, "").replace(/^0+/, "");
  return digitos.length >= 1 && digitos.length <= 20 ? digitos : null;
}

/** Resposta do cliente ao botão do modelo de instalação. */
export function respostaDeInstalacao(texto: string | null | undefined): "instalou" | "ainda_nao" | null {
  const t = (texto ?? "").trim().toLowerCase();
  if (t === "já instalei" || t === "ja instalei") return "instalou";
  if (t === "ainda não" || t === "ainda nao") return "ainda_nao";
  return null;
}
