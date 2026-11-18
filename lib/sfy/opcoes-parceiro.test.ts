import { describe, expect, it } from "vitest";

import { aplicarParceirosNasOpcoes, aplicarParceirosNoSettings, rotuloDaOpcao } from "./opcoes-parceiro";

const p = (codigo: string, nome: string, ativo = true, apelidos: string[] = []) => ({ codigo, nome, ativo, apelidos });

describe("sfy opções do campo Parceiro responsável", () => {
  it("o rótulo é 'código - nome' e quem saiu ganha '(saiu)'", () => {
    expect(rotuloDaOpcao(p("1509", "Pedro Garcia"))).toBe("1509 - Pedro Garcia");
    expect(rotuloDaOpcao(p("1509", "Pedro Garcia", false))).toBe("1509 - Pedro Garcia (saiu)");
  });

  it("parceiro novo ganha opção nova, com o código como valor", () => {
    const r = aplicarParceirosNasOpcoes([{ value: "1", label: "1 - A" }], [p("2", "B")]);
    expect(r.criadas).toBe(1);
    expect(r.opcoes.at(-1)).toEqual({ value: "2", label: "2 - B" });
  });

  it("renomear troca só o rótulo: o valor (e os negócios antigos) não muda", () => {
    const r = aplicarParceirosNasOpcoes([{ value: "7096", label: "7096 - JAQUES (Fabtech)" }], [p("7096", "Jaques Bonifácio da Silva")]);
    expect(r).toMatchObject({ criadas: 0, renomeadas: 1 });
    expect(r.opcoes[0]).toEqual({ value: "7096", label: "7096 - Jaques Bonifácio da Silva" });
  });

  it("acha a opção antiga pelo código no começo do rótulo, mesmo com valor diferente", () => {
    const r = aplicarParceirosNasOpcoes([{ value: "x", label: "7096 - JAQUES" }], [p("7096", "Jaques")]);
    expect(r.criadas).toBe(0);
    expect(r.opcoes).toHaveLength(1);
    expect(r.opcoes[0]?.value).toBe("x");
  });

  it("saída mantém a opção, com '(saiu)'; nada é removido", () => {
    const r = aplicarParceirosNasOpcoes([{ value: "9", label: "9 - Z" }], [p("9", "Z", false)]);
    expect(r.opcoes).toEqual([{ value: "9", label: "9 - Z (saiu)" }]);
  });

  it("apelidos entram na opção sem repetir valor nem rótulo e no máximo 20", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => `Apelido ${i}`);
    const r = aplicarParceirosNasOpcoes([], [p("5", "Cinco", true, ["5", "5 - Cinco", "Cinquinho", ...muitos])]);
    const a = r.opcoes[0]?.aliases ?? [];
    expect(a[0]).toBe("Cinquinho");
    expect(a).toHaveLength(20);
    expect(a).not.toContain("5");
  });

  it("já em dia não conta como mudança", () => {
    const r = aplicarParceirosNasOpcoes([{ value: "2", label: "2 - B" }], [p("2", "B")]);
    expect(r).toMatchObject({ criadas: 0, renomeadas: 0 });
  });
});

describe("sfy sincronia no settings do funil", () => {
  const settings = (extra: Record<string, unknown> = {}) => ({
    outra_chave: 1,
    fields: [
      { key: "a", label: "Cidade", type: "text" },
      { key: "parceiro", label: "Parceiro responsável", type: "searchable_select", required: false, options: [{ value: "1", label: "1 - A" }], ...extra },
    ],
  });

  it("mexe só nas opções do campo certo e preserva o resto do funil e do campo", () => {
    const r = aplicarParceirosNoSettings(settings({ obrigatorio_em: ["x"] }), [p("2", "B")]);
    expect(r?.criadas).toBe(1);
    const f = (r?.settings.fields as Record<string, unknown>[])[1]!;
    expect((f.options as unknown[]).length).toBe(2);
    expect(f.obrigatorio_em).toEqual(["x"]);
    expect(r?.settings.outra_chave).toBe(1);
    expect((r?.settings.fields as unknown[])[0]).toEqual({ key: "a", label: "Cidade", type: "text" });
  });

  it("funil sem o campo, ou com o campo que não é lista, não muda", () => {
    expect(aplicarParceirosNoSettings({ fields: [{ key: "a", label: "Cidade", type: "text" }] }, [p("2", "B")])).toBeNull();
    expect(aplicarParceirosNoSettings({ fields: [{ key: "p", label: "Parceiro responsável", type: "text" }] }, [p("2", "B")])).toBeNull();
    expect(aplicarParceirosNoSettings(null, [p("2", "B")])).toBeNull();
  });

  it("o rótulo do campo casa sem acento e sem caixa", () => {
    const s = { fields: [{ key: "p", label: "PARCEIRO RESPONSAVEL", type: "select", options: [] }] };
    expect(aplicarParceirosNoSettings(s, [p("2", "B")])?.criadas).toBe(1);
  });
});
