/**
 * sfy (fork Sales for You, Bloco D, D4) — relatório semanal por parceiro e supervisor.
 *
 * O resumo dos últimos 60 dias de cada pessoa (negócios recebidos, em aberto, ganhos, perdidos,
 * % de fechamento e valor fechado) por WhatsApp (número interno de Avisos) e e-mail. Esta parte
 * NÃO inclui o link de fechamento (desenho separado, ainda sem a decisão da cliente).
 *
 * Nasce DESLIGADO: só roda com `settings.sfy.relatorio_semanal = true`. Com
 * `settings.sfy.relatorio_semanal_teste = { whatsapp?, email? }` NADA vai a parceiro ou
 * supervisor: cada resumo sai só para esse destino de teste, com o nome de quem receberia.
 * Entre dois envios reais passam no mínimo 6 dias (a rota roda toda segunda; um reinício do
 * agendador não repete).
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneBR } from "@/lib/channels/phone-variants";
import { normalizaTexto } from "@/lib/sfy/distribuicao";
import { criarLinkDeFechamento } from "@/lib/sfy/fechamento";
import { dependenciasReais, type DependenciasDosAvisos } from "@/lib/sfy/avisos";
import {
  chavesDoCampo,
  juntarPorGrupo,
  rotulosDasOpcoes,
  type LinhaDestino,
  type LinhaDestinoBruta,
} from "@/lib/sfy/relatorios";

export const DIAS_DO_RESUMO = 60;
const PAUSA_ENTRE_ENVIOS_MS = 4000; // o número interno é um chip comum: sem rajada
const MAXIMO_DE_ENVIOS = 200;
const INTERVALO_MINIMO_MS = 6 * 24 * 60 * 60 * 1000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConfigDoSemanal {
  ligado: boolean;
  teste: { whatsapp: string | null; email: string | null } | null;
  ultimoEnvio: string | null;
  /** `settings.sfy.link_de_fechamento = true`: o resumo do PARCEIRO leva o link para informar fechamentos. */
  linkDeFechamento: boolean;
}

export function configDoSemanal(settings: unknown): ConfigDoSemanal {
  const sfy = ((settings as { sfy?: Record<string, unknown> } | null)?.sfy ?? {}) as Record<string, unknown>;
  const t = sfy.relatorio_semanal_teste as { whatsapp?: unknown; email?: unknown } | undefined;
  const email = typeof t?.email === "string" && EMAIL.test(t.email.trim()) ? t.email.trim() : null;
  const whatsapp = typeof t?.whatsapp === "string" && normalizePhoneBR(t.whatsapp) ? t.whatsapp : null;
  return {
    ligado: sfy.relatorio_semanal === true,
    teste: t && typeof t === "object" ? { whatsapp, email } : null,
    ultimoEnvio: typeof sfy.relatorio_semanal_ultimo_envio === "string" ? sfy.relatorio_semanal_ultimo_envio : null,
    linkDeFechamento: sfy.link_de_fechamento === true,
  };
}

/** Passou tempo suficiente desde o último envio real? (envio de teste não conta e não grava.) */
export function podeEnviarAgora(ultimoEnvio: string | null, agora: Date): boolean {
  if (!ultimoEnvio) return true;
  const t = Date.parse(ultimoEnvio);
  return Number.isNaN(t) || agora.getTime() - t >= INTERVALO_MINIMO_MS;
}

const dinheiro = (m: Record<string, number>): string => {
  const itens = Object.entries(m);
  if (itens.length === 0) return "R$ 0,00";
  return itens
    .map(([moeda, c]) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(c / 100))
    .join(" + ");
};

