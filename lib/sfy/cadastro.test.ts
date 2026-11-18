import { describe, expect, it } from "vitest";

import {
  camposDaSituacao,
  codigoValido,
  dataValida,
  impactoDasCidades,
  SITUACOES,
  situacaoDosCampos,
} from "./cadastro";

describe("sfy cadastro — situação do parceiro", () => {
  it("cada situação vira campos que respeitam a regra do banco (recebe só se ativo e certificado)", () => {
    for (const s of SITUACOES) {
      const c = camposDaSituacao(s, "2026-11-18", null);
      expect(!c.recebe_leads || (c.ativo && c.certificado), s).toBe(true);
    }
  });

  it("o caminho de ida e volta devolve a mesma situação", () => {
    for (const s of SITUACOES) {
      expect(situacaoDosCampos(camposDaSituacao(s, "2026-11-18", null))).toBe(s);
    }
  });

  it("a saída guarda a primeira data; voltar a ficar ativo limpa a data", () => {
    expect(camposDaSituacao("saiu", "2026-11-18", null).saiu_em).toBe("2026-11-18");
    expect(camposDaSituacao("saiu", "2026-11-18", "2026-01-05").saiu_em).toBe("2026-01-05");
    expect(camposDaSituacao("certificado_recebe", "2026-11-18", "2026-01-05").saiu_em).toBeNull();
  });

  it("quem sai continua certificado, e não certificado nunca recebe", () => {
    expect(camposDaSituacao("saiu", "2026-11-18", null).certificado).toBe(true);
    expect(camposDaSituacao("nao_certificado", "2026-11-18", null).recebe_leads).toBe(false);
  });
});

describe("sfy cadastro — validações", () => {
  it("código curto e sem espaço", () => {
    expect(codigoValido("1509")).toBe(true);
    expect(codigoValido("SC-1")).toBe(true);
    expect(codigoValido("")).toBe(false);
    expect(codigoValido("com espaço")).toBe(false);
    expect(codigoValido("x".repeat(21))).toBe(false);
  });

  it("data que existe de verdade", () => {
    expect(dataValida("2026-11-18")).toBe(true);
    expect(dataValida("2026-02-31")).toBe(false);
    expect(dataValida("18/11/2026")).toBe(false);
  });
});

describe("sfy cadastro — impacto da troca de cidades", () => {
  it("conta rodízio novo e cidade que ficou sem parceiro", () => {
    const depois = new Map([
      ["SP|a", 2],
      ["SP|b", 1],
      ["SP|c", 0],
      ["SP|d", 0],
    ]);
    expect(impactoDasCidades(["SP|a", "SP|b"], ["SP|c", "SP|d"], depois)).toEqual({
      entram_em_rodizio: 1,
      ficam_sem_parceiro: 2,
    });
  });
});
