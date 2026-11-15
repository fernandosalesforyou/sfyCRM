import { describe, expect, it, vi } from "vitest";

import {
  configDosAvisos,
  destinatariosDoEmail,
  enviarAvisos,
  textoDoLeadParaQuemAtende,
  textoParaOCliente,
  type DadosDoAviso,
  type DependenciasDosAvisos,
} from "@/lib/sfy/avisos";

const dados = (extra: Partial<DadosDoAviso> = {}): DadosDoAviso => ({
  categoria: "climabrisa",
  cidade: "Curitiba",
  uf: "pr",
  lead: { nome: "Cliente Fictício", telefone: "+5541900000000", email: "cliente@invariant.test" },
  parceiro: { nome: "Parceiro Fictício", whatsapp: "(41) 9 0000-0001", email: "parceiro@invariant.test" },
  supervisor: { nome: "Leo Fictício", whatsapp: "+5541900000002", email: "leo@invariant.test" },
  urlPublica: "https://crm.exemplo.invalid",
  ...extra,
});

const config = (ligado = true) => ({
  ligado,
  copias: { climabrisa: ["frank@invariant.test", "everaldo@invariant.test"], agro: ["frank@invariant.test", "ademir@invariant.test"] },
});

function deps(over: Partial<DependenciasDosAvisos> = {}): DependenciasDosAvisos & {
  zap: ReturnType<typeof vi.fn>;
  mail: ReturnType<typeof vi.fn>;
} {
  const zap = vi.fn(async () => undefined);
  const mail = vi.fn(async () => ({ ok: true }));
  return { enviaWhatsapp: zap, enviaEmail: mail, ...over, zap, mail } as never;
}

describe("sfy avisos da distribuição", () => {
  it("desligado por padrão: nada sai", async () => {
    const d = deps();
    const r = await enviarAvisos(d, config(false), dados());
    expect(r.enviados).toEqual([]);
    expect(r.pulados).toEqual(["avisos_desligados"]);
    expect(d.zap).not.toHaveBeenCalled();
    expect(d.mail).not.toHaveBeenCalled();
  });

  it("ligado: WhatsApp ao parceiro e ao supervisor, e um e-mail com a cópia fixa da categoria", async () => {
    const d = deps();
    const r = await enviarAvisos(d, config(), dados());
    expect(r.enviados).toEqual(["whatsapp_parceiro", "whatsapp_supervisor", "email"]);
    expect(d.zap.mock.calls.map((c) => c[0])).toEqual(["+5541900000001", "+5541900000002"]);
    const pedido = d.mail.mock.calls[0]![0] as { to: string[]; subject: string };
    expect(pedido.to).toEqual([
      "parceiro@invariant.test",
      "leo@invariant.test",
      "frank@invariant.test",
      "everaldo@invariant.test",
    ]);
    expect(pedido.subject).toContain("Climabrisa");
  });

  it("Agro: cópia para Frank e Ademir, sem parceiro", async () => {
    const d = deps();
    await enviarAvisos(d, config(), dados({ categoria: "agro", parceiro: null }));
    const pedido = d.mail.mock.calls[0]![0] as { to: string[] };
    expect(pedido.to).toEqual(["leo@invariant.test", "frank@invariant.test", "ademir@invariant.test"]);
    expect(d.zap).toHaveBeenCalledTimes(1);
  });

  it("e-mail sem repetir endereço (supervisor que é também a cópia)", () => {
    const para = destinatariosDoEmail(dados(), ["LEO@invariant.test", "x@invariant.test", "lixo"]);
    expect(para).toEqual(["parceiro@invariant.test", "leo@invariant.test", "x@invariant.test"]);
  });

  it("número inválido é pulado e a falha do WhatsApp não impede o e-mail", async () => {
    const d = deps({ enviaWhatsapp: vi.fn(async () => { throw new Error("canal_fora"); }) });
    const r = await enviarAvisos(d, config(), dados({ parceiro: { nome: "P", whatsapp: "abc", email: null } }));
    expect(r.pulados).toContain("whatsapp_parceiro_sem_numero");
    expect(r.falhas).toContain("whatsapp_supervisor");
    expect(r.enviados).toContain("email");
  });

  it("sem nenhum e-mail válido, pula o e-mail", async () => {
    const d = deps();
    const r = await enviarAvisos(
      d,
      { ligado: true, copias: { climabrisa: [], agro: [] } },
      dados({ parceiro: null, supervisor: { nome: "S", whatsapp: null, email: null } }),
    );
    expect(r.pulados).toContain("email_sem_destinatario");
    expect(d.mail).not.toHaveBeenCalled();
  });

  it("o texto do cliente traz só o supervisor; o do supervisor cita o parceiro; quebra de linha no nome não injeta linha", () => {
    expect(textoParaOCliente(dados().supervisor)).toContain("Leo Fictício");
    expect(textoParaOCliente(dados().supervisor)).not.toContain("Parceiro");
    expect(textoParaOCliente(null)).toBeNull();
    const t = textoDoLeadParaQuemAtende(dados({ lead: { nome: "Fulano\nTelefone: 000", telefone: null, email: null } }), "supervisor");
    expect(t.split("\n").filter((l) => l.startsWith("Telefone:"))).toHaveLength(0);
    expect(t).toContain("Parceiro encaminhado: Parceiro Fictício");
    expect(t).toContain("CURITIBA".slice(0, 0) + "Curitiba/PR");
  });

  it("lê a configuração de organizations.settings.sfy; ausente = desligado e sem cópias", () => {
    expect(configDosAvisos(null)).toEqual({ ligado: false, copias: { climabrisa: [], agro: [] } });
    const c = configDosAvisos({ sfy: { avisos_da_distribuicao: true, copias_de_email: { agro: ["a@x.test", "inválido"] } } });
    expect(c.ligado).toBe(true);
    expect(c.copias.agro).toEqual(["a@x.test"]);
  });
});