export function textoDoResumo(papel: "parceiro" | "supervisor", nome: string, l: LinhaDestino, linkDeFechamento?: string | null): { assunto: string; texto: string } {
  const pct = l.percentual_fechamento === null ? "sem negócio encerrado ainda" : `${(l.percentual_fechamento * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const linhas = [
    `Resumo dos últimos ${DIAS_DO_RESUMO} dias — Climabrisa`,
    papel === "parceiro" ? `Parceiro: ${nome}` : `Supervisor: ${nome}`,
    "",
    `Negócios recebidos: ${l.leads}`,
    `Em aberto: ${l.abertos}`,
    `Fechados (ganhos): ${l.ganhos}`,
    `Perdidos: ${l.perdidos}`,
    `Taxa de fechamento: ${pct}`,
    `Valor fechado: ${dinheiro(l.valor_ganho_por_moeda)}`,
    "",
    ...(linkDeFechamento
      ? ["Fechou algum negócio? Informe o valor e a nota por este link pessoal (vale por 8 dias, não compartilhe):", linkDeFechamento, ""]
      : []),
    "Dúvidas sobre algum negócio? Fale com o seu supervisor.",
  ];
  return { assunto: `Climabrisa — seu resumo dos últimos ${DIAS_DO_RESUMO} dias`, texto: linhas.join("\n") };
}

export interface Destinatario {
  /** id do cadastro (parceiro ou supervisor). */
  id?: string;
  papel: "parceiro" | "supervisor";
  nome: string;
  whatsapp: string | null;
  email: string | null;
  linha: LinhaDestino;
}

export interface ResumoDoSemanal {
  enviados: number;
  falhas: string[];
  pulados: string[];
  modo: "teste" | "real" | "desligado" | "cedo_demais";
}

/** Envia os resumos. Pura em relação ao banco: recebe os destinatários e os transportes. */
export async function enviarResumos(
  deps: DependenciasDosAvisos,
  config: ConfigDoSemanal,
  destinatarios: Destinatario[],
  opcoes: { pausaMs?: number; gerarLink?: (d: Destinatario) => Promise<string | null> } = {},
): Promise<ResumoDoSemanal> {
  const r: ResumoDoSemanal = { enviados: 0, falhas: [], pulados: [], modo: config.teste ? "teste" : "real" };
  if (!config.ligado) return { ...r, modo: "desligado", pulados: ["relatorio_semanal_desligado"] };
  const pausa = opcoes.pausaMs ?? PAUSA_ENTRE_ENVIOS_MS;
  let envios = 0;

  for (const d of destinatarios) {
    if (envios >= MAXIMO_DE_ENVIOS) {
      r.pulados.push("teto_de_envios");
      break;
    }
    let link: string | null = null;
    if (config.linkDeFechamento && d.papel === "parceiro" && opcoes.gerarLink) {
      try {
        link = await opcoes.gerarLink(d);
      } catch {
        r.falhas.push(`link:${d.nome}`);
      }
    }
    const { assunto, texto } = textoDoResumo(d.papel, d.nome, d.linha, link);
    const prefixo = config.teste ? `[TESTE — iria para ${d.nome}]\n` : "";
    const numero = normalizePhoneBR((config.teste ? config.teste.whatsapp : d.whatsapp) ?? "");
    const email = (config.teste ? config.teste.email : d.email)?.trim().toLowerCase() ?? "";

    if (!numero && !EMAIL.test(email)) {
      r.pulados.push(`sem_contato:${d.nome}`);
      continue;
    }
    if (numero) {
      try {
        await deps.enviaWhatsapp(numero, prefixo + texto);
        r.enviados += 1;
      } catch {
        r.falhas.push(`whatsapp:${d.nome}`);
      }
      envios += 1;
      if (pausa > 0) await new Promise((res) => setTimeout(res, pausa));
    }
    if (EMAIL.test(email)) {
      try {
        const corpo = (prefixo + texto).replace(/\n/g, "<br>");
        const res = await deps.enviaEmail({ to: [email], subject: prefixo ? `[TESTE] ${assunto}` : assunto, text: prefixo + texto, html: `<p>${corpo}</p>` });
        if (res.ok) r.enviados += 1;
        else r.falhas.push(`email:${d.nome}`);
      } catch {
        r.falhas.push(`email:${d.nome}`);
      }
    }
  }
  return r;
}

const CODIGO_DO_ROTULO = /^\s*(\S+?)\s*[-–]/;

/** Liga cada grupo do relatório (valor do campo) ao parceiro/supervisor cadastrado. */
export function ligarGrupos(
  linhas: LinhaDestino[],
  papel: "parceiro" | "supervisor",
  cadastro: Array<{ id?: string; codigo?: string | null; nome: string; whatsapp: string | null; email: string | null; ativo: boolean }>,
): Destinatario[] {
  const saida: Destinatario[] = [];
  for (const l of linhas) {
    if (l.grupo === "") continue;
    const rotulo = l.rotulo ?? l.grupo;
    const alvos = new Set([normalizaTexto(l.grupo), normalizaTexto(rotulo)]);
    const codigo = CODIGO_DO_ROTULO.exec(rotulo)?.[1];
    const achou = cadastro.find((c) => {
      if (!c.ativo) return false;
      if (papel === "parceiro") return (c.codigo && (alvos.has(normalizaTexto(c.codigo)) || codigo === c.codigo)) || alvos.has(normalizaTexto(c.nome));
      return alvos.has(normalizaTexto(c.nome)) || [...alvos].some((a) => a.startsWith(normalizaTexto(c.nome)));
    });
    if (achou) saida.push({ id: achou.id, papel, nome: achou.nome, whatsapp: achou.whatsapp, email: achou.email, linha: l });
  }
  return saida;
}

/** Executa o relatório semanal de uma organização. */
export async function executarRelatorioSemanal(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  agora: Date,
  deps: DependenciasDosAvisos = dependenciasReais(admin, organizationId, "sfy-relatorio-semanal"),
  opcoes: { pausaMs?: number; urlPublica?: string } = {},
): Promise<ResumoDoSemanal> {
  const { data: org } = await admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
  const config = configDoSemanal(org?.settings);
  if (!config.ligado) return { enviados: 0, falhas: [], pulados: ["relatorio_semanal_desligado"], modo: "desligado" };
  if (!config.teste && !podeEnviarAgora(config.ultimoEnvio, agora)) {
    return { enviados: 0, falhas: [], pulados: ["enviado_ha_menos_de_6_dias"], modo: "cedo_demais" };
  }

  const ate = new Date(agora.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const de = new Date(agora.getTime() - DIAS_DO_RESUMO * 24 * 60 * 60 * 1000).toISOString();
  const { data: funis } = await admin.from("crm_pipelines").select("settings").eq("organization_id", organizationId);
  const [{ data: parceiros }, { data: supervisores }] = await Promise.all([
    admin.from("sfy_parceiros").select("id, codigo, nome, whatsapp, email, ativo").eq("organization_id", organizationId),
    admin.from("sfy_supervisores").select("id, nome, whatsapp, email, ativo").eq("organization_id", organizationId),
  ]);

  const destinatarios: Destinatario[] = [];
  for (const [papel, rotuloDoCampo, cadastro] of [
    ["parceiro", "Parceiro responsável", parceiros ?? []],
    ["supervisor", "Supervisor", supervisores ?? []],
  ] as const) {
    const chaves = chavesDoCampo(funis ?? [], rotuloDoCampo, normalizaTexto);
    if (chaves.length === 0) continue;
    const { data } = await admin.rpc("fn_sfy_relatorio_por_destino", {
      p_org: organizationId, p_de: de, p_ate: ate, p_chaves: chaves, p_incluir_historico: false,
    });
    const nomes = rotulosDasOpcoes(funis ?? [], rotuloDoCampo, normalizaTexto);
    const linhas = juntarPorGrupo((data ?? []) as LinhaDestinoBruta[]).map((l) => ({ ...l, rotulo: nomes.get(l.grupo) ?? l.grupo }));
    destinatarios.push(...ligarGrupos(linhas, papel, cadastro as never));
  }

  const urlPublica = (opcoes.urlPublica ?? (await import("@/lib/env")).env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const gerarLink = async (d: Destinatario): Promise<string | null> => {
    if (!d.id || !urlPublica) return null;
    // Em teste, o link novo NÃO revoga o que o parceiro já tem: ensaio não derruba link de verdade.
    const token = await criarLinkDeFechamento(admin, organizationId, d.id, agora, { revogarAnteriores: !config.teste });
    return `${urlPublica}/fechamento/${token}`;
  };
  const resumo = await enviarResumos(deps, config, destinatarios, { pausaMs: opcoes.pausaMs, gerarLink });
  if (!config.teste && resumo.enviados > 0) {
    const sfy = ((org?.settings as { sfy?: Record<string, unknown> } | null)?.sfy ?? {}) as Record<string, unknown>;
    await admin
      .from("organizations")
      .update({ settings: { ...((org?.settings as object) ?? {}), sfy: { ...sfy, relatorio_semanal_ultimo_envio: agora.toISOString() } } })
      .eq("id", organizationId);
  }
  return resumo;
}
