import { describe, expect, it } from "vitest";

import {
  acharCampoPorRotulo,
  acharEtapaDeDestino,
  normalizaTexto,
  opcaoDoParceiro,
  opcaoDoSupervisor,
} from "@/lib/sfy/distribuicao";
import type { CustomFieldDef } from "@/lib/schemas/settings";

const campo = (label: string, options: { value: string; label: string }[]): CustomFieldDef =>
  ({ key: label.toLowerCase().replace(/\W+/g, "_"), label, type: "searchable_select", options }) as unknown as CustomFieldDef;

describe("sfy distribuição — auxiliares", () => {
  it("normaliza acento, caixa e espaços", () => {
    expect(normalizaTexto("  São  José ")).toBe("sao jose");
  });

  it("acha o campo pelo rótulo, sem acento nem caixa", () => {
    const campos = [campo("Cidade", []), campo("Parceiro responsável", [])];
    expect(acharCampoPorRotulo(campos, "parceiro responsavel")?.label).toBe("Parceiro responsável");
    expect(acharCampoPorRotulo(campos, "Supervisor")).toBeNull();
  });

  it("acha a opção do parceiro pelo código, no valor ou no rótulo", () => {
    const c = campo("Parceiro responsável", [
      { value: "7096", label: "7096 - JAQUES (Fabtech)" },
      { value: "p2", label: "7765 - RENATO" },
    ]);
    expect(opcaoDoParceiro(c, "7096")).toBe("7096");
    expect(opcaoDoParceiro(c, "7765")).toBe("p2");
    expect(opcaoDoParceiro(c, "70")).toBeNull();
    expect(opcaoDoParceiro(c, "9999")).toBeNull();
  });

  it("acha a opção do supervisor pelo nome ou pelo primeiro nome, sem chutar quando é ambíguo", () => {
    const c = campo("Supervisor", [
      { value: "marcos", label: "Marcos" },
      { value: "leo", label: "Leo" },
      { value: "luis", label: "Luís Guilherme" },
    ]);
    expect(opcaoDoSupervisor(c, "Leo")).toBe("leo");
    expect(opcaoDoSupervisor(c, "Luis Guilherme")).toBe("luis");
    expect(opcaoDoSupervisor(c, "Leo Silva")).toBe("leo");
    expect(opcaoDoSupervisor(c, "Cleiton")).toBeNull();
    const ambiguo = campo("Supervisor", [
      { value: "a", label: "Carol Um" },
      { value: "b", label: "Carol Dois" },
    ]);
    expect(opcaoDoSupervisor(ambiguo, "Carol")).toBeNull();
  });

  it("acha a etapa de destino, e só quando é única", () => {
    const etapas = [
      { id: "1", name: "Em negociação por supervisor" },
      { id: "2", name: "Em negociação por representante" },
      { id: "3", name: "Ganho" },
    ];
    expect(acharEtapaDeDestino(etapas, "supervisor")?.id).toBe("1");
    expect(acharEtapaDeDestino(etapas, "representante")?.id).toBe("2");
    expect(acharEtapaDeDestino(etapas.slice(2), "supervisor")).toBeNull();
    expect(acharEtapaDeDestino([...etapas, { id: "4", name: "Em negociação por supervisor 2" }], "supervisor")).toBeNull();
  });
});
