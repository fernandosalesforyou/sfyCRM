import { describe, expect, it } from "vitest";

import { bytesDoBase64, dominioDe, montarEnvio } from "@/lib/sfy/email-usuario";

const joao = { email: "Joao@Climabrisa.com.br", nome: "João Silva" };
const base = { para: ["cliente@exemplo.com"], assunto: "Proposta", corpo: "Olá\n<b>x</b>" };

describe("montarEnvio", () => {
  it("usuário do domínio verificado: sai no nome dele, responde para ele, cópia oculta para ele", () => {
    const m = montarEnvio(joao, "climabrisa.com.br", base);
    expect(m.fromEndereco).toBe("joao@climabrisa.com.br");
    expect(m.fromName).toBe("João Silva");
    expect(m.replyTo).toBe("joao@climabrisa.com.br");
    expect(m.bcc).toEqual(["joao@climabrisa.com.br"]);
    expect(m.html).toBe("Olá<br>&lt;b&gt;x&lt;/b&gt;");
    expect(m.text).toBe("Olá\n<b>x</b>");
  });
  it("usuário de OUTRO domínio não pode falsificar o De: usa o remetente padrão com Reply-To", () => {
    const m = montarEnvio({ email: "fulano@gmail.com", nome: "Fulano" }, "climabrisa.com.br", base);
    expect(m.fromEndereco).toBeUndefined();
    expect(m.fromName).toBe("Fulano (via CRM)");
    expect(m.replyTo).toBe("fulano@gmail.com");
  });
  it("sem remetente configurado, nunca usa o endereço do usuário no De", () => {
    expect(montarEnvio(joao, null, base).fromEndereco).toBeUndefined();
  });
  it("não duplica a cópia oculta quando o usuário já é destinatário", () => {
    expect(montarEnvio(joao, "climabrisa.com.br", { ...base, cc: ["joao@climabrisa.com.br"] }).bcc).toEqual([]);
  });
  it("recusa endereço inválido, assunto/corpo vazios e destinatários demais", () => {
    expect(() => montarEnvio(joao, null, { ...base, para: ["sem-arroba"] })).toThrow(/inválido/);
    expect(() => montarEnvio(joao, null, { ...base, para: [] })).toThrow(/destinatário/);
    expect(() => montarEnvio(joao, null, { ...base, assunto: "  " })).toThrow(/assunto/);
    expect(() => montarEnvio(joao, null, { ...base, corpo: " " })).toThrow(/mensagem/);
    expect(() => montarEnvio(joao, null, { ...base, para: Array.from({ length: 21 }, (_, i) => `a${i}@x.com`) })).toThrow(/máximo/);
    expect(() => montarEnvio({ email: "invalido", nome: null }, null, base)).toThrow(/e-mail válido/);
  });
  it("impede injeção de cabeçalho no assunto e no nome", () => {
    const m = montarEnvio({ email: "joao@climabrisa.com.br", nome: "Joao\r\nBcc: x@y.com" }, "climabrisa.com.br", { ...base, assunto: "Oi\r\nBcc: x@y.com" });
    expect(m.subject).toBe("Oi Bcc: x@y.com");
    expect(() => montarEnvio(joao, null, { ...base, para: ["a@b.com\r\nBcc: x@y.com"] })).toThrow(/inválido/);
  });
  it("limita anexos a 3 MB no total e higieniza o nome", () => {
    const grande = Buffer.alloc(3 * 1024 * 1024 + 10).toString("base64");
    expect(() => montarEnvio(joao, null, { ...base, anexos: [{ nome: "a.pdf", tipo: "application/pdf", base64: grande }] })).toThrow(/3 MB/);
    const ok = Buffer.from("oi").toString("base64");
    const m = montarEnvio(joao, null, { ...base, anexos: [{ nome: "../a:b.pdf", tipo: "", base64: ok }] });
    expect(m.attachments[0]!.filename).toBe(".._a_b.pdf");
    expect(m.attachments[0]!.contentType).toBeUndefined();
    expect(bytesDoBase64(ok)).toBe(2);
  });
  it("dominioDe", () => {
    expect(dominioDe("A@B.com")).toBe("b.com");
    expect(dominioDe(null)).toBeNull();
  });
});
