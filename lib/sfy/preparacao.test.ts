import { describe, expect, it } from "vitest";
import { emPreparacao, telasLiberadas } from "./preparacao";

describe("modo em preparação", () => {
  it("fica desligado sem a variável ou com lista vazia", () => {
    expect(telasLiberadas(undefined)).toBeNull();
    expect(telasLiberadas(" , ")).toBeNull();
    expect(telasLiberadas("https://fora.example")).toBeNull();
  });

  it("lê a lista e ignora espaços e barra final", () => {
    expect(telasLiberadas(" /app/kanban/ , /app/contacts")).toEqual(["/app/kanban", "/app/contacts"]);
  });

  it("libera a tela e as filhas, não os nomes parecidos", () => {
    const lista = ["/app/kanban", "/app/contacts"];
    expect(emPreparacao("/app/kanban", lista)).toBe(false);
    expect(emPreparacao("/app/contacts/123", lista)).toBe(false);
    expect(emPreparacao("/app/contacts-antigos", lista)).toBe(true);
    expect(emPreparacao("/app/inbox", lista)).toBe(true);
    expect(emPreparacao("/app/settings/tenant/pipelines", lista)).toBe(true);
  });

  it("nunca bloqueia a entrada, o perfil e a segurança", () => {
    expect(emPreparacao("/app", ["/app/kanban"])).toBe(false);
    expect(emPreparacao("/app/settings/profile", ["/app/kanban"])).toBe(false);
    expect(emPreparacao("/app/settings/security", ["/app/kanban"])).toBe(false);
  });
});
