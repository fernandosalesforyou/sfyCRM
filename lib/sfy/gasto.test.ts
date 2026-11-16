import { describe, expect, it } from "vitest";

import { centavosDoTexto, linhasDeGasto } from "./gasto";

describe("gasto sfy", () => {
  it("converte o gasto em centavos sem erro de ponto flutuante e descarta o ilegível", () => {
    expect(centavosDoTexto("123.45")).toBe(12345);
    expect(centavosDoTexto("0.29")).toBe(29);
    expect(centavosDoTexto("")).toBeNull();
    expect(centavosDoTexto(undefined)).toBeNull();
    expect(centavosDoTexto("abc")).toBeNull();
    expect(centavosDoTexto("-1")).toBeNull();
  });

  it("monta as linhas e descarta as que não dá para gravar", () => {
    const l = linhasDeGasto("org", "act_1", "BRL", [
      { campaign_id: "C1", campaign_name: "A", spend: "10.50", impressions: "1000", inline_link_clicks: "12", date_start: "2026-11-05", account_currency: "USD" },
      { campaign_id: "C2", spend: "0", date_start: "2026-11-05" },
      { campaign_id: "", spend: "5", date_start: "2026-11-05" },
      { campaign_id: "C3", spend: "5", date_start: "05/11/2026" },
      { campaign_id: "C4", date_start: "2026-11-05" },
    ]);
    expect(l.map((x) => x.campanha_id)).toEqual(["C1", "C2"]);
    expect(l[0]).toMatchObject({ gasto_centavos: 1050, impressoes: 1000, cliques: 12, moeda: "USD", campanha_nome: "A" });
    expect(l[1]).toMatchObject({ gasto_centavos: 0, moeda: "BRL", cliques: 0 });
  });
});
