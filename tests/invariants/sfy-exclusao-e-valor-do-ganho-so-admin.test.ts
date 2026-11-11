/**
 * sfy (fork Sales for You, Bloco A2/A3) — migration 5001.
 *
 * Com `organizations.settings.sfy.exclusao_so_admin` / `valor_do_ganho_so_admin`
 * ligados, só o admin apaga negócio/contato e só o admin altera o valor ou
 * reabre um negócio ganho. Desligados, o comportamento é o do original. A regra
 * de uma organização não alcança a outra. Escrita sem usuário (service role)
 * não é barrada.
 *
 * Postgres REAL: `set role authenticated` + `request.jwt.claims`, as mesmas
 * policies e gatilhos que o PostgREST aplica.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const agente = randomUUID();
const admin = randomUUID();
const funil: Record<string, string> = {};
const etapaAberta: Record<string, string> = {};
const etapaGanho: Record<string, string> = {};

/** Roda o DML como o usuário; devolve "ok" ou a mensagem de erro do banco. */
function como(userId: string, dml: string): string {
  try {
    sql(`set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
      ${dml}`);
    return "ok";
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

function ligar(org: string, regras: Record<string, boolean>): void {
  sql(`update public.organizations
          set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('sfy', '${JSON.stringify(regras)}'::jsonb)
        where id = '${org}';`);
}

function novoNegocio(org: string, opcoes: { ganho?: boolean; valor?: number } = {}): string {
  const id = randomUUID();
  const contato = randomUUID();
  const stage = opcoes.ganho ? etapaGanho[org] : etapaAberta[org];
  sql(`insert into public.contacts (id, organization_id, display_name) values ('${contato}', '${org}', 'Contato fictício');
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, owner_user_id, value_cents)
      values ('${id}', '${org}', '${funil[org]}', '${stage}', '${contato}', 'Negócio fictício', '${agente}', ${opcoes.valor ?? "null"});`);
  return id;
}

function existe(tabela: string, id: string): boolean {
  return sql(`select exists(select 1 from public.${tabela} where id = '${id}');`) === "t";
}

beforeAll(() => {
  sql(`insert into auth.users (id, email) values
         ('${agente}', 'sfy-agente@invariant.test'), ('${admin}', 'sfy-admin@invariant.test');`);
  for (const org of [orgA, orgB]) {
    funil[org] = randomUUID();
    etapaAberta[org] = randomUUID();
    etapaGanho[org] = randomUUID();
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${agente}', '${org}', 'agent', now()), ('${admin}', '${org}', 'admin', now());
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil[org]}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${etapaAberta[org]}', '${org}', '${funil[org]}', 'Em negociação', 'em-negociacao', 1);
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won) values
        ('${etapaGanho[org]}', '${org}', '${funil[org]}', 'Ganho', 'ganho', 2, true);`);
  }
  ligar(orgA, { exclusao_so_admin: true, valor_do_ganho_so_admin: true });
});

describe("sfy 5001 — exclusão só pelo admin", () => {
  it("regra ligada: atendente não apaga negócio; admin apaga", () => {
    const lead = novoNegocio(orgA);
    expect(como(agente, `delete from public.crm_leads where id = '${lead}';`)).toContain("sfy_delete_admin_only");
    expect(existe("crm_leads", lead)).toBe(true);
    expect(como(admin, `delete from public.crm_leads where id = '${lead}';`)).toBe("ok");
    expect(existe("crm_leads", lead)).toBe(false);
  });

  it("regra ligada: a recusa do contato desfaz o histórico apagado antes da ficha", () => {
    const contato = randomUUID();
    const sessao = randomUUID();
    const conversa = randomUUID();
    sql(`insert into public.contacts (id, organization_id, display_name) values ('${contato}', '${orgA}', 'Contato fictício');
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${sessao}', '${orgA}', '${sessao}', '\\x00');
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, assigned_to_user_id)
        values ('${conversa}', '${orgA}', '${contato}', '${sessao}', '${agente}');`);
    expect(
      como(agente, `select public.fn_apagar_contato_com_historico('${contato}', '${orgA}');`),
    ).toContain("sfy_delete_admin_only");
    expect(existe("contacts", contato)).toBe(true);
    expect(existe("conversations", conversa)).toBe(true);
  });

  it("regra desligada (outra organização): atendente apaga como no original", () => {
    const lead = novoNegocio(orgB);
    expect(como(agente, `delete from public.crm_leads where id = '${lead}';`)).toBe("ok");
    expect(existe("crm_leads", lead)).toBe(false);
  });

  it("escrita sem usuário (service role) não é barrada", () => {
    const lead = novoNegocio(orgA);
    sql(`delete from public.crm_leads where id = '${lead}';`);
    expect(existe("crm_leads", lead)).toBe(false);
  });
});

describe("sfy 5001 — valor do ganho só pelo admin", () => {
  it("regra ligada: atendente não altera o valor nem reabre; edita outros campos", () => {
    const lead = novoNegocio(orgA, { ganho: true, valor: 100000 });
    expect(sql(`select status from public.crm_leads where id = '${lead}';`)).toBe("won");
    expect(
      como(agente, `update public.crm_leads set value_cents = 1 where id = '${lead}';`),
    ).toContain("sfy_won_value_admin_only");
    expect(
      como(agente, `update public.crm_leads set stage_id = '${etapaAberta[orgA]}' where id = '${lead}';`),
    ).toContain("sfy_won_value_admin_only");
    expect(como(agente, `update public.crm_leads set title = 'Novo título' where id = '${lead}';`)).toBe("ok");
    expect(sql(`select value_cents || '|' || status from public.crm_leads where id = '${lead}';`)).toBe(
      "100000|won",
    );
  });

  it("regra ligada: admin altera o valor e reabre", () => {
    const lead = novoNegocio(orgA, { ganho: true, valor: 100000 });
    expect(como(admin, `update public.crm_leads set value_cents = 250000 where id = '${lead}';`)).toBe("ok");
    expect(
      como(admin, `update public.crm_leads set stage_id = '${etapaAberta[orgA]}' where id = '${lead}';`),
    ).toBe("ok");
    expect(sql(`select value_cents || '|' || status from public.crm_leads where id = '${lead}';`)).toBe(
      "250000|open",
    );
  });

  it("regra ligada: negócio aberto segue livre para o atendente (inclusive ganhar com valor)", () => {
    const lead = novoNegocio(orgA);
    expect(como(agente, `update public.crm_leads set value_cents = 5000 where id = '${lead}';`)).toBe("ok");
    expect(
      como(agente, `update public.crm_leads set stage_id = '${etapaGanho[orgA]}' where id = '${lead}';`),
    ).toBe("ok");
    expect(sql(`select status from public.crm_leads where id = '${lead}';`)).toBe("won");
  });

  it("regra desligada (outra organização): atendente altera o ganho como no original", () => {
    const lead = novoNegocio(orgB, { ganho: true, valor: 100000 });
    expect(como(agente, `update public.crm_leads set value_cents = 1 where id = '${lead}';`)).toBe("ok");
  });
});
