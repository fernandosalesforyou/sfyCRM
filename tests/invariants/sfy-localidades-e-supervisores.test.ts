/**
 * sfy (fork Sales for You, etapa 7B) — migration 5012.
 *
 * Localidade escrita à mão guarda o nome; `fn_sfy_desativar_supervisor` nunca deixa parceiro,
 * cidade manual, estado ou a condição de padrão sem dono, recusa substituto de outra linha ou de
 * outra organização, e só o servidor pode chamá-la.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const org = randomUUID();
const outra = randomUUID();
const membro = randomUUID();
const sai = randomUUID();
const entra = randomUUID();
const vazio = randomUUID();
const agroSul = randomUUID();
const agroResto = randomUUID();
const alheio = randomUUID();
const parAtivo = randomUUID();
const parSaiu = randomUUID();

const desativar = (o: string, quem: string, substituto: string | null = null): Record<string, unknown> =>
  JSON.parse(sql(`select public.fn_sfy_desativar_supervisor('${o}', '${quem}', ${substituto ? `'${substituto}'` : "null"});`));
const sup = (id: string): string =>
  sql(`select ativo::text || '|' || padrao::text || '|' || array_to_string(ufs, ',') from public.sfy_supervisores where id = '${id}';`);

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membro}', 'sfy-supervisor-membro@invariant.test');`);
  for (const o of [org, outra]) {
    sql(`insert into public.organizations (id, slug, legal_name, display_name) values ('${o}', '${o}', 'Sfy', 'Sfy');`);
  }
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${org}', 'admin', now());
    insert into public.sfy_supervisores (id, organization_id, nome, categoria, padrao, ufs) values
      ('${sai}', '${org}', 'Sai Fictício', 'climabrisa', true, '{}'),
      ('${entra}', '${org}', 'Entra Fictício', 'climabrisa', false, '{}'),
      ('${vazio}', '${org}', 'Sem Ninguém', 'climabrisa', false, '{}'),
      ('${agroSul}', '${org}', 'Agro Sul', 'agro', false, '{RS,SC}'),
      ('${agroResto}', '${org}', 'Agro Resto', 'agro', true, '{PR}'),
      ('${alheio}', '${outra}', 'De Outra Empresa', 'climabrisa', false, '{}');
    insert into public.sfy_parceiros (id, organization_id, codigo, nome, supervisor_id, ativo) values
      ('${parAtivo}', '${org}', '1', 'Ativo', '${sai}', true),
      ('${parSaiu}', '${org}', '2', 'Saiu', '${sai}', false);
    insert into public.sfy_cidade_supervisor (organization_id, cidade_norm, uf, supervisor_id, manual) values
      ('${org}', 'cidade manual', 'ZZ', '${sai}', true);`);
});

describe("sfy 5012 — localidade escrita à mão", () => {
  it("guarda o nome como foi escrito e recusa nome em branco", () => {
    sql(`insert into public.sfy_parceiro_cidades (organization_id, parceiro_id, cidade_norm, uf, cidade_nome)
      values ('${org}', '${parAtivo}', 'distrito acucena', 'ZZ', 'Distrito Açucena');`);
    expect(sql(`select cidade_nome from public.sfy_parceiro_cidades where parceiro_id = '${parAtivo}';`)).toBe("Distrito Açucena");
  });
});

describe("sfy 5012 — desativar supervisor", () => {
  it("com parceiro ativo e sem substituto: recusa e não muda nada", () => {
    expect(desativar(org, sai)).toMatchObject({ erro: "tem_parceiros", parceiros: 1 });
    expect(sup(sai)).toBe("true|true|");
  });

  it("substituto de outra linha, de outra empresa ou o próprio: recusa", () => {
    for (const s of [agroSul, alheio, sai]) expect(desativar(org, sai, s)).toMatchObject({ erro: "substituto_invalido" });
    expect(sup(sai)).toBe("true|true|");
  });

  it("não alcança supervisor de outra organização", () => {
    expect(desativar(org, alheio)).toMatchObject({ erro: "nao_encontrado" });
  });

  it("passa parceiros, cidades manuais e o padrão para o substituto", () => {
    expect(desativar(org, sai, entra)).toMatchObject({ desativado: true, parceiros_transferidos: 2 });
    expect(sup(sai)).toBe("false|false|");
    expect(sup(entra)).toBe("true|true|");
    expect(sql(`select count(*) from public.sfy_parceiros where supervisor_id = '${entra}';`)).toBe("2");
    expect(sql(`select supervisor_id from public.sfy_cidade_supervisor where organization_id = '${org}' and cidade_norm = 'cidade manual';`)).toBe(entra);
  });

  it("sem parceiros, sai sem substituto", () => {
    expect(desativar(org, vazio)).toMatchObject({ desativado: true });
  });

  it("no Agro, estados só saem passando para alguém", () => {
    expect(desativar(org, agroSul)).toMatchObject({ erro: "tem_estados" });
    expect(desativar(org, agroSul, agroResto)).toMatchObject({ desativado: true });
    expect(sup(agroSul)).toBe("false|false|");
    expect(sup(agroResto)).toBe("true|true|PR,RS,SC");
  });

  it("quem está logado não chama a função direto", () => {
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${membro}","role":"authenticated"}', false);
        select public.fn_sfy_desativar_supervisor('${org}', '${entra}', null);`),
    ).toThrow();
  });
});
