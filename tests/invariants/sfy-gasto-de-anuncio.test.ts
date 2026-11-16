/**
 * sfy (fork Sales for You, Bloco D) — migration 5007.
 *
 * `fn_sfy_custo_por_campanha` cruza o gasto diário guardado com os leads do CRM pelo
 * campaign_id. Provado: gasto e leads por campanha; oportunidade = está ou passou por etapa
 * "Em negociação…"; campanha com gasto e zero lead aparece; lead sem campanha não é rateado;
 * histórico fora; janela do gasto; isolamento por organização; a tabela e a função só são do
 * servidor.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const membro = randomUUID();
const De = "2026-11-01T00:00:00Z";
const Ate = "2026-12-01T00:00:00Z";

function json(consulta: string): Array<Record<string, unknown>> {
  return JSON.parse(sql(`select coalesce(json_agg(t), '[]'::json) from (${consulta}) t;`));
}

const custo = (org: string, incluir = false) =>
  json(`select * from public.fn_sfy_custo_por_campanha('${org}', '${De}', '${Ate}', '2026-11-01', '2026-11-30', 'Em negociação', ${incluir}) order by campanha_id`);

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-gasto-membro@invariant.test');`);
  for (const org of [orgA, orgB]) {
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');`);
    const funil = randomUUID();
    const novo = randomUUID();
    const neg = randomUUID();
    sql(`insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${novo}', '${org}', '${funil}', 'Novo', 'novo', 0),
        ('${neg}', '${org}', '${funil}', 'Em negociação por representante', 'neg', 1);`);
    const lead = (campanha: string | null, etapa: string, status: string, valor: number | null, tags = "{}", criado = "2026-11-05T12:00:00Z") => {
      const id = randomUUID();
      const meta = campanha ? JSON.stringify({ campaign_id: campanha }) : "{}";
      sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, source, source_metadata,
             created_at, closed_at, value_cents, currency, tags)
           values ('${id}', '${org}', '${funil}', '${etapa}', 'Negócio fictício', '${status}', 'meta_ads', '${meta}'::jsonb,
             '${criado}', ${status === "won" ? `'${criado}'` : "null"}, ${valor ?? "null"}, 'BRL', '${tags}');`);
      return id;
    };
    lead("C1", novo, "open", null); // lead, sem oportunidade
    lead("C1", neg, "open", null); // oportunidade (está na etapa)
    const passou = lead("C1", novo, "won", 200000); // oportunidade por ter PASSADO pela etapa
    sql(`insert into public.crm_lead_activities (organization_id, lead_id, source_module, type, payload)
           values ('${org}', '${passou}', 'test', 'stage_changed', '{"to_stage_id":"${neg}"}'::jsonb);`);
    lead(null, novo, "open", null); // sem campanha
    lead("C1", novo, "open", null, "{historico-em-aberto}"); // histórico
    lead("C1", novo, "open", null, "{}", "2026-10-15T12:00:00Z"); // fora da janela
    sql(`insert into public.sfy_gasto_anuncio (organization_id, plataforma, conta_id, campanha_id, campanha_nome, dia, gasto_centavos) values
      ('${org}', 'meta_ads', 'act_1', 'C1', 'Campanha 1', '2026-11-05', 10000),
      ('${org}', 'meta_ads', 'act_1', 'C1', 'Campanha 1', '2026-11-06', 5000),
      ('${org}', 'meta_ads', 'act_1', 'C1', 'Campanha 1', '2026-10-30', 99999),
      ('${org}', 'meta_ads', 'act_1', 'C2', 'Campanha sem lead', '2026-11-05', 7000);`);
  }
});

describe("sfy-gasto-de-anuncio (5007)", () => {
  it("custo por campanha: gasto no período, leads, oportunidades, ganhos e valor", () => {
    const r = custo(orgA);
    const c1 = r.find((x) => x.campanha_id === "C1")!;
    expect(c1.campanha_nome).toBe("Campanha 1");
    expect(Number(c1.gasto_centavos)).toBe(15000); // o dia de outubro fica fora
    expect(Number(c1.leads)).toBe(3);
    expect(Number(c1.oportunidades)).toBe(2);
    expect(Number(c1.ganhos)).toBe(1);
    expect(Number(c1.valor_ganho_centavos)).toBe(200000);
  });

  it("campanha com gasto e zero lead aparece; lead sem campanha vai para a linha vazia, sem rateio", () => {
    const r = custo(orgA);
    const c2 = r.find((x) => x.campanha_id === "C2")!;
    expect(Number(c2.gasto_centavos)).toBe(7000);
    expect(Number(c2.leads)).toBe(0);
    const sem = r.find((x) => x.campanha_id === "")!;
    expect(Number(sem.leads)).toBe(1);
    expect(Number(sem.gasto_centavos)).toBe(0);
    expect(sem.plataforma).toBe("");
  });

  it("histórico importado fica fora, e entra quando pedido", () => {
    expect(Number(custo(orgA).find((x) => x.campanha_id === "C1")!.leads)).toBe(3);
    expect(Number(custo(orgA, true).find((x) => x.campanha_id === "C1")!.leads)).toBe(4);
  });

  it("soma dos leads fecha com a tabela e uma organização não vê a outra", () => {
    const total = custo(orgA).reduce((s, x) => s + Number(x.leads), 0);
    expect(total).toBe(4);
    expect(sql(`select count(*) from public.crm_leads where organization_id = '${orgA}' and created_at >= '${De}' and created_at < '${Ate}' and not ('historico-em-aberto' = any (tags));`).trim()).toBe(String(total));
  });

  it("a tabela e a função não são acessíveis a quem não é o servidor", () => {
    const como = (consulta: string) =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false);
        ${consulta}`);
    expect(() => como(`select * from public.sfy_gasto_anuncio;`)).toThrow();
    expect(() => como(`select * from public.fn_sfy_custo_por_campanha('${orgA}', '${De}', '${Ate}', '2026-11-01', '2026-11-30');`)).toThrow();
    expect(() => como(`insert into public.sfy_gasto_anuncio (organization_id, plataforma, conta_id, campanha_id, dia, gasto_centavos) values ('${orgA}', 'meta_ads', 'a', 'X', '2026-11-01', 1);`)).toThrow();
  });
});
