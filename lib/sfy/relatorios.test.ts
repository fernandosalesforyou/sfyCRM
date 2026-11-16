import { describe, expect, it } from "vitest";

import { baldesDaJanela, juntarPorGrupo, montarCusto, montarSerie, percentualDeFechamento, somarLinhas } from "./relatorios";

const bruta = (o: Partial<Parameters<typeof juntarPorGrupo>[0][number]>) => ({
  grupo: "A", moeda: "BRL", leads: 0, abertos: 0, ganhos: 0, perdidos: 0, valor_ganho_centavos: 0, mediana_dias_ate_ganho: null, ...o,
});

describe("relatorios sfy", () => {
  it("% de fechamento: sem encerrados é null, nunca 0", () => {
    expect(percentualDeFechamento(0, 0)).toBeNull();
    expect(percentualDeFechamento(1, 3)).toBe(0.25);
  });

  it("junta moedas do mesmo grupo sem misturar e a soma fecha", () => {
    const linhas = juntarPorGrupo([
      bruta({ grupo: "A", moeda: "BRL", leads: 3, ganhos: 1, perdidos: 1, abertos: 1, valor_ganho_centavos: 1000, mediana_dias_ate_ganho: 2 }),
      bruta({ grupo: "A", moeda: "USD", leads: 1, ganhos: 1, valor_ganho_centavos: 500, mediana_dias_ate_ganho: 9 }),
      bruta({ grupo: "", moeda: "BRL", leads: 5, abertos: 5 }),
    ]);
    expect(linhas.map((l) => l.grupo)).toEqual(["", "A"]);
    const a = linhas.find((l) => l.grupo === "A")!;
    expect(a.leads).toBe(4);
    expect(a.valor_ganho_por_moeda).toEqual({ BRL: 1000, USD: 500 });
    expect(a.percentual_fechamento).toBeCloseTo(2 / 3);
    expect(linhas.find((l) => l.grupo === "")!.mediana_dias_ate_ganho).toBeNull();
    expect(somarLinhas(linhas).leads).toBe(9);
  });

  it("série: balde sem lead aparece com 0 e a soma é o total", () => {
    const baldes = baldesDaJanela("2026-11-01", "2026-11-05", "dia");
    expect(baldes).toHaveLength(4);
    const s = montarSerie(
      [
        { balde: "2026-11-02", categoria: "agro", origem: "site", leads: 2 },
        { balde: "2026-11-02", categoria: "climabrisa", origem: "meta_ads", leads: 1 },
      ],
      baldes,
    );
    expect(s.matriz["2026-11-01"]).toEqual({ agro: 0, climabrisa: 0 });
    expect(s.total).toBe(3);
  });

  it("baldes de semana começam na segunda e os de mês no dia 1", () => {
    expect(baldesDaJanela("2026-11-04", "2026-11-20", "semana")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(baldesDaJanela("2026-10-15", "2026-12-01", "mes")).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("custo: divide só com denominador, mais gasto primeiro e total coerente", () => {
    const c = (o: Partial<Parameters<typeof montarCusto>[0][number]>) => ({
      plataforma: "meta_ads", campanha_id: "X", campanha_nome: "", moeda: "BRL", gasto_centavos: 0, leads: 0, oportunidades: 0, ganhos: 0, valor_ganho_centavos: 0, ...o,
    });
    const r = montarCusto([
      c({ campanha_id: "C2", gasto_centavos: 7000 }),
      c({ campanha_id: "C1", gasto_centavos: 15000, leads: 3, oportunidades: 2, ganhos: 1, valor_ganho_centavos: 30000 }),
      c({ plataforma: "", campanha_id: "", leads: 1 }),
    ]);
    expect(r.linhas.map((l) => l.campanha_id)).toEqual(["C1", "C2", ""]);
    const c1 = r.linhas[0]!;
    expect(c1.custo_por_lead_centavos).toBe(5000);
    expect(c1.custo_por_oportunidade_centavos).toBe(7500);
    expect(c1.retorno).toBe(2);
    expect(r.linhas[1]!.custo_por_lead_centavos).toBeNull(); // gasto sem lead: "—", não 0 nem infinito
    expect(r.linhas[2]!.retorno).toBeNull(); // lead sem campanha: sem gasto para dividir
    expect(r.total.gasto_centavos).toBe(22000);
    expect(r.total.custo_por_lead_centavos).toBe(5500);
    const mista = montarCusto([c({ campanha_id: "A", gasto_centavos: 100, leads: 1 }), c({ campanha_id: "B", moeda: "USD", gasto_centavos: 100, leads: 1 })]);
    expect(mista.total.moeda_unica).toBe(false);
    expect(mista.total.custo_por_lead_centavos).toBeNull();
  });
});
