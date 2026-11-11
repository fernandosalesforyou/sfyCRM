/**
 * sfy (fork Sales for You, Bloco A1) — migration 5002.
 *
 * Organização em `visibility_mode = 'own'`: o atendente com a permissão "ver
 * todos os leads" enxerga negócios e conversas da organização inteira e pode
 * passar um negócio para um supervisor; cada supervisor (atendente sem a
 * permissão) só vê o que é dele e não consegue passar o próprio negócio para
 * outro. A permissão de uma organização não vale na outra. A tabela só é
 * escrita pelo servidor.
 *
 * Também guarda o MERGE: se uma atualização do original redefinir as três
 * funções depois do bloco sfy, a última definição no baseline perde o ramo e
 * este teste reprova (ver Estrategia_Fork_Climabrisa.md).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const atendimento = randomUUID();
const sup1 = randomUUID();
const sup2 = randomUUID();
const leadSup1: Record<string, string> = {};
const leadSup2: Record<string, string> = {};
const leadSemDono: Record<string, string> = {};
const convSup1: Record<string, string> = {};
const convSemDono: Record<string, string> = {};

const contaLeads = (org: string) => `select count(*) from public.crm_leads where organization_id = '${org}';`;
const contaConversas = (org: string) =>
  `select count(*) from public.conversations where organization_id = '${org}';`;

beforeAll(() => {
  sql(`insert into auth.users (id, email) values
    ('${atendimento}', 'sfy-atendimento@invariant.test'),
    ('${sup1}', 'sfy-sup1@invariant.test'),
    ('${sup2}', 'sfy-sup2@invariant.test');`);
  for (const org of [orgA, orgB]) {
    const funil = randomUUID();
    const etapa = randomUUID();
    const sessao = randomUUID();
    sql(`insert into public.organizations (id, slug, legal_name, display_name, settings)
           values ('${org}', '${org}', 'Sfy', 'Sfy', '{"visibility_mode":"own"}'::jsonb);
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${atendimento}', '${org}', 'agent', now()), ('${sup1}', '${org}', 'agent', now()), ('${sup2}', '${org}', 'agent', now());
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${etapa}', '${org}', '${funil}', 'Em negociação', 'em-negociacao', 1);
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${sessao}', '${org}', '${sessao}', '\\x00');`);
    leadSup1[org] = randomUUID();
    leadSup2[org] = randomUUID();
    leadSemDono[org] = randomUUID();
    convSup1[org] = randomUUID();
    convSemDono[org] = randomUUID();
    for (const [lead, dono] of [
      [leadSup1[org], `'${sup1}'`],
      [leadSup2[org], `'${sup2}'`],
      [leadSemDono[org], "null"],
    ] as const) {
      sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id)
             values ('${lead}', '${org}', '${funil}', '${etapa}', 'Negócio fictício', ${dono});`);
    }
    for (const [conv, dono] of [
      [convSup1[org], `'${sup1}'`],
      [convSemDono[org], "null"],
    ] as const) {
      const contato = randomUUID();
      sql(`insert into public.contacts (id, organization_id, display_name) values ('${contato}', '${org}', 'Contato fictício');
        insert into public.conversations (id, organization_id, contact_id, channel_session_id, assigned_to_user_id)
          values ('${conv}', '${org}', '${contato}', '${sessao}', ${dono});`);
    }
  }
  // Só na organização A o atendimento tem a permissão (escrita do servidor).
  sql(`insert into public.sfy_permissoes_do_membro (organization_id, user_id, ver_todos_os_leads)
         values ('${orgA}', '${atendimento}', true);`);
});

describe("sfy 5002 — ver todos os leads", () => {
  it("atendimento com a permissão vê todos os negócios e conversas da organização", () => {
    expect(countAs(atendimento, contaLeads(orgA))).toBe(3);
    expect(countAs(atendimento, contaConversas(orgA))).toBe(2);
  });

  it("cada supervisor vê só o que é dele (modo own)", () => {
    expect(countAs(sup1, contaLeads(orgA))).toBe(1);
    expect(countAs(sup1, contaConversas(orgA))).toBe(1);
    expect(countAs(sup2, contaLeads(orgA))).toBe(1);
    expect(countAs(sup2, contaConversas(orgA))).toBe(0);
  });

  it("a permissão da organização A não vale na organização B", () => {
    expect(countAs(atendimento, contaLeads(orgB))).toBe(0);
    expect(countAs(atendimento, contaConversas(orgB))).toBe(0);
  });

  it("atendimento passa o negócio sem dono para o supervisor", () => {
    expect(
      writeCountAs(
        atendimento,
        `update public.crm_leads set owner_user_id = '${sup1}' where id = '${leadSemDono[orgA]}'`,
      ),
    ).toBe(1);
    expect(countAs(sup1, contaLeads(orgA))).toBe(2);
  });

  it("supervisor não passa o próprio negócio para outro supervisor", () => {
    expect(
      writeCountAs(sup1, `update public.crm_leads set owner_user_id = '${sup2}' where id = '${leadSup1[orgA]}'`),
    ).toBe(0);
    expect(sql(`select owner_user_id from public.crm_leads where id = '${leadSup1[orgA]}';`)).toBe(sup1);
  });

  it("ninguém se dá a permissão pela API: a tabela não aceita escrita da sessão", () => {
    const antes = countAs(sup1, contaLeads(orgA));
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${sup1}"}', false);
        insert into public.sfy_permissoes_do_membro (organization_id, user_id, ver_todos_os_leads)
          values ('${orgA}', '${sup1}', true);`),
    ).toThrow(/permission denied/);
    expect(countAs(sup1, contaLeads(orgA))).toBe(antes);
    expect(antes).toBeLessThan(3);
  });
});

describe("sfy 5002 — o ramo sobrevive no baseline (guarda de merge)", () => {
  const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");

  function ultimaDefinicao(nome: string): string {
    const marca = new RegExp(`create or replace function public\\.${nome}\\(`, "gi");
    let inicio = -1;
    for (const m of baseline.matchAll(marca)) inicio = m.index ?? inicio;
    expect(inicio).toBeGreaterThan(-1);
    const fim = baseline.indexOf("$$;", baseline.indexOf("$$", inicio) + 2);
    return baseline.slice(inicio, fim);
  }

  it.each(["fn_can_view_lead", "fn_can_view_conversation", "fn_conversation_scope"])(
    "a última definição de %s consulta fn_sfy_ve_todos_os_leads",
    (nome) => {
      expect(ultimaDefinicao(nome)).toContain("fn_sfy_ve_todos_os_leads");
    },
  );
});
