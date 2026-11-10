/**
 * sfy (Bloco A): valor do negócio exigido no ganho, opt-in por funil.
 */
import { describe, expect, it } from "vitest";

import { validaCamposExigidos } from "@/lib/leads/campos-exigidos";

const ligado = { fields: [], sfy_valor_obrigatorio_ao_ganhar: true };

function chaves(entrada: Parameters<typeof validaCamposExigidos>[0]) {
  return validaCamposExigidos(entrada).faltando.map((c) => c.chave);
}

describe("sfy: valor obrigatório ao ganhar", () => {
  it("funil sem o interruptor segue o original: ganhar sem valor passa", () => {
    expect(
      chaves({ lead: { value_cents: null }, settingsDoFunil: { fields: [] }, destino: { desfecho: "won" } }),
    ).toEqual([]);
  });

  it("ligado: ganhar sem valor (ou com zero) é recusado com a chave value_cents", () => {
    expect(chaves({ lead: { value_cents: null }, settingsDoFunil: ligado, destino: { desfecho: "won" } })).toEqual([
      "value_cents",
    ]);
    expect(chaves({ lead: { value_cents: 0 }, settingsDoFunil: ligado, destino: { desfecho: "won" } })).toEqual([
      "value_cents",
    ]);
  });

  it("ligado: valor no lead ou trazido pela escrita satisfaz", () => {
    expect(chaves({ lead: { value_cents: 150000 }, settingsDoFunil: ligado, destino: { desfecho: "won" } })).toEqual([]);
    expect(
      chaves({ lead: { value_cents: null }, settingsDoFunil: ligado, destino: { desfecho: "won" }, valorProposto: 990 }),
    ).toEqual([]);
  });

  it("ligado: perder ou só mover não exige valor", () => {
    expect(chaves({ lead: {}, settingsDoFunil: ligado, destino: { desfecho: "lost" } })).toEqual([]);
    expect(chaves({ lead: {}, settingsDoFunil: ligado, destino: { stageId: crypto.randomUUID(), desfecho: null } })).toEqual([]);
  });
});
