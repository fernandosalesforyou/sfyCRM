import { describe, expect, it } from "vitest";

import { dataCurta, gerarToken, hashDoToken, nomeCurto, tokenComFormaValida, valorEmCentavos, valoresDoParceiro } from "./fechamento";

describe("link de fechamento sfy", () => {
  it("token: forte, de forma validável e o hash não revela o token", () => {
    const t = gerarToken();
    expect(tokenComFormaValida(t)).toBe(true);
    expect(gerarToken()).not.toBe(t);
    expect(hashDoToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken(t)).not.toContain(t);
    expect(tokenComFormaValida("curto")).toBe(false);
    expect(tokenComFormaValida(`${t}x`)).toBe(false);
    expect(tokenComFormaValida(t.replace(/.$/, "!"))).toBe(false);
  });

  it("valor em reais vira centavos e o que é ambíguo ou absurdo é recusado", () => {
    expect(valorEmCentavos("1.234,56")).toBe(123456);
    expect(valorEmCentavos("R$ 1.500")).toBe(150000);
    expect(valorEmCentavos("1500,5")).toBe(150050);
    expect(valorEmCentavos("1500.50")).toBe(150050);
    expect(valorEmCentavos("1234")).toBe(123400);
    for (const ruim of ["", "0", "0,00", "-10", "abc", "10,555", "1.2.3", "99999999999,00", "1e5"]) {
      expect(valorEmCentavos(ruim)).toBeNull();
    }
  });

  it("nome curto não vaza telefone nem e-mail", () => {
    expect(nomeCurto("Maria da Silva")).toBe("Maria S.");
    expect(nomeCurto("Maria")).toBe("Maria");
    expect(nomeCurto("+55 46 99999-0000")).toBe("Cliente");
    expect(nomeCurto(null)).toBe("Cliente");
    expect(nomeCurto("joao@x.com")).toBe("Cliente"); // e-mail inteiro nunca vira nome
    expect(nomeCurto("Ana Pereira joao@x.com")).toBe("Ana P.");
  });

  it("acha os valores do parceiro pelo código, pelo rótulo ou pelo nome", () => {
    const opcoes = new Map([["op1", "9001 - Parceiro Fictício"], ["op2", "9002 - Outro"], ["9001", "9001"]]);
    expect(valoresDoParceiro(opcoes, { codigo: "9001", nome: "Parceiro Fictício" }).sort()).toEqual(["9001", "op1"]);
  });

  it("data curta em DD/MM/AAAA no fuso de Brasília (22h30 de SP não vira o dia seguinte)", () => {
    expect(dataCurta("2026-11-03T01:30:00Z")).toBe("02/11/2026");
    expect(dataCurta("2026-11-17T15:00:00Z")).toBe("17/11/2026");
    expect(dataCurta("lixo")).toBe("");
  });
});
