import { describe, expect, it, vi } from "vitest";

import { configDoSemanal, enviarResumos, ligarGrupos, podeEnviarAgora, textoDoResumo, type Destinatario } from "./semanal";
import type { LinhaDestino } from "./relatorios";

const linha = (o: Partial<LinhaDestino> = {}): LinhaDestino => ({
  grupo: "9001", rotulo: "9001 - Parceiro Fictício", leads: 10, abertos: 4, ganhos: 2, perdidos: 4,
  percentual_fechamento: 1 / 3, valor_ganho_por_moeda: { BRL: 150000 }, mediana_dias_ate_ganho: 3, ...o,
});
const dest = (o: Partial<Destinatario> = {}): Destinatario => ({
  papel: "parceiro", nome: "Parceiro Fictício", whatsapp: "(11) 90000-0001", email: "p@invariant.test", linha: linha(), ...o,
});
const deps = () => ({ enviaWhatsapp: vi.fn(async () => {}), enviaEmail: vi.fn(async () => ({ ok: true })) });

describe("relatório semanal sfy", () => {
  it("nasce desligado e não envia nada", async () => {
    const d = deps();
    const r = await enviarResumos(d, configDoSemanal({}), [dest()], { pausaMs: 0 });
    expect(r.modo).toBe("desligado");
    expect(d.enviaWhatsapp).not.toHaveBeenCalled();
    expect(d.enviaEmail).not.toHaveBeenCalled();
  });

  it("modo teste manda SÓ para o destino de teste, nunca ao parceiro, e diz quem receberia", async () => {
    const d = deps();
    const cfg = configDoSemanal({ sfy: { relatorio_semanal: true, relatorio_semanal_teste: { whatsapp: "11 98888-7777", email: "teste@invariant.test" } } });
    const r = await enviarResumos(d, cfg, [dest()], { pausaMs: 0 });
    expect(r.modo).toBe("teste");
    expect(d.enviaWhatsapp).toHaveBeenCalledTimes(1);
    const [numero, texto] = d.enviaWhatsapp.mock.calls[0] as unknown as [string, string];
    expect(numero).not.toContain("90000");
    expect(texto).toContain("[TESTE — iria para Parceiro Fictício]");
    expect(d.enviaEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["teste@invariant.test"] }));
  });

  it("modo real: pula quem não tem contato e conta falhas sem derrubar os demais", async () => {
    const d = deps();
    d.enviaWhatsapp.mockRejectedValueOnce(new Error("x"));
    const cfg = configDoSemanal({ sfy: { relatorio_semanal: true } });
    const r = await enviarResumos(d, cfg, [dest({ nome: "A" }), dest({ nome: "B", whatsapp: null, email: null }), dest({ nome: "C", email: null })], { pausaMs: 0 });
    expect(r.pulados).toEqual(["sem_contato:B"]);
    expect(r.falhas).toEqual(["whatsapp:A"]);
    expect(r.enviados).toBe(2); // e-mail do A e WhatsApp do C
  });

  it("intervalo mínimo de 6 dias entre envios reais", () => {
    const agora = new Date("2026-11-23T12:00:00Z");
    expect(podeEnviarAgora(null, agora)).toBe(true);
    expect(podeEnviarAgora("2026-11-17T12:00:00Z", agora)).toBe(true);
    expect(podeEnviarAgora("2026-11-20T12:00:00Z", agora)).toBe(false);
  });

  it("o texto traz as contas e não inventa taxa sem negócio encerrado", () => {
    const { texto } = textoDoResumo("parceiro", "Fulano", linha());
    expect(texto).toContain("Negócios recebidos: 10");
    expect(texto).toContain("33,3%");
    expect(texto).toMatch(/R\$\s?1\.500,00/);
    expect(textoDoResumo("supervisor", "Leo", linha({ percentual_fechamento: null, valor_ganho_por_moeda: {} })).texto).toContain("sem negócio encerrado ainda");
  });

  it("liga o grupo ao cadastro pelo código do rótulo ou pelo nome, ignorando inativos e grupo vazio", () => {
    const cad = [
      { codigo: "9001", nome: "Parceiro Fictício", whatsapp: "1", email: null, ativo: true },
      { codigo: "9002", nome: "Inativo", whatsapp: "2", email: null, ativo: false },
    ];
    expect(ligarGrupos([linha(), linha({ grupo: "9002", rotulo: "9002 - Inativo" }), linha({ grupo: "", rotulo: "" })], "parceiro", cad).map((x) => x.nome)).toEqual(["Parceiro Fictício"]);
    const sup = [{ nome: "Leo", whatsapp: "3", email: null, ativo: true }];
    expect(ligarGrupos([linha({ grupo: "Leo", rotulo: "Leo" })], "supervisor", sup)).toHaveLength(1);
  });

  it("link de fechamento: só no resumo do PARCEIRO, só com a opção ligada, e a falha em gerá-lo não impede o envio", async () => {
    const cfg = configDoSemanal({ sfy: { relatorio_semanal: true, link_de_fechamento: true } });
    const d = deps();
    const gerarLink = vi.fn(async () => "https://crm.exemplo/fechamento/TOKEN");
    await enviarResumos(d, cfg, [dest({ nome: "P" }), dest({ papel: "supervisor", nome: "S" })], { pausaMs: 0, gerarLink });
    expect(gerarLink).toHaveBeenCalledTimes(1);
    const textos = d.enviaWhatsapp.mock.calls.map((c) => (c as unknown as [string, string])[1]);
    expect(textos[0]).toContain("https://crm.exemplo/fechamento/TOKEN");
    expect(textos[1]).not.toContain("fechamento/");

    const desligado = deps();
    const g2 = vi.fn(async () => "https://x/fechamento/T");
    await enviarResumos(desligado, configDoSemanal({ sfy: { relatorio_semanal: true } }), [dest()], { pausaMs: 0, gerarLink: g2 });
    expect(g2).not.toHaveBeenCalled();

    const quebra = deps();
    const r = await enviarResumos(quebra, cfg, [dest()], { pausaMs: 0, gerarLink: async () => { throw new Error("x"); } });
    expect(r.falhas).toContain("link:Parceiro Fictício");
    expect(quebra.enviaWhatsapp).toHaveBeenCalledTimes(1);
    expect((quebra.enviaWhatsapp.mock.calls[0] as unknown as [string, string])[1]).not.toContain("fechamento/");
  });
});
