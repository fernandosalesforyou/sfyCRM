import { describe, expect, it } from "vitest";

import { valorDoSupervisor } from "./distribuicao";
import { donoDoNome, lerUfs, nomeAtualDe, nomesAnterioresApos, ufsEmUso, type SupervisorCadastrado } from "./supervisores";

const lista: SupervisorCadastrado[] = [
  { id: "1", nome: "Jéssica", categoria: "climabrisa", ufs: [], ativo: true, nomes_anteriores: ["Jess"] },
  { id: "2", nome: "Cleiton", categoria: "agro", ufs: ["RS", "SC"], ativo: true },
  { id: "3", nome: "Antigo", categoria: "agro", ufs: ["PR"], ativo: false },
];

describe("lerUfs", () => {
  it("aceita separadores variados, ordena, sem repetir", () => {
    expect(lerUfs("rs, sc; PR rs")).toEqual({ ufs: ["PR", "RS", "SC"], invalidas: [] });
  });
  it("separa o que não é estado", () => {
    expect(lerUfs("RS, XX")).toEqual({ ufs: ["RS"], invalidas: ["XX"] });
  });
});

describe("donoDoNome", () => {
  it("ignora acento e maiúscula e olha nomes antigos", () => {
    expect(donoDoNome(lista, "jessica")?.id).toBe("1");
    expect(donoDoNome(lista, "JESS")?.id).toBe("1");
    expect(donoDoNome(lista, "Marcos")).toBeNull();
  });
  it("o próprio supervisor pode voltar a um nome dele", () => {
    expect(donoDoNome(lista, "Jess", "1")).toBeNull();
  });
});

describe("ufsEmUso", () => {
  it("só conta supervisor ativo do Agro, e nunca o próprio", () => {
    expect(ufsEmUso(lista, ["RS", "PR"])).toEqual([{ uf: "RS", nome: "Cleiton" }]);
    expect(ufsEmUso(lista, ["RS"], "2")).toEqual([]);
  });
});

describe("nomes antigos", () => {
  it("guarda o nome que saiu e tira o que voltou", () => {
    expect(nomesAnterioresApos(lista[0]!, "Jessica Lima")).toEqual(["Jess", "Jéssica"]);
    expect(nomesAnterioresApos(lista[0]!, "Jess")).toEqual(["Jéssica"]);
  });
  it("traduz o valor antigo para o nome atual; desconhecido fica como está", () => {
    expect(nomeAtualDe(lista, "jess")).toBe("Jéssica");
    expect(nomeAtualDe(lista, "Jessica")).toBe("Jessica");
    expect(nomeAtualDe(lista, "Outro")).toBe("Outro");
  });
});

describe("valorDoSupervisor", () => {
  it("campo de texto recebe o nome; campo de lista exige a opção", () => {
    const texto = { key: "supervisor", label: "Supervisor", type: "text" } as never;
    const lista = { key: "supervisor", label: "Supervisor", type: "select", options: [{ value: "leo", label: "Leo" }] } as never;
    expect(valorDoSupervisor(texto, "Pessoa Nova")).toBe("Pessoa Nova");
    expect(valorDoSupervisor(lista, "Leo")).toBe("leo");
    expect(valorDoSupervisor(lista, "Pessoa Nova")).toBeNull();
  });
});
