/**
 * sfy (fork Sales for You, Bloco C) — distribuição do negócio.
 *
 * Quem DECIDE o destino é o banco (`fn_sfy_escolher_destino`, migration 5005): Agro por UF;
 * Climabrisa pelo parceiro da cidade (um, ou rodízio) ou, sem parceiro, pelo supervisor da
 * cidade. Este módulo só APLICA a decisão no negócio, pelas mesmas portas das telas:
 *
 *   1. grava os campos "Parceiro responsável" e "Supervisor" (achados pelo rótulo no funil;
 *      opção que não existe na lista do campo é pulada e relatada, nunca inventada);
 *   2. passa o dono do negócio para o supervisor (decisão do Bloco A: o supervisor vê os
 *      negócios dele e dos representantes dele), quando o supervisor já é usuário do CRM;
 *   3. move o negócio para "Em negociação por representante" ou "... por supervisor".
 *
 * Sem destino (cidade sem cobertura, dados faltando) NADA é alterado e o motivo volta para
 * quem chamou — a IA então passa o caso para a fila humana.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import { avisarDaDistribuicao, type ResumoDosAvisos } from "@/lib/sfy/avisos";

export type MotivoDoDestino =
  | "agro_por_uf"
  | "parceiro_unico"
  | "rodizio"
  | "supervisor_da_cidade"
  | "supervisor_padrao"
  | "sem_destino";

export interface DestinoEscolhido {
  motivo: MotivoDoDestino;
  detalhe?: string;
  etapa?: "representante" | "supervisor";
  parceiro_id?: string | null;
  parceiro_codigo?: string | null;
  parceiro_nome?: string | null;
  supervisor_id?: string | null;
  supervisor_nome?: string | null;
  supervisor_user_id?: string | null;
  /** Simulação: nada foi gravado, o rodízio não andou. */
  simulacao?: boolean;
  /** Parceiros elegíveis na cidade, na ordem do rodízio (o primeiro é o próximo). */
  elegiveis?: { codigo: string; nome: string }[];
}

export interface ContextoDaDistribuicao {
  organization_id: string;
  actor: Parameters<typeof updateLeadHandler>[1]["actor"];
  requestId: string;
}

export interface ResultadoDaDistribuicao {
  distribuido: boolean;
  motivo: MotivoDoDestino;
  detalhe?: string;
  etapa_destino?: string;
  parceiro?: string | null;
  supervisor?: string | null;
  dono_definido?: boolean;
  campos_nao_gravados?: string[];
  /** Resumo dos avisos ao parceiro e ao supervisor (nada sai com a regra desligada). */
  avisos?: ResumoDosAvisos;
  /** Texto com os dados do supervisor para a IA entregar ao cliente (nunca os do parceiro). */
  texto_para_o_cliente?: string | null;
  destino?: DestinoEscolhido;
}

