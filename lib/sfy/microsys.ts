/**
 * sfy (fork Sales for You, etapa 10) — cliente da PONTE da TI na frente do Microsys.
 *
 * A TI da Climabrisa publicou uma ponte (Worker na Cloudflare, com token) que consulta o
 * Microsys pela NF-e e devolve o link do Rastreio Brisa. O Microsys em si não diz "enviado".
 *
 * ATENÇÃO — FORMATO PROVISÓRIO: a documentação da ponte ainda não chegou. O leitor abaixo é
 * TOLERANTE (aceita os nomes de campo mais prováveis) e deve ser fechado contra a documentação
 * real. Dados pessoais do cliente que a ponte devolva são IGNORADOS de propósito: o contato é
 * sempre o do CRM (o Microsys às vezes traz o e-mail da própria Climabrisa como "cliente").
 *
 * Segurança: o link só é aceito se for https e do domínio da empresa (SFY_DOMINIO_DA_EMPRESA). Um erro (ou invasão)
 * da ponte nunca faz o CRM mandar um link estranho ao cliente.
 */

export interface ConsultaNfe {
  encontrado: boolean;
  link: string | null;
  validoAte: Date | null;
  situacao: string;
  entregueEm: Date | null;
  vendaNumero: string;
}

export class PonteIndisponivel extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "PonteIndisponivel";
  }
}

export interface ConfigDaPonte {
  url: string;
  token: string;
  /** Domínio da empresa: o único aceito no link de rastreio. */
  dominio: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const NAO_ACHADA: ConsultaNfe = { encontrado: false, link: null, validoAte: null, situacao: "", entregueEm: null, vendaNumero: "" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function primeiroTexto(...candidatos: unknown[]): string {
  for (const c of candidatos) {
    const t = texto(c);
    if (t) return t;
  }
  return "";
}

function dataOuNula(v: unknown): Date | null {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Só https e só o domínio informado (ou subdomínio dele). Sem domínio configurado, nada passa. */
export function linkPermitido(link: string, dominio: string): boolean {
  const alvo = dominio.trim().toLowerCase();
  if (!alvo) return false;
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    return u.hostname === alvo || u.hostname.endsWith(`.${alvo}`);
  } catch {
    return false;
  }
}

export function lerResposta(corpo: unknown, dominio: string, agora: Date = new Date()): ConsultaNfe {
  const raiz = obj(corpo);
  const dados = obj(raiz.data ?? raiz.resultado ?? raiz);
  const rastreio = obj(dados.rastreio ?? dados.tracking);

  const bruto = primeiroTexto(dados.link_rastreio, dados.linkRastreio, rastreio.link, rastreio.url, dados.link, dados.url);
  const link = bruto && linkPermitido(bruto, dominio) ? bruto : null;
  const situacao = primeiroTexto(rastreio.situacao, rastreio.status, dados.situacao_rastreio, dados.situacao, dados.status).slice(0, 120);
  const entregue = /entregue/i.test(situacao);
  const entregueEm = dataOuNula(primeiroTexto(dados.entregue_em, dados.data_entrega, rastreio.entregue_em)) ?? (entregue ? agora : null);

  return {
    encontrado: true,
    link,
    validoAte: dataOuNula(primeiroTexto(dados.link_valido_ate, dados.valido_ate, dados.validade, rastreio.valido_ate)),
    situacao,
    entregueEm: entregue ? entregueEm : null,
    vendaNumero: primeiroTexto(dados.venda, dados.venda_numero, dados.numero_venda).slice(0, 40),
  };
}

export async function consultarNfe(cfg: ConfigDaPonte, numero: string, serie = ""): Promise<ConsultaNfe> {
  if (!cfg.url || !cfg.token || !cfg.dominio) throw new PonteIndisponivel("ponte_nao_configurada");
  const base = cfg.url.replace(/\/$/, "");
  // http só para teste local (ponte falsa em localhost); em qualquer outro endereço exige https.
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(base);
  if (!base.startsWith("https://") && !local) throw new PonteIndisponivel("ponte_sem_https");
  const alvo = `${base}/nfe/${encodeURIComponent(numero)}${serie ? `?serie=${encodeURIComponent(serie)}` : ""}`;

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), cfg.timeoutMs ?? 8000);
  try {
    const res = await (cfg.fetchImpl ?? fetch)(alvo, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: controle.signal,
      cache: "no-store",
    });
    if (res.status === 404) return NAO_ACHADA;
    if (res.status === 429) throw new PonteIndisponivel("ponte_limite_de_consultas");
    if (res.status === 401 || res.status === 403) throw new PonteIndisponivel("ponte_recusou_o_token");
    if (!res.ok) throw new PonteIndisponivel(`ponte_http_${res.status}`);
    return lerResposta(await res.json(), cfg.dominio);
  } catch (e) {
    if (e instanceof PonteIndisponivel) throw e;
    throw new PonteIndisponivel(e instanceof Error && e.name === "AbortError" ? "ponte_demorou" : "ponte_fora_do_ar");
  } finally {
    clearTimeout(timer);
  }
}
