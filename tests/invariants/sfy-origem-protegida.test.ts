/**
 * sfy (fork Sales for You, Bloco B1/B2) — migration 5004.
 *
 * Com `organizations.settings.sfy.origem_protegida` ligada, só o admin altera
 * `source`/`source_metadata` de contato e negócio que vieram de anúncio, site ou
 * integração; o atendente só reclassifica cadastro manual. Com
 * `origem_manual_sem_identificacao`, cadastro manual grava 'sem_identificacao'.
 * Desligadas, o comportamento é o do original; uma organização não alcança a
 * outra; escrita sem usuário (service role) não é barrada.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const agente = randomUUID();
const admin = randomUUID();
const funil: Record<string, string> = {};
const etapa: Record<string, string> = {};

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

function novoContato(org: string, source: string, metadata = "{}"): string {
  const id = randomUUID();
  sql(`insert into public.contacts (id, organization_id, display_name, source, source_metadata)
         values ('${id}', '${org}', 'Contato fictício', '${source}', '${metadata}'::jsonb);`);
  return id;
}

function novoNegocio(org: string, source: string, metadata = "{}"): string {
  const id = randomUUID();
  const contato = novoContato(org, "manual");
  sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, owner_user_id, source, source_metadata)
         values ('${id}', '${org}', '${funil[org]}', '${etapa[org]}', '${contato}', 'Negócio fictício', '${agente}', '${source}', '${metadata}'::jsonb);`);
  return id;
}

const fonte = (tabela: string, id: string) => sql(`select source from public.${tabela} where id = '${id}';`);

beforeAll(() => {
  sql(`insert into auth.users (id, email) values
         ('${agente}', 'sfy-origem-agente@invariant.test'), ('${admin}', 'sfy-origem-admin@invariant.test');`);
  for (const org of [orgA, orgB]) {
    funil[org] = randomUUID();
    etapa[org] = randomUUID();
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${agente}', '${org}', 'agent', now()), ('${admin}', '${org}', 'admin', now());
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil[org]}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${etapa[org]}', '${org}', '${funil[org]}', 'Em negociação', 'em-negociacao', 1);`);
  }
  ligar(orgA, { origem_protegida: true, origem_manual_sem_identificacao: true });
});

describe("sfy 5004 — origem protegida", () => {
  it("regra ligada: atendente não altera origem vinda de anúncio (contato e negócio)", () => {
    const contato = novoContato(orgA, "meta_ads", '{"utm_source":"facebook"}');
    expect(como(agente, `update public.contacts set source = 'manual' where id = '${contato}';`)).toContain(
      "sfy_origin_admin_only",
    );
    expect(como(agente, `update public.contacts set source_metadata = '{}' where id = '${contato}';`)).toContain(
      "sfy_origin_admin_only",
    );
    expect(fonte("contacts", contato)).toBe("meta_ads");
    const negocio = novoNegocio(orgA, "site", '{"utm_campaign":"x"}');
    expect(como(agente, `update public.crm_leads set source = 'google_ads' where id = '${negocio}';`)).toContain(
      "sfy_origin_admin_only",
    );
    expect(fonte("crm_leads", negocio)).toBe("site");
  });

  it("regra ligada: atendente não forja origem de anúncio num cadastro manual", () => {
    const contato = novoContato(orgA, "manual");
    expect(como(agente, `update public.contacts set source = 'google_ads' where id = '${contato}';`)).toContain(
      "sfy_origin_admin_only",
    );
  });

  it("regra ligada: atendente reclassifica dentro do mundo manual e edita outros campos", () => {
    const contato = novoContato(orgA, "sem_identificacao");
    expect(como(agente, `update public.contacts set source = 'manual' where id = '${contato}';`)).toBe("ok");
    const anuncio = novoContato(orgA, "meta_ads");
    expect(como(agente, `update public.contacts set display_name = 'Outro nome' where id = '${anuncio}';`)).toBe("ok");
  });

  it("regra ligada: admin altera a origem", () => {
    const contato = novoContato(orgA, "meta_ads");
    expect(como(admin, `update public.contacts set source = 'manual' where id = '${contato}';`)).toBe("ok");
    expect(fonte("contacts", contato)).toBe("manual");
  });

  it("regra desligada (outra organização): atendente altera como no original", () => {
    const contato = novoContato(orgB, "meta_ads");
    expect(como(agente, `update public.contacts set source = 'manual' where id = '${contato}';`)).toBe("ok");
  });

  it("escrita sem usuário (service role) não é barrada", () => {
    const contato = novoContato(orgA, "meta_ads");
    sql(`update public.contacts set source = 'google_ads', source_metadata = '{"gclid":"abc"}' where id = '${contato}';`);
    expect(fonte("contacts", contato)).toBe("google_ads");
  });
});

describe("sfy 5004 — cadastro manual sem identificação", () => {
  it("regra ligada: source 'manual' vira 'sem_identificacao'; outras origens ficam", () => {
    expect(fonte("contacts", novoContato(orgA, "manual"))).toBe("sem_identificacao");
    expect(fonte("crm_leads", novoNegocio(orgA, "manual"))).toBe("sem_identificacao");
    expect(fonte("contacts", novoContato(orgA, "meta_ads"))).toBe("meta_ads");
  });

  it("regra desligada (outra organização): continua 'manual'", () => {
    expect(fonte("contacts", novoContato(orgB, "manual"))).toBe("manual");
  });
});
