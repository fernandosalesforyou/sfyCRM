import { describe, expect, it } from "vitest";

import { consultarNfe, lerResposta, linkPermitido, PonteIndisponivel } from "@/lib/sfy/microsys";

const resp = (status: number, corpo: unknown = {}) =>
  (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;
const cfg = (fetchImpl: typeof fetch) => ({ url: "https://ponte.exemplo.dev/", token: "tok", fetchImpl });

describe("linkPermitido", () => {
  it("só https e só domínio da Climabrisa", () => {
    expect(linkPermitido("https://rastreio.climabrisa.com.br/r/x")).toBe(true);
    expect(linkPermitido("http://rastreio.climabrisa.com.br/r/x")).toBe(false);
    expect(linkPermitido("https://climabrisa.com.br.golpe.com/r/x")).toBe(false);
    expect(linkPermitido("https://usuario:senha@rastreio.climabrisa.com.br/r/x")).toBe(false);
    expect(linkPermitido("nao é url")).toBe(false);
  });
});

describe("lerResposta", () => {
  it("lê link, validade, situação e venda; ignora dados pessoais", () => {
    const r = lerResposta({ link_rastreio: "https://rastreio.climabrisa.com.br/r/x", link_valido_ate: "2026-11-18T00:00:00Z", situacao: "Em trânsito", venda: 5369, email: "x@y.com", cnpj: "1" });
    expect(r).toMatchObject({ encontrado: true, link: "https://rastreio.climabrisa.com.br/r/x", situacao: "Em trânsito", vendaNumero: "5369", entregueEm: null });
    expect(r.validoAte?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(JSON.stringify(r)).not.toContain("x@y.com");
  });
  it("link de fora do domínio é descartado", () => {
    expect(lerResposta({ link: "https://golpe.com/r/x" }).link).toBeNull();
  });
  it("'Entregue ao destinatário' sem data usa a hora da consulta", () => {
    const agora = new Date("2026-11-19T15:00:00Z");
    expect(lerResposta({ rastreio: { status: "Entregue ao destinatário" } }, agora).entregueEm).toEqual(agora);
  });
});

describe("consultarNfe", () => {
  it("404 = nota não achada", async () => {
    expect((await consultarNfe(cfg(resp(404)), "1")).encontrado).toBe(false);
  });
  it("200 devolve a consulta; manda o token e codifica o número", async () => {
    let url = "";
    let auth = "";
    const f = (async (u: string, init: RequestInit) => {
      url = u;
      auth = (init.headers as Record<string, string>).Authorization!;
      return new Response(JSON.stringify({ link: "https://rastreio.climabrisa.com.br/r/x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await consultarNfe(cfg(f), "54552", "2");
    expect(r.link).toBe("https://rastreio.climabrisa.com.br/r/x");
    expect(url).toBe("https://ponte.exemplo.dev/nfe/54552?serie=2");
    expect(auth).toBe("Bearer tok");
  });
  it("erros viram PonteIndisponivel com motivo claro", async () => {
    await expect(consultarNfe(cfg(resp(429)), "1")).rejects.toThrow("ponte_limite_de_consultas");
    await expect(consultarNfe(cfg(resp(401)), "1")).rejects.toThrow("ponte_recusou_o_token");
    await expect(consultarNfe(cfg(resp(500)), "1")).rejects.toThrow("ponte_http_500");
    await expect(consultarNfe({ url: "", token: "", fetchImpl: resp(200) }, "1")).rejects.toBeInstanceOf(PonteIndisponivel);
    await expect(consultarNfe({ url: "http://inseguro.dev", token: "t", fetchImpl: resp(200) }, "1")).rejects.toThrow("ponte_sem_https");
  });
  it("falha de rede vira ponte_fora_do_ar", async () => {
    const f = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    await expect(consultarNfe(cfg(f), "1")).rejects.toThrow("ponte_fora_do_ar");
  });
});
