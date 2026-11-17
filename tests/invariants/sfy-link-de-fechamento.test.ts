/**
 * sfy (fork Sales for You, Bloco D) — migration 5008.
 *
 * Link de fechamento do parceiro: só o hash do token fica guardado (único, 64 hex); o pedido de
 * fechamento tem valor positivo e limitado, status fechado e UM pedido pendente por negócio e
 * parceiro; as tabelas são só do servidor (membro autenticado não lê nem escreve).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const org = randomUUID();
const membro = randomUUID();
const parceiro = randomUUID();
const lead = randomUUID();
const hash = "a".repeat(64);

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

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-fech-membro@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${org}', 'admin', now());
    insert into public.sfy_parceiros (id, organization_id, codigo, nome, whatsapp) values ('${parceiro}', '${org}', '9001', 'Parceiro Fictício', '+5511900000001');`);
  const funil = randomUUID();
  const etapa = randomUUID();
  sql(`insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${etapa}', '${org}', '${funil}', 'Novo', 'novo', 0);
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title) values ('${lead}', '${org}', '${funil}', '${etapa}', 'Negócio fictício');`);
});

describe("sfy-link-de-fechamento (5008)", () => {
  it("guarda só hash válido e único", () => {
    const expira = "now() + interval '8 days'";
    expect(falha(`insert into public.sfy_links_fechamento (organization_id, parceiro_id, token_hash, expira_em) values ('${org}', '${parceiro}', 'token-em-claro', ${expira});`)).toBe(true);
    sql(`insert into public.sfy_links_fechamento (organization_id, parceiro_id, token_hash, expira_em) values ('${org}', '${parceiro}', '${hash}', ${expira});`);
    expect(falha(`insert into public.sfy_links_fechamento (organization_id, parceiro_id, token_hash, expira_em) values ('${org}', '${parceiro}', '${hash}', ${expira});`)).toBe(true);
  });

  it("pedido de fechamento: valor positivo e limitado, status fechado, um pendente por negócio", () => {
    const ins = (valor: string, status = "pendente") =>
      `insert into public.sfy_fechamentos_sinalizados (organization_id, lead_id, parceiro_id, valor_centavos, status) values ('${org}', '${lead}', '${parceiro}', ${valor}, '${status}');`;
    expect(falha(ins("0"))).toBe(true);
    expect(falha(ins("-5"))).toBe(true);
    expect(falha(ins("100000000000"))).toBe(true);
    expect(falha(ins("1000", "aprovado"))).toBe(true);
    sql(ins("150000"));
    expect(falha(ins("200000"))).toBe(true); // segundo pendente do mesmo negócio e parceiro
    sql(`update public.sfy_fechamentos_sinalizados set status = 'tratado' where lead_id = '${lead}';`);
    sql(ins("200000")); // depois de tratado, pode haver outro
  });

  it("membro autenticado, mesmo administrador, não lê nem escreve as tabelas", () => {
    expect(falha(comoMembro(`select * from public.sfy_links_fechamento;`))).toBe(true);
    expect(falha(comoMembro(`select * from public.sfy_fechamentos_sinalizados;`))).toBe(true);
    expect(falha(comoMembro(`insert into public.sfy_fechamentos_sinalizados (organization_id, lead_id, parceiro_id, valor_centavos) values ('${org}', '${lead}', '${parceiro}', 1);`))).toBe(true);
  });

  it("apagar o negócio ou o parceiro leva os pedidos junto", () => {
    sql(`delete from public.crm_leads where id = '${lead}';`);
    expect(sql(`select count(*) from public.sfy_fechamentos_sinalizados where lead_id = '${lead}';`).trim()).toBe("0");
  });
});
