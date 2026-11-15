/**
 * sfy (fork Sales for You, Bloco C) — ferramenta do agente para encaminhar o negócio.
 *
 * `crm_distribuir_lead`: a IA informa categoria, cidade e UF colhidas na conversa; o CRM
 * escolhe o parceiro e o supervisor pela regra do banco (migration 5005) e aplica no negócio.
 * A IA NÃO escolhe o destino. A resposta traz só nomes — telefone e e-mail de parceiro nunca
 * voltam para o modelo.
 */
import { z } from "zod";

import { distribuirNegocio } from "@/lib/sfy/distribuicao";
import type { McpToolDefinition } from "../types";

const entrada = {
  lead_id: z.string().uuid(),
  categoria: z.enum(["climabrisa", "agro"]).describe("climabrisa (conforto humano, indústria, comércio) ou agro (estufa, pecuária de leite)"),
  cidade: z.string().min(1).max(120).describe("Cidade do cliente, como ele informou"),
  uf: z.string().length(2).describe("Sigla do estado, duas letras"),
};

export const crmDistribuirLead: McpToolDefinition<typeof entrada> = {
  name: "crm_distribuir_lead",
  description:
    "Encaminha o negócio ao parceiro ou ao supervisor responsável pela cidade do cliente. Use só depois de saber " +
    "o ambiente, algum dado do espaço, a cidade e o estado, e quando o cliente pedir preço ou orçamento. " +
    "Você informa categoria, cidade e UF; o CRM escolhe o destino e move o negócio. Se voltar `distribuido: false`, " +
    "não prometa nada ao cliente: diga que vai passar para a equipe e peça o atendimento humano.",
  inputSchema: entrada,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const r = await distribuirNegocio(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      input,
    );
    // Sem `destino` (carrega contatos): o modelo recebe só o resumo.
    const { destino: _omitido, ...resumo } = r;
    return resumo;
  },
};
