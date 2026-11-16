/**
 * sfy (fork Sales for You, Bloco D) — migration 5006.
 *
 * Funções de leitura dos relatórios: por parceiro/supervisor, leads por período (no fuso da
 * organização, por categoria e origem) e por origem. Regras provadas: coorte pela data de
 * criação; histórico importado fora por padrão; isolamento por organização; sem EXECUTE para
 * quem não é o servidor; a soma das linhas fecha com o total.
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

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-rel-membro@invariant.test');`);
  for (const org of [orgA, orgB]) {
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');`);
    const funil = randomUUID();
    const etapa = randomUUID();
    sql(`insert into public.crm_pipelines (id, organization_id, name, slug) values ('${funil}', '${org}', 'Vendas', 'v${org.slice(0, 8)}');
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${etapa}', '${org}', '${funil}', 'Novo', 'novo', 0);`);
    const lead = (
      status: string, parceiro: string | null, categoria: string, source: string,
      criado: string, fechado: string | null, valor: number | null, tags = "{}",
    ) => {
      const campos = JSON.stringify({ ...(parceiro ? { parceiro_responsavel: parceiro } : {}), categoria });
      sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, status, source, custom_fields,
             created_at, closed_at, value_cents, currency, tags, lost_reason)
           values ('${randomUUID()}', '${org}', '${funil}', '${etapa}', 'Negócio fictício', '${status}', '${source}',
             '${campos}'::jsonb, '${criado}', ${fechado ? `'${fechado}'` : "null"}, ${valor ?? "null"}, 'BRL', '${tags}', ${status === "lost" ? "'other'" : "null"});`);
    };
    lead("open", "9001 - A", "climabrisa", "meta_ads", "2026-11-02T10:00:00Z", null, null);
    lead("won", "9001 - A", "climabrisa", "meta_ads", "2026-11-03T01:30:00Z", "2026-11-06T01:30:00Z", 100000);
    lead("lost", "9002 - B", "climabrisa", "manual", "2026-11-10T12:00:00Z", "2026-11-11T12:00:00Z", null);
    lead("open", null, "agro", "site", "2026-11-10T12:00:00Z", null, null);
    lead("open", "9001 - A", "climabrisa", "meta_ads", "2026-11-12T12:00:00Z", null, null, "{historico-em-aberto}");
    lead("open", "9001 - A", "climabrisa", "meta_ads", "2026-10-15T12:00:00Z", null, null); // fora da janela
  }
});

describe("sfy-relatorios (5006)", () => {
  it("por parceiro: contagens, % base e valor do ganho; histórico fica de fora", () => {
    const r = json(`select * from public.fn_sfy_relatorio_por_destino('${orgA}', '${De}', '${Ate}', array['parceiro_responsavel']) order by grupo`);
    expect(r.map((x) => [x.grupo, Number(x.leads), Number(x.abertos), Number(x.ganhos), Number(x.perdidos)])).toEqual([
      ["", 1, 1, 0, 0],
      ["9001 - A", 2, 1, 1, 0],
      ["9002 - B", 1, 0, 0, 1],
    ]);
    const a = r.find((x) => x.grupo === "9001 - A")!;
    expect(Number(a.valor_ganho_centavos)).toBe(100000);
    expect(Number(a.mediana_dias_ate_ganho)).toBeCloseTo(3, 5);
    const b = r.find((x) => x.grupo === "9002 - B")!;
    expect(b.mediana_dias_ate_ganho).toBeNull(); // sem ganho: "não medido", nunca 0
  });

  it("com o histórico incluído, ele aparece", () => {
    const r = json(`select * from public.fn_sfy_relatorio_por_destino('${orgA}', '${De}', '${Ate}', array['parceiro_responsavel'], true)`);
    expect(r.reduce((s, x) => s + Number(x.leads), 0)).toBe(5);
  });

  it("leads por dia no fuso da organização (22h30 de SP não vira o dia seguinte)", () => {
    const r = json(`select balde::text, categoria, origem, leads from public.fn_sfy_leads_por_periodo('${orgA}', '${De}', '${Ate}', 'America/Sao_Paulo', 'dia', array['categoria'])`);
    const dia2 = r.filter((x) => x.balde === "2026-11-02");
    expect(dia2.reduce((s, x) => s + Number(x.leads), 0)).toBe(2);
    expect(r.find((x) => x.balde === "2026-11-03")).toBeUndefined();
    expect(r.reduce((s, x) => s + Number(x.leads), 0)).toBe(4);
  });

  it("por semana (segunda-feira) e por mês", () => {
    const sem = json(`select balde::text, sum(leads) as leads from public.fn_sfy_leads_por_periodo('${orgA}', '${De}', '${Ate}', 'America/Sao_Paulo', 'semana', array['categoria']) group by 1 order by 1`);
    expect(sem.map((x) => x.balde)).toEqual(["2026-11-02", "2026-11-09"]);
    const mes = json(`select balde::text, sum(leads)::int as leads from public.fn_sfy_leads_por_periodo('${orgA}', '${De}', '${Ate}', 'America/Sao_Paulo', 'mes', array['categoria']) group by 1`);
    expect(mes).toEqual([{ balde: "2026-11-01", leads: 4 }]);
    expect(json(`select * from public.fn_sfy_leads_por_periodo('${orgA}', '${De}', '${Ate}', 'America/Sao_Paulo', 'ano', array['categoria'])`)).toEqual([]);
  });

  it("por origem: a soma fecha com o total por parceiro", () => {
    const o = json(`select * from public.fn_sfy_relatorio_por_origem('${orgA}', '${De}', '${Ate}')`);
    const p = json(`select * from public.fn_sfy_relatorio_por_destino('${orgA}', '${De}', '${Ate}', array['parceiro_responsavel'])`);
    const soma = (xs: Array<Record<string, unknown>>, k: string) => xs.reduce((s, x) => s + Number(x[k]), 0);
    expect(soma(o, "leads")).toBe(soma(p, "leads"));
    expect(soma(o, "valor_ganho_centavos")).toBe(soma(p, "valor_ganho_centavos"));
    expect(Number(o.find((x) => x.origem === "meta_ads")!.leads)).toBe(2);
  });

  it("isolamento: outra organização não aparece e quem não é o servidor não executa", () => {
    const a = json(`select * from public.fn_sfy_relatorio_por_origem('${orgA}', '${De}', '${Ate}')`);
    expect(soma(a)).toBe(4);
    for (const fn of [
      `public.fn_sfy_relatorio_por_origem('${orgA}', '${De}', '${Ate}')`,
      `public.fn_sfy_relatorio_por_destino('${orgA}', '${De}', '${Ate}', array['parceiro_responsavel'])`,
    ]) {
      expect(() =>
        sql(`set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false);
          select * from ${fn};`),
      ).toThrow();
    }
  });
});

function soma(xs: Array<Record<string, unknown>>): number {
  return xs.reduce((s, x) => s + Number(x.leads), 0);
}
