/**
 * sfy (fork Sales for You, etapa 7B) — migration 5010.
 *
 * O cadastro de parceiros vira a fonte de verdade: só recebe lead quem está ativo, certificado e
 * com "recebe leads" ligado (amarrado por restrição no banco); a simulação do destino não gasta a
 * vez do rodízio; o supervisor padrão da Climabrisa cobre a cidade fora das tabelas; e
 * `fn_sfy_recalcular_cidades_supervisor` refaz o supervisor das cidades sem parceiro elegível
 * (região de quem não recebe vai para o supervisor dele; as demais, para o parceiro ativo mais
 * próximo; linhas manuais ficam como estão). Apelidos são únicos por organização e isolados por
 * RLS; os municípios do IBGE só o servidor lê.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const orgR = randomUUID();
const membro = randomUUID();
const supLeo = randomUUID();
const supCarol = randomUUID();
const supR1 = randomUUID();
const supR2 = randomUUID();
const parX = randomUUID();
const parY = randomUUID();
const parP1 = randomUUID();
const parP2 = randomUUID();
const parR1 = randomUUID();
const parR2 = randomUUID();
const parB1 = randomUUID();

function destino(org: string, categoria: string, cidade: string, uf: string, simular = false): Record<string, unknown> {
  const esc = (v: string) => v.replace(/'/g, "''");
  return JSON.parse(
    sql(`select public.fn_sfy_escolher_destino('${org}', '${esc(categoria)}', '${esc(cidade)}', '${esc(uf)}', ${simular});`),
  );
}

function recusado(dml: string): boolean {
  try {
    sql(`set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false);
      ${dml}`);
    return false;
  } catch {
    return true;
  }
}

function comoMembro(consulta: string): string {
  return sql(`set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false);
    ${consulta}`)
    .split("\n")
    .filter((l) => /^\d+$/.test(l.trim()))
    .join("");
}

function supervisorDaCidade(org: string, cidade: string, uf: string): string {
  return sql(
    `select coalesce((select s.nome from public.sfy_cidade_supervisor cs join public.sfy_supervisores s on s.id = cs.supervisor_id
       where cs.organization_id = '${org}' and cs.cidade_norm = '${cidade}' and cs.uf = '${uf}'), '-');`,
  );
}

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-cadastro-membro@invariant.test');`);
  for (const org of [orgA, orgB, orgR]) {
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');`);
  }
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${orgA}', 'agent', now());
    insert into public.sfy_supervisores (id, organization_id, nome, categoria, padrao) values
      ('${supLeo}', '${orgA}', 'Leo Fictício', 'climabrisa', false),
      ('${supCarol}', '${orgA}', 'Carol Fictícia', 'climabrisa', false),
      ('${supR1}', '${orgR}', 'Supervisor R1', 'climabrisa', false),
      ('${supR2}', '${orgR}', 'Supervisor R2', 'climabrisa', false);
    insert into public.sfy_parceiros (id, organization_id, codigo, nome, whatsapp, supervisor_id, ativo, certificado, recebe_leads) values
      ('${parX}', '${orgA}', '9101', 'Parceiro X Fictício', '+5511900000101', '${supLeo}', true, true, true),
      ('${parY}', '${orgA}', '9102', 'Parceiro Y Fictício', '+5511900000102', '${supLeo}', true, true, true),
      ('${parP1}', '${orgA}', '9103', 'Parceiro Pausado', '+5511900000103', '${supCarol}', true, true, false);
    insert into public.sfy_parceiro_cidades (organization_id, parceiro_id, cidade_norm, uf) values
      ('${orgA}', '${parX}', 'cidade de teste um', 'ZZ'),
      ('${orgA}', '${parY}', 'cidade de teste um', 'ZZ'),
      ('${orgA}', '${parP1}', 'cidade de teste dois', 'ZZ');`);
});

afterAll(() => {
  sql(`delete from public.sfy_municipios where codigo_ibge between 99900001 and 99900009 or uf = 'ZX';`);
});

describe("sfy-cadastro — recebe leads exige ativo e certificado", () => {
  it("a restrição recusa receber lead sem certificação ou sem estar ativo", () => {
    expect(() =>
      sql(`insert into public.sfy_parceiros (organization_id, codigo, nome, ativo, certificado, recebe_leads)
        values ('${orgA}', 'c1', 'Sem certificado', true, false, true);`),
    ).toThrow();
    expect(() =>
      sql(`insert into public.sfy_parceiros (organization_id, codigo, nome, ativo, certificado, recebe_leads)
        values ('${orgA}', 'c2', 'Inativo', false, true, true);`),
    ).toThrow();
    expect(() => sql(`update public.sfy_parceiros set certificado = false where id = '${parX}';`)).toThrow();
  });

  it("parceiro novo nasce sem receber lead (nada acontece sem decisão)", () => {
    sql(`insert into public.sfy_parceiros (organization_id, codigo, nome) values ('${orgA}', 'novo1', 'Novo');`);
    expect(sql(`select recebe_leads::text || certificado::text from public.sfy_parceiros where organization_id = '${orgA}' and codigo = 'novo1';`)).toBe("falsefalse");
    sql(`delete from public.sfy_parceiros where organization_id = '${orgA}' and codigo = 'novo1';`);
  });
});

describe("sfy-cadastro — distribuição só entre quem recebe", () => {
  it("o pausado não entra: a cidade dele não tem destino de parceiro", () => {
    const d = destino(orgA, "climabrisa", "Cidade de Teste Dois", "ZZ");
    expect(d.motivo).toBe("sem_destino");
  });

  it("com dois elegíveis há rodízio; pausar um deixa o outro como único", () => {
    expect(destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ").motivo).toBe("rodizio");
    sql(`update public.sfy_parceiros set recebe_leads = false where id = '${parY}';`);
    const d = destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ");
    expect(d.motivo).toBe("parceiro_unico");
    expect(d.parceiro_codigo).toBe("9101");
    sql(`update public.sfy_parceiros set recebe_leads = true where id = '${parY}';`);
  });

  it("saída (ativo = false) tira o parceiro do rodízio", () => {
    sql(`update public.sfy_parceiros set recebe_leads = false, ativo = false, saiu_em = current_date where id = '${parY}';`);
    expect(destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ").motivo).toBe("parceiro_unico");
    sql(`update public.sfy_parceiros set ativo = true, saiu_em = null, recebe_leads = true where id = '${parY}';`);
  });
});

describe("sfy-cadastro — simulação não gasta a vez", () => {
  it("simular duas vezes devolve o mesmo parceiro e não grava o recebimento; a chamada real avança", () => {
    sql(`update public.sfy_parceiros set ultimo_recebimento_em = null where id in ('${parX}', '${parY}');`);
    const s1 = destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ", true);
    const s2 = destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ", true);
    expect(s1.simulacao).toBe(true);
    expect(s1.parceiro_codigo).toBe(s2.parceiro_codigo);
    expect((s1.elegiveis as unknown[]).length).toBe(2);
    expect(sql(`select count(*) from public.sfy_parceiros where organization_id = '${orgA}' and ultimo_recebimento_em is not null;`)).toBe("0");

    const r1 = destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ");
    expect(r1.simulacao).toBe(false);
    expect(r1.parceiro_codigo).toBe(s1.parceiro_codigo);
    const r2 = destino(orgA, "climabrisa", "Cidade de Teste Um", "ZZ");
    expect(r2.parceiro_codigo).not.toBe(r1.parceiro_codigo);
  });
});

describe("sfy-cadastro — supervisor padrão da Climabrisa", () => {
  it("cidade fora de todas as tabelas vai ao supervisor padrão, se houver", () => {
    expect(destino(orgA, "climabrisa", "Lugar Nenhum", "ZZ").motivo).toBe("sem_destino");
    sql(`update public.sfy_supervisores set padrao = true where id = '${supCarol}';`);
    const d = destino(orgA, "climabrisa", "Lugar Nenhum", "ZZ");
    expect(d.motivo).toBe("supervisor_padrao");
    expect(d.supervisor_nome).toBe("Carol Fictícia");
    sql(`update public.sfy_supervisores set padrao = false where id = '${supCarol}';`);
  });
});

describe("sfy-cadastro — recálculo do supervisor das cidades sem parceiro", () => {
  // Pontos (lat, lon): um = (0,0), dois = (0,0.1), tres = (10,10), quatro = (10,10.1), cinco = (-30,-30).
  beforeAll(() => {
    sql(`insert into public.sfy_municipios (codigo_ibge, nome, nome_norm, uf, latitude, longitude) values
      (99900001, 'Um', 'um', 'ZY', 0, 0),
      (99900002, 'Dois', 'dois', 'ZY', 0, 0.1),
      (99900003, 'Tres', 'tres', 'ZY', 10, 10),
      (99900004, 'Quatro', 'quatro', 'ZY', 10, 10.1),
      (99900005, 'Cinco', 'cinco', 'ZY', -30, -30);
      insert into public.sfy_parceiros (id, organization_id, codigo, nome, whatsapp, supervisor_id, ativo, certificado, recebe_leads) values
        ('${parR1}', '${orgR}', 'r1', 'R1 elegível', '+5511900000201', '${supR1}', true, true, true),
        ('${parR2}', '${orgR}', 'r2', 'R2 não certificado', '+5511900000202', '${supR2}', true, false, false);
      insert into public.sfy_parceiro_cidades (organization_id, parceiro_id, cidade_norm, uf) values
        ('${orgR}', '${parR1}', 'um', 'ZY'),
        ('${orgR}', '${parR2}', 'tres', 'ZY');
      insert into public.sfy_cidade_supervisor (organization_id, cidade_norm, uf, supervisor_id, manual) values
        ('${orgR}', 'dois', 'ZY', '${supR2}', true);`);
  });

  it("a região de quem não recebe vai para o supervisor dele; as demais, para o parceiro ativo mais próximo", () => {
    sql(`select public.fn_sfy_recalcular_cidades_supervisor('${orgR}');`);
    expect(supervisorDaCidade(orgR, "um", "ZY")).toBe("-"); // tem parceiro elegível: o parceiro atende
    expect(supervisorDaCidade(orgR, "tres", "ZY")).toBe("Supervisor R2"); // área de quem não recebe → supervisor dele
    expect(supervisorDaCidade(orgR, "quatro", "ZY")).toBe("Supervisor R2"); // mais perto de "tres"
    expect(supervisorDaCidade(orgR, "cinco", "ZY")).toBe("Supervisor R1"); // mais perto de (0,0) do que de (10,10)
  });

  it("linha manual não é refeita", () => {
    sql(`select public.fn_sfy_recalcular_cidades_supervisor('${orgR}');`);
    expect(supervisorDaCidade(orgR, "dois", "ZY")).toBe("Supervisor R2");
    expect(sql(`select manual::text from public.sfy_cidade_supervisor where organization_id = '${orgR}' and cidade_norm = 'dois';`)).toBe("true");
  });

  it("quando o parceiro passa a receber, a cidade dele sai da tabela de supervisor", () => {
    sql(`update public.sfy_parceiros set certificado = true, recebe_leads = true where id = '${parR2}';`);
    sql(`select public.fn_sfy_recalcular_cidades_supervisor('${orgR}');`);
    expect(supervisorDaCidade(orgR, "tres", "ZY")).toBe("-");
    expect(supervisorDaCidade(orgR, "quatro", "ZY")).toBe("Supervisor R2");
  });
});

describe("sfy-cadastro — apelidos e municípios: isolamento e escrita só pelo servidor", () => {
  beforeAll(() => {
    sql(`insert into public.sfy_parceiro_apelidos (organization_id, apelido_norm, apelido, parceiro_id) values
      ('${orgA}', 'luis fernando marini', 'Luis Fernando Marini', '${parX}');
      insert into public.sfy_parceiros (id, organization_id, codigo, nome) values ('${parB1}', '${orgB}', 'b1', 'B1');
      insert into public.sfy_parceiro_apelidos (organization_id, apelido_norm, apelido, parceiro_id) values
      ('${orgB}', 'luis fernando marini', 'Luis Fernando Marini', '${parB1}');`);
  });

  it("um apelido aponta para um só parceiro por organização", () => {
    expect(() =>
      sql(`insert into public.sfy_parceiro_apelidos (organization_id, apelido_norm, apelido, parceiro_id)
        values ('${orgA}', 'luis fernando marini', 'Luis Fernando Marini', '${parY}');`),
    ).toThrow();
  });

  it("membro lê os apelidos da própria organização e zero da vizinha", () => {
    expect(comoMembro(`select count(*) from public.sfy_parceiro_apelidos where organization_id = '${orgA}';`)).toBe("1");
    expect(comoMembro(`select count(*) from public.sfy_parceiro_apelidos where organization_id = '${orgB}';`)).toBe("0");
  });

  it("a sessão do navegador não escreve apelido, não lê município e não chama as funções", () => {
    expect(recusado(`insert into public.sfy_parceiro_apelidos (organization_id, apelido_norm, apelido, parceiro_id) values ('${orgA}', 'x', 'x', '${parX}');`)).toBe(true);
    expect(recusado(`select count(*) from public.sfy_municipios;`)).toBe(true);
    expect(recusado(`insert into public.sfy_municipios (codigo_ibge, nome, nome_norm, uf, latitude, longitude) values (99900009, 'x', 'x', 'ZZ', 0, 0);`)).toBe(true);
    expect(recusado(`select public.fn_sfy_recalcular_cidades_supervisor('${orgA}');`)).toBe(true);
    expect(recusado(`select public.fn_sfy_escolher_destino('${orgA}', 'climabrisa', 'x', 'ZZ', true);`)).toBe(true);
  });
});

describe("sfy-cadastro — o recálculo cabe no tempo do PostgREST (8 s)", () => {
  it("com a escala do Brasil (~5.500 municípios, ~2.700 cidades de parceiros) termina em poucos segundos", () => {
    const orgP = randomUUID();
    const supP = randomUUID();
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${orgP}', '${orgP}', 'Sfy', 'Sfy');
      insert into public.sfy_supervisores (id, organization_id, nome, categoria) values ('${supP}', '${orgP}', 'Sup P', 'climabrisa');
      insert into public.sfy_municipios (codigo_ibge, nome, nome_norm, uf, latitude, longitude)
        select 99910000 + i, 'cx' || i, 'cx' || i, 'ZX', (i % 70) - 35, (i / 70) - 70 from generate_series(1, 5500) i;
      with p as (
        insert into public.sfy_parceiros (organization_id, codigo, nome, whatsapp, supervisor_id, ativo, certificado, recebe_leads)
        select '${orgP}', 'p' || n, 'P' || n, '+5511900000000', '${supP}', true, true, (n % 2 = 0) from generate_series(1, 60) n
        returning id, codigo)
      insert into public.sfy_parceiro_cidades (organization_id, parceiro_id, cidade_norm, uf)
        select '${orgP}', p.id, 'cx' || ((substr(p.codigo, 2)::int - 1) * 45 + k), 'ZX' from p, generate_series(1, 45) k;`);
    const inicio = Date.now();
    const r = JSON.parse(sql(`select public.fn_sfy_recalcular_cidades_supervisor('${orgP}');`));
    const ms = Date.now() - inicio;
    expect(r.cidades_com_supervisor).toBeGreaterThan(2000);
    // Antes da materialização dos pontos o mesmo cálculo levava ~27 s (e o PostgREST corta em 8 s).
    expect(ms).toBeLessThan(6000);
  });
});
