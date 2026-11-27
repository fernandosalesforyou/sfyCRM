import { describe, expect, it } from "vitest";

import {
  codigoDoLink,
  dentroDoHorarioComercial,
  emailDoCliente,
  montarMensagem,
  normalizaNfe,
  primeiroNome,
  proximaEtapa,
  respostaDeInstalacao,
  somaMeses,
  type PedidoPosVenda,
} from "@/lib/sfy/pos-venda";

const d = (s: string) => new Date(s);
const base: PedidoPosVenda = {
  situacao: "ativa",
  link_rastreio: "https://rastreio.climabrisa.com.br/r/abc_DEF-123",
  link_valido_ate: null,
  entregue_em: null,
  instalacao_confirmada_em: null,
  instalacao_adiada_em: null,
  msg1_em: null,
  msg2_em: null,
  msg2_repetida_em: null,
  msg3_em: null,
  criado_em: d("2026-11-01T12:00:00Z"),
};
const p = (o: Partial<PedidoPosVenda>): PedidoPosVenda => ({ ...base, ...o });

describe("proximaEtapa", () => {
  it("pausada, cancelada e concluída não fazem nada", () => {
    for (const situacao of ["pausada", "cancelada", "concluida"] as const)
      expect(proximaEtapa(p({ situacao }), d("2030-01-01T12:00:00Z"))).toBeNull();
  });
  it("aguardando link sem link: consulta; passou de 30 dias: desiste", () => {
    const aguardando = p({ situacao: "aguardando_link", link_rastreio: null });
    expect(proximaEtapa(aguardando, d("2026-11-10T12:00:00Z"))).toBe("consultar");
    expect(proximaEtapa(aguardando, d("2026-12-05T12:00:00Z"))).toBe("desistir");
  });
  it("aguardando link com link já achado: manda a 1ª com link", () => {
    expect(proximaEtapa(p({ situacao: "aguardando_link" }), d("2026-11-10T12:00:00Z"))).toBe("msg1_com_link");
  });
  it("ativa sem link (aviso liberado à mão): 1ª sem rastreio; link vencido também", () => {
    expect(proximaEtapa(p({ link_rastreio: null }), d("2026-11-10T12:00:00Z"))).toBe("msg1_sem_link");
    expect(proximaEtapa(p({ link_valido_ate: d("2026-11-09T00:00:00Z") }), d("2026-11-10T12:00:00Z"))).toBe("msg1_sem_link");
  });
  it("a 2ª só sai 45 dias depois do envio; se houve entrega, conta da entrega", () => {
    const enviado = p({ msg1_em: d("2026-11-10T12:00:00Z") });
    expect(proximaEtapa(enviado, d("2026-12-24T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(enviado, d("2026-12-25T12:00:00Z"))).toBe("msg2");
    const entregue = p({ msg1_em: d("2026-11-10T12:00:00Z"), entregue_em: d("2026-11-20T12:00:00Z") });
    expect(proximaEtapa(entregue, d("2026-12-25T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(entregue, d("2027-01-04T12:00:00Z"))).toBe("msg2");
  });
  it("'Ainda não' repete a pergunta uma vez, 30 dias depois", () => {
    const x = p({ msg1_em: d("2026-11-01T12:00:00Z"), msg2_em: d("2026-12-16T12:00:00Z"), instalacao_adiada_em: d("2026-12-17T12:00:00Z") });
    expect(proximaEtapa(x, d("2027-01-10T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(x, d("2027-01-16T12:00:00Z"))).toBe("msg2_repetida");
    expect(proximaEtapa({ ...x, msg2_repetida_em: d("2027-01-16T12:00:00Z") }, d("2027-01-17T12:00:00Z"))).toBeNull();
  });
  it("a 3ª conta 8 meses da instalação confirmada", () => {
    const x = p({ msg1_em: d("2026-11-01T12:00:00Z"), msg2_em: d("2026-12-16T12:00:00Z"), instalacao_confirmada_em: d("2026-12-20T12:00:00Z") });
    expect(proximaEtapa(x, d("2027-08-19T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(x, d("2027-08-20T12:00:00Z"))).toBe("msg3");
  });
  it("sem confirmação, a 3ª conta 8 meses da pergunta (D2); da repetida, se houve", () => {
    const x = p({ msg1_em: d("2026-11-01T12:00:00Z"), msg2_em: d("2026-12-16T12:00:00Z") });
    expect(proximaEtapa(x, d("2027-08-15T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(x, d("2027-08-16T12:00:00Z"))).toBe("msg3");
    const r = { ...x, instalacao_adiada_em: d("2026-12-17T12:00:00Z"), msg2_repetida_em: d("2027-01-16T12:00:00Z") };
    expect(proximaEtapa(r, d("2027-09-15T12:00:00Z"))).toBeNull();
    expect(proximaEtapa(r, d("2027-09-16T12:00:00Z"))).toBe("msg3");
  });
  it("depois da 3ª, nada mais", () => {
    const x = p({ msg1_em: d("2026-01-01T12:00:00Z"), msg2_em: d("2026-03-01T12:00:00Z"), msg3_em: d("2026-11-01T12:00:00Z") });
    expect(proximaEtapa(x, d("2030-01-01T12:00:00Z"))).toBeNull();
  });
  it("instalação confirmada antes da pergunta pula a 2ª", () => {
    const x = p({ msg1_em: d("2026-11-01T12:00:00Z"), instalacao_confirmada_em: d("2026-11-20T12:00:00Z") });
    expect(proximaEtapa(x, d("2026-12-20T12:00:00Z"))).toBeNull();
  });
});

describe("somaMeses", () => {
  it("não estoura para o mês seguinte", () => {
    expect(somaMeses(d("2026-08-31T12:00:00Z"), 6).toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(somaMeses(d("2027-08-31T12:00:00Z"), 6).toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(somaMeses(d("2026-12-15T12:00:00Z"), 8).toISOString().slice(0, 10)).toBe("2027-08-15");
  });
});

describe("dentroDoHorarioComercial (Brasília, seg-sáb, 9h-18h)", () => {
  it("12:00 UTC de segunda é 09h: dentro; 11:59 UTC é 08h59: fora", () => {
    expect(dentroDoHorarioComercial(d("2026-11-16T12:00:00Z"))).toBe(true);
    expect(dentroDoHorarioComercial(d("2026-11-16T11:59:00Z"))).toBe(false);
  });
  it("20:59 UTC é 17h59: dentro; 21:00 UTC é 18h: fora", () => {
    expect(dentroDoHorarioComercial(d("2026-11-16T20:59:00Z"))).toBe(true);
    expect(dentroDoHorarioComercial(d("2026-11-16T21:00:00Z"))).toBe(false);
  });
  it("domingo fora, sábado dentro", () => {
    expect(dentroDoHorarioComercial(d("2026-11-22T15:00:00Z"))).toBe(false);
    expect(dentroDoHorarioComercial(d("2026-11-21T15:00:00Z"))).toBe(true);
  });
});

describe("contato e textos", () => {
  it("descarta o e-mail da própria Climabrisa e o inválido", () => {
    expect(emailDoCliente("Nota.Eletronica@climabrisa.com.br", "climabrisa.com.br")).toBeNull();
    expect(emailDoCliente("abc", "climabrisa.com.br")).toBeNull();
    expect(emailDoCliente(" Fulano@Exemplo.com ", "climabrisa.com.br")).toBe("fulano@exemplo.com");
  });
  it("primeiro nome com cuidado", () => {
    expect(primeiroNome("THIAGO SILVA")).toBe("Thiago");
    expect(primeiroNome(null)).toBe("cliente");
    expect(primeiroNome("123 Ltda")).toBe("cliente");
  });
  it("código do link só do Rastreio Brisa em /r/", () => {
    expect(codigoDoLink("https://rastreio.climabrisa.com.br/r/abc_DEF-123")).toBe("abc_DEF-123");
    expect(codigoDoLink("https://rastreio.climabrisa.com.br/outra/coisa")).toBeNull();
  });
  it("mensagem 1 com link usa o botão; link fora do formato cai na versão sem botão", () => {
    const m = montarMensagem("msg1_com_link", { nome: "Ana Lima", nfe: "54552", link: "https://rastreio.climabrisa.com.br/r/xyz" });
    expect(m.modelo).toBe("climabrisa_pedido_enviado");
    expect(m.valores).toEqual({ "1": "Ana", "2": "54552", "button0:1": "xyz" });
    const sem = montarMensagem("msg1_com_link", { nome: "Ana", nfe: "1", link: "https://climabrisa.com.br/qualquer" });
    expect(sem.modelo).toBe("climabrisa_pedido_enviado_sem_rastreio");
  });
  it("NF-e: só dígitos, sem zeros à esquerda", () => {
    expect(normalizaNfe(" 054552 ")).toBe("54552");
    expect(normalizaNfe("NF 54.552")).toBe("54552");
    expect(normalizaNfe("")).toBeNull();
    expect(normalizaNfe(0)).toBeNull();
  });
  it("resposta do botão da 2ª mensagem", () => {
    expect(respostaDeInstalacao("Já instalei")).toBe("instalou");
    expect(respostaDeInstalacao("  AINDA NÃO ")).toBe("ainda_nao");
    expect(respostaDeInstalacao("oi")).toBeNull();
  });
});
