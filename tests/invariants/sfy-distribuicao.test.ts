/**
 * sfy (fork Sales for You, Bloco C) — migration 5005.
 *
 * `fn_sfy_escolher_destino` decide para quem vai o negócio: Agro por UF; Climabrisa pelo
 * parceiro da cidade (um, ou rodízio entre vários) e, sem parceiro, pelo supervisor da
 * cidade. Busca exata (cidade normalizada + UF). As quatro tabelas são isoladas por
 * organização e só o servidor escreve.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const orgA = randomUUID();
const orgB = randomUUID();
const membro = randomUUID();
const supCleiton = randomUUID();
const supEduardo = randomUUID();
const supLeo = randomUUID();
const supCarol = randomUUID();
const supB = randomUUID();
const parA = randomUUID();
const parB = randomUUID();
const parInativo = randomUUID();
const parSemContato = randomUUID();
const parUnico = randomUUID();
const parOrgB = randomUUID();

function destino(org: string, categoria: string, cidade: string, uf: string): Record<string, string | null> {
  const esc = (v: string) => v.replace(/'/g, "''");
  return JSON.parse(
    sql(`select public.fn_sfy_escolher_destino('${org}', '${esc(categoria)}', '${esc(cidade)}', '${esc(uf)}');`),
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

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-dist-membro@invariant.test');`);
  for (const org of [orgA, orgB]) {
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Sfy', 'Sfy');`);
  }
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${orgA}', 'agent', now());
    insert into public.sfy_supervisores (id, organization_id, nome, categoria, ufs, padrao) values
      ('${supCleiton}', '${orgA}', 'Cleiton Fictício', 'agro', '{RS,SC,PR}', false),
      ('${supEduardo}', '${orgA}', 'Eduardo Fictício', 'agro', '{}', true),
      ('${supLeo}', '${orgA}', 'Leo Fictício', 'climabrisa', '{}', false),
      ('${supCarol}', '${orgA}', 'Carol Fictícia', 'climabrisa', '{}', false),
      ('${supB}', '${orgB}', 'Supervisor da B', 'agro', '{}', true);
    insert into public.sfy_parceiros (id, organization_id, codigo, nome, whatsapp, email, supervisor_id, ativo) values
      ('${parA}', '${orgA}', '9001', 'Parceiro A Fictício', '+5511900000001', null, '${supLeo}', true),
      ('${parB}', '${orgA}', '9002', 'Parceiro B Fictício', null, 'b@invariant.test', '${supLeo}', true),
      ('${parInativo}', '${orgA}', '9003', 'Parceiro Inativo', '+5511900000003', null, '${supLeo}', false),
      ('${parSemContato}', '${orgA}', '9004', 'Parceiro Sem Contato', null, null, '${supLeo}', true),
      ('${parUnico}', '${orgA}', '9005', 'Parceiro Único', '+5511900000005', null, '${supCarol}', true),
      ('${parOrgB}', '${orgB}', '9001', 'Parceiro da B', '+5511900000099', null, null, true);
    insert into public.sfy_parceiro_cidades (organization_id, parceiro_id, cidade_norm, uf) values
      ('${orgA}', '${parA}', 'sao jose do rio preto', 'SP'),
      ('${orgA}', '${parB}', 'sao jose do rio preto', 'SP'),
      ('${orgA}', '${parInativo}', 'sao jose do rio preto', 'SP'),
      ('${orgA}', '${parSemContato}', 'sao jose do rio preto', 'SP'),
      ('${orgA}', '${parUnico}', 'curitiba', 'PR'),
      ('${orgB}', '${parOrgB}', 'curitiba', 'PR');
    insert into public.sfy_cidade_supervisor (organization_id, cidade_norm, uf, supervisor_id) values
      ('${orgA}', 'bocaiuva', 'MG', '${supLeo}');`);
});

describe("sfy-distribuicao — Agro", () => {
  it("RS, SC e PR vão para o supervisor do Agro desses estados", () => {
    const d = destino(orgA, "agro", "Passo Fundo", "RS");
    expect(d.motivo).toBe("agro_por_uf");
    expect(d.supervisor_nome).toBe("Cleiton Fictício");
    expect(d.parceiro_id ?? null).toBeNull();
    expect(d.etapa).toBe("supervisor");
  });
  it("qualquer outro estado vai para o supervisor padrão", () => {
    expect(destino(orgA, "agro", "Sinop", "MT").supervisor_nome).toBe("Eduardo Fictício");
  });
  it("categoria inválida não escolhe ninguém", () => {
    expect(destino(orgA, "outra", "Sinop", "MT").motivo).toBe("sem_destino");
  });
});

describe("sfy-distribuicao — Climabrisa", () => {
  it("parceiro único da cidade, com o supervisor dele, na etapa de representante", () => {
    const d = destino(orgA, "climabrisa", "CURITIBA", "pr");
    expect(d.motivo).toBe("parceiro_unico");
    expect(d.parceiro_codigo).toBe("9005");
    expect(d.supervisor_nome).toBe("Carol Fictícia");
    expect(d.etapa).toBe("representante");
  });

  it("não alcança parceiro de outra organização", () => {
    const d = destino(orgB, "climabrisa", "Curitiba", "PR");
    expect(d.parceiro_nome).toBe("Parceiro da B");
    expect(d.supervisor_id ?? null).toBeNull();
  });

  it("acento e caixa não atrapalham a busca exata", () => {
    expect(destino(orgA, "climabrisa", "São  José do Rio Preto", "SP").motivo).toBe("rodizio");
  });

  it("rodízio: alterna entre os parceiros da cidade e pula inativo e sem contato", () => {
    const vistos = [1, 2, 3, 4, 5, 6].map(() => destino(orgA, "climabrisa", "Sao Jose do Rio Preto", "SP").parceiro_codigo);
    // só 9001 e 9002 são elegíveis; nenhum recebe dois seguidos
    expect(new Set(vistos)).toEqual(new Set(["9001", "9002"]));
    for (let i = 1; i < vistos.length; i++) expect(vistos[i]).not.toBe(vistos[i - 1]);
  });

  it("cidade sem parceiro vai para o supervisor da cidade, na etapa de supervisor", () => {
    const d = destino(orgA, "climabrisa", "Bocaiúva", "MG");
    expect(d.motivo).toBe("supervisor_da_cidade");
    expect(d.supervisor_nome).toBe("Leo Fictício");
    expect(d.etapa).toBe("supervisor");
    expect(d.parceiro_id ?? null).toBeNull();
  });

  it("cidade sem cobertura e dados faltando não inventam destino", () => {
    expect(destino(orgA, "climabrisa", "Cidade Inexistente", "SP").motivo).toBe("sem_destino");
    expect(destino(orgA, "climabrisa", "", "SP").motivo).toBe("sem_destino");
    expect(destino(orgA, "climabrisa", "Curitiba", "").motivo).toBe("sem_destino");
  });
});

describe("sfy-distribuicao — isolamento e escrita", () => {
  it("o membro lê as linhas da própria organização e zero da vizinha", () => {
    expect(comoMembro(`select count(*) from public.sfy_parceiros where organization_id = '${orgA}';`)).toBe("5");
    expect(comoMembro(`select count(*) from public.sfy_parceiros where organization_id = '${orgB}';`)).toBe("0");
    expect(comoMembro(`select count(*) from public.sfy_supervisores where organization_id = '${orgB}';`)).toBe("0");
  });

  it("a sessão não escreve nas tabelas e não chama a função", () => {
    expect(recusado(`insert into public.sfy_parceiros (organization_id, codigo, nome) values ('${orgA}', 'x', 'x');`)).toBe(true);
    expect(recusado(`update public.sfy_parceiros set ativo = false where organization_id = '${orgA}';`)).toBe(true);
    expect(recusado(`delete from public.sfy_cidade_supervisor where organization_id = '${orgA}';`)).toBe(true);
    expect(recusado(`select public.fn_sfy_escolher_destino('${orgA}', 'agro', 'x', 'RS');`)).toBe(true);
  });
});
