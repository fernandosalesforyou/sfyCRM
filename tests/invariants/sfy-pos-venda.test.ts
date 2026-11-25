/**
 * sfy (fork Sales for You, etapa 10) — migration 5011.
 *
 * Pós-venda por NF-e: um pedido por negócio, uma NF-e (e série) por organização, link só https,
 * situação fechada; a tabela é só do servidor (membro autenticado não lê nem escreve) e apagar
 * o negócio leva o pedido junto.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const org = randomUUID();
const membro = randomUUID();
const lead = randomUUID();
const lead2 = randomUUID();

function falha(consulta: string): boolean {
  try {
    sql(consulta);
    return false;
  } catch {
    return true;
  }
}

const comoMembro = (consulta: string) =>
  `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false); ${consulta}`;

const ins = (l: string, nfe: string, extra = "") =>
  `insert into public.sfy_pedidos_pos_venda (organization_id, lead_id, nfe_numero${extra ? ", " + extra.split("=")[0] : ""}) values ('${org}', '${l}', '${nfe}'${extra ? ", " + extra.split("=").slice(1).join("=") : ""});`;

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-posvenda-membro@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${org}', 'admin', now());`);
  const funil = randomUUID();
  const etapa = randomUUID();
  sql(`insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${etapa}', '${org}', '${funil}', 'Novo', 'novo', 0);
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title) values ('${lead}', '${org}', '${funil}', '${etapa}', 'Negócio fictício 1');
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title) values ('${lead2}', '${org}', '${funil}', '${etapa}', 'Negócio fictício 2');`);
});

describe("sfy-pos-venda (5011)", () => {
  it("um pedido por negócio e uma NF-e por organização", () => {
    sql(ins(lead, "54552"));
    expect(falha(ins(lead, "54553"))).toBe(true); // mesmo negócio
    expect(falha(ins(lead2, "54552"))).toBe(true); // mesma NF-e (série vazia)
    sql(ins(lead2, "54552", "nfe_serie='2'")); // outra série é outra nota
  });

  it("nasce aguardando o link, sem mensagens enviadas", () => {
    const linha = sql(`select situacao, msg1_em is null, msg2_em is null, msg3_em is null, tentativas from public.sfy_pedidos_pos_venda where lead_id = '${lead}';`).trim();
    expect(linha).toBe("aguardando_link|t|t|t|0");
  });

  it("link só https; situação só as conhecidas; NF-e não vazia", () => {
    expect(falha(`update public.sfy_pedidos_pos_venda set link_rastreio = 'http://x.com/r/1' where lead_id = '${lead}';`)).toBe(true);
    expect(falha(`update public.sfy_pedidos_pos_venda set link_rastreio = 'javascript:alert(1)' where lead_id = '${lead}';`)).toBe(true);
    sql(`update public.sfy_pedidos_pos_venda set link_rastreio = 'https://rastreio.climabrisa.com.br/r/abc' where lead_id = '${lead}';`);
    expect(falha(`update public.sfy_pedidos_pos_venda set situacao = 'enviado' where lead_id = '${lead}';`)).toBe(true);
    expect(falha(ins(randomUUID(), ""))).toBe(true);
  });

  it("membro autenticado, mesmo administrador, não lê nem escreve a tabela", () => {
    expect(falha(comoMembro(`select * from public.sfy_pedidos_pos_venda;`))).toBe(true);
    expect(falha(comoMembro(`update public.sfy_pedidos_pos_venda set situacao = 'cancelada';`))).toBe(true);
    expect(falha(comoMembro(ins(lead, "99999")))).toBe(true);
  });

  it("anonimizar o contato cancela a sequência e apaga o link de rastreio", () => {
    const contato = randomUUID();
    sql(`insert into public.contacts (id, organization_id, name) values ('${contato}', '${org}', 'Pessoa Fictícia');
      update public.sfy_pedidos_pos_venda set contact_id = '${contato}', situacao = 'ativa', link_rastreio = 'https://rastreio.exemplo.test/r/x' where lead_id = '${lead}';
      update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${contato}';`);
    expect(
      sql(`select situacao || '|' || coalesce(link_rastreio, 'sem-link') from public.sfy_pedidos_pos_venda where lead_id = '${lead}';`).trim(),
    ).toBe("cancelada|sem-link");
  });

  it("apagar o negócio leva o pedido junto", () => {
    sql(`delete from public.crm_leads where id = '${lead}';`);
    expect(sql(`select count(*) from public.sfy_pedidos_pos_venda where lead_id = '${lead}';`).trim()).toBe("0");
  });
});