/** Sem acento, minúsculo, espaços únicos. */
export function normalizaTexto(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** O campo do funil pelo rótulo (ignora acento e caixa). */
export function acharCampoPorRotulo(campos: CustomFieldDef[], rotulo: string): CustomFieldDef | null {
  const alvo = normalizaTexto(rotulo);
  return campos.find((c) => normalizaTexto(c.label) === alvo) ?? null;
}

/** A opção do campo que corresponde ao parceiro (pelo código) — `null` se não existir. */
export function opcaoDoParceiro(campo: CustomFieldDef, codigo: string): string | null {
  const opcoes = campo.options ?? [];
  const exata = opcoes.find((o) => o.value === codigo);
  if (exata) return exata.value;
  const porRotulo = opcoes.find((o) => new RegExp(`^\\s*${escapaRegex(codigo)}\\s*[-–]`).test(o.label));
  return porRotulo?.value ?? null;
}

/** A opção do campo que corresponde ao supervisor (nome igual, ou o primeiro nome) — `null` se não existir. */
export function opcaoDoSupervisor(campo: CustomFieldDef, nome: string): string | null {
  const opcoes = campo.options ?? [];
  const alvo = normalizaTexto(nome);
  const exata = opcoes.find((o) => normalizaTexto(o.label) === alvo || normalizaTexto(o.value) === alvo);
  if (exata) return exata.value;
  const primeiro = alvo.split(" ")[0] ?? "";
  const candidatas = opcoes.filter((o) => normalizaTexto(o.label).split(" ")[0] === primeiro);
  return candidatas.length === 1 ? (candidatas[0]?.value ?? null) : null;
}

function escapaRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** O que gravar no campo "Supervisor": a opção, quando é lista; o próprio nome, quando é texto livre. */
export function valorDoSupervisor(campo: CustomFieldDef, nome: string): string | null {
  return campo.type === "text" ? nome : opcaoDoSupervisor(campo, nome);
}

/** A etapa do funil de destino: "Em negociação por representante" ou "... por supervisor". */
export function acharEtapaDeDestino(
  etapas: { id: string; name: string }[],
  destino: "representante" | "supervisor",
): { id: string; name: string } | null {
  const achadas = etapas.filter((e) => {
    const n = normalizaTexto(e.name);
    return n.includes("negociacao") && n.includes(destino === "representante" ? "representante" : "supervisor");
  });
  return achadas.length === 1 ? (achadas[0] ?? null) : null;
}

export async function escolherDestino(
  supabase: SupabaseClient,
  organizationId: string,
  categoria: string,
  cidade: string,
  uf: string,
): Promise<DestinoEscolhido> {
  const { data, error } = await supabase.rpc("fn_sfy_escolher_destino", {
    p_org: organizationId,
    p_categoria: categoria,
    p_cidade: cidade,
    p_uf: uf,
  });
  if (error) throw new Error(`sfy_escolher_destino_falhou: ${error.message}`);
  return data as DestinoEscolhido;
}

export async function distribuirNegocio(
  supabase: SupabaseClient,
  ctx: ContextoDaDistribuicao,
  entrada: { lead_id: string; categoria: string; cidade: string; uf: string },
): Promise<ResultadoDaDistribuicao> {
  // O negócio (da organização certa) antes de gastar o rodízio.
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id, custom_fields")
    .eq("organization_id", ctx.organization_id)
    .eq("id", entrada.lead_id)
    .maybeSingle();
  if (!lead) return { distribuido: false, motivo: "sem_destino", detalhe: "negocio_nao_encontrado" };

  const destino = await escolherDestino(supabase, ctx.organization_id, entrada.categoria, entrada.cidade, entrada.uf);
  if (destino.motivo === "sem_destino" || !destino.etapa) {
    return { distribuido: false, motivo: "sem_destino", detalhe: destino.detalhe, destino };
  }

  const [{ data: funil }, { data: etapas }] = await Promise.all([
    supabase.from("crm_pipelines").select("settings").eq("organization_id", ctx.organization_id).eq("id", lead.pipeline_id).maybeSingle(),
    supabase.from("crm_stages").select("id, name").eq("organization_id", ctx.organization_id).eq("pipeline_id", lead.pipeline_id),
  ]);
  const campos = camposDoFunil((funil?.settings ?? null) as Record<string, unknown> | null);
  const naoGravados: string[] = [];

  const patch: Record<string, unknown> = { ...((lead.custom_fields as Record<string, unknown> | null) ?? {}) };
  if (destino.parceiro_codigo) {
    const campo = acharCampoPorRotulo(campos, "Parceiro responsável");
    const valor = campo ? opcaoDoParceiro(campo, destino.parceiro_codigo) : null;
    if (campo && valor) patch[campo.key] = valor;
    else naoGravados.push("Parceiro responsável");
  }
  if (destino.supervisor_nome) {
    const campo = acharCampoPorRotulo(campos, "Supervisor");
    const valor = campo ? valorDoSupervisor(campo, destino.supervisor_nome) : null;
    if (campo && valor) patch[campo.key] = valor;
    else naoGravados.push("Supervisor");
  }

  const handlerCtx = { organization_id: ctx.organization_id, actor: ctx.actor, requestId: ctx.requestId };
  const donoDefinido = Boolean(destino.supervisor_user_id);
  await updateLeadHandler(supabase, handlerCtx, entrada.lead_id, {
    custom_fields: patch,
    ...(donoDefinido ? { owner_user_id: destino.supervisor_user_id as string } : {}),
  } as Parameters<typeof updateLeadHandler>[3]);

  const etapa = acharEtapaDeDestino(etapas ?? [], destino.etapa);
  if (etapa) {
    await moveLeadHandler(supabase, handlerCtx, entrada.lead_id, {
      to_stage_id: etapa.id,
      reason: `Distribuição automática (${destino.motivo})`,
    } as Parameters<typeof moveLeadHandler>[3]);
  } else {
    naoGravados.push("Etapa de destino");
  }

  // Avisos: melhor esforço. Falha aqui NÃO desfaz a distribuição; volta no resumo.
  let avisos: ResumoDosAvisos | undefined;
  let textoParaOCliente: string | null = null;
  try {
    const categoria = entrada.categoria === "agro" ? "agro" : "climabrisa";
    const r = await avisarDaDistribuicao(supabase, {
      organization_id: ctx.organization_id,
      lead_id: entrada.lead_id,
      categoria,
      cidade: entrada.cidade,
      uf: entrada.uf,
      destino,
    });
    const { texto_para_o_cliente, ...resumo } = r;
    avisos = resumo;
    textoParaOCliente = texto_para_o_cliente;
  } catch {
    avisos = { enviados: [], falhas: ["avisos"], pulados: [] };
  }

  return {
    distribuido: true,
    motivo: destino.motivo,
    etapa_destino: etapa?.name,
    parceiro: destino.parceiro_nome ?? null,
    supervisor: destino.supervisor_nome ?? null,
    dono_definido: donoDefinido,
    ...(naoGravados.length ? { campos_nao_gravados: naoGravados } : {}),
    avisos,
    texto_para_o_cliente: textoParaOCliente,
    destino,
  };
}
