"use client";

/**
 * sfy (Climabrisa): painel comercial do Desempenho — indicadores e gráficos dos negócios do CRM.
 * Os números vêm prontos de `fn_sfy_painel_comercial` (uma chamada só, no servidor).
 */
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface DadosDoPainel {
  kpis: {
    total: number;
    abertos: number;
    ganhos: number;
    perdidos: number;
    valor_ganho: number;
    valor_aberto: number;
    ganhos_com_valor: number;
    parceiros_ativos: number;
  };
  por_mes: {
    mes: string;
    criados: number;
    ganhos: number;
    perdidos: number;
    valor_ganho: number;
  }[];
  por_etapa: { funil: string; etapa: string; pos: number; qtd: number; valor: number }[];
  por_funil: { nome: string; qtd: number }[];
  por_supervisor: {
    nome: string;
    total: number;
    abertos: number;
    ganhos: number;
    perdidos: number;
    valor_ganho: number;
  }[];
  por_parceiro: {
    codigo: string;
    nome: string;
    total: number;
    ganhos: number;
    valor_ganho: number;
  }[];
  por_uf: { uf: string; qtd: number; ganhos: number }[];
  por_categoria: { nome: string; qtd: number }[];
}

const MARINHO = "#163f5b";
const CORES = [
  "#163f5b",
  "#1f8fbf",
  "#2bb673",
  "#f5a623",
  "#e8574e",
  "#7b61ff",
  "#14b8a6",
  "#ec4899",
  "#64748b",
];
const VERDE = "#2bb673";
const VERMELHO = "#e8574e";
const AZUL = "#1f8fbf";
const AMBAR = "#f5a623";

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
const brlCurto = (centavos: number) => {
  const v = centavos / 100;
  if (v >= 1_000_000)
    return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000)
    return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return brl(centavos);
};
const num = (n: number) => n.toLocaleString("pt-BR");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

const PERIODOS = [
  { id: "90", rotulo: "90 dias" },
  { id: "365", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
];

function Cartao({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm ${className}`}>
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
  cor,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  cor: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: cor }} />
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: cor }}>
        {valor}
      </p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

const dicaEstilo = { borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 };

export function PainelComercial({ dados, periodo }: { dados: DadosDoPainel; periodo: string }) {
  const k = dados.kpis;
  const fechados = k.ganhos + k.perdidos;
  const conversao = fechados > 0 ? (k.ganhos / fechados) * 100 : 0;
  const ticket = k.ganhos_com_valor > 0 ? k.valor_ganho / k.ganhos_com_valor : 0;
  const porMes = dados.por_mes
    .slice(-18)
    .map((m) => ({ ...m, rotulo: rotuloMes(m.mes), valor: m.valor_ganho / 100 }));
  const status = [
    { nome: "Em aberto", qtd: k.abertos, cor: AZUL },
    { nome: "Ganhos", qtd: k.ganhos, cor: VERDE },
    { nome: "Perdidos", qtd: k.perdidos, cor: VERMELHO },
  ].filter((s) => s.qtd > 0);
  const etapas = dados.por_etapa.filter((e) => e.qtd > 0 || e.pos >= 0);
  const parceiros = dados.por_parceiro.map((p) => ({
    ...p,
    valor: p.valor_ganho / 100,
    curto: p.nome.length > 22 ? `${p.nome.slice(0, 21)}…` : p.nome,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: MARINHO }}>
            Painel comercial
          </h2>
          <p className="text-sm text-muted-foreground">
            Negócios, conversão e resultado por supervisor, parceiro e região.
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg border bg-muted/40 p-1" aria-label="Período">
          {PERIODOS.map((p) => (
            <Link
              key={p.id}
              href={`/app/metrics?periodo=${p.id}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                periodo === p.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.rotulo}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Indicador
          rotulo="Negócios"
          valor={num(k.total)}
          detalhe={`${num(k.abertos)} em aberto`}
          cor={MARINHO}
        />
        <Indicador
          rotulo="Ganhos"
          valor={num(k.ganhos)}
          detalhe={`${num(k.perdidos)} perdidos`}
          cor={VERDE}
        />
        <Indicador
          rotulo="Conversão"
          valor={`${conversao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          detalhe="ganhos ÷ fechados"
          cor={AZUL}
        />
        <Indicador
          rotulo="Valor ganho"
          valor={brlCurto(k.valor_ganho)}
          detalhe={brl(k.valor_ganho)}
          cor={VERDE}
        />
        <Indicador
          rotulo="Ticket médio"
          valor={brlCurto(ticket)}
          detalhe="por negócio ganho"
          cor={AMBAR}
        />
        <Indicador
          rotulo="Parceiros ativos"
          valor={num(k.parceiros_ativos)}
          detalhe="com negócio em aberto"
          cor="#7b61ff"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao titulo="Evolução mensal: negócios criados e ganhos" className="lg:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={porMes} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCriados" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={MARINHO} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={MARINHO} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gGanhos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VERDE} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={VERDE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={dicaEstilo} cursor={{ fill: "rgba(22,63,91,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="criados"
                  name="Criados"
                  stroke={MARINHO}
                  strokeWidth={2}
                  fill="url(#gCriados)"
                />
                <Area
                  type="monotone"
                  dataKey="ganhos"
                  name="Ganhos"
                  stroke={VERDE}
                  strokeWidth={2}
                  fill="url(#gGanhos)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Cartao>

        <Cartao titulo="Situação dos negócios">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={status}
                  dataKey="qtd"
                  nameKey="nome"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                >
                  {status.map((s) => (
                    <Cell key={s.nome} fill={s.cor} />
                  ))}
                </Pie>
                <Tooltip contentStyle={dicaEstilo} formatter={(v) => num(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo={`Funil principal por etapa${etapas[0] ? ` (${etapas[0].funil})` : ""}`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={etapas}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="etapa"
                  width={170}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip contentStyle={dicaEstilo} formatter={(v) => num(Number(v))} />
                <Bar dataKey="qtd" name="Negócios" radius={[0, 6, 6, 0]}>
                  {etapas.map((e, i) => (
                    <Cell key={e.etapa} fill={CORES[i % CORES.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>

        <Cartao titulo="Valor ganho por mês">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porMes} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => brlCurto(Number(v) * 100)}
                  width={70}
                />
                <Tooltip contentStyle={dicaEstilo} formatter={(v) => brl(Number(v) * 100)} />
                <Bar dataKey="valor" name="Valor ganho" fill={VERDE} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Resultado por supervisor">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dados.por_supervisor}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="nome"
                  width={120}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip contentStyle={dicaEstilo} cursor={{ fill: "rgba(22,63,91,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="abertos" name="Em aberto" stackId="s" fill={AZUL} />
                <Bar dataKey="ganhos" name="Ganhos" stackId="s" fill={VERDE} />
                <Bar
                  dataKey="perdidos"
                  name="Perdidos"
                  stackId="s"
                  fill={VERMELHO}
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>

        <Cartao titulo="Top 10 parceiros por valor ganho">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={parceiros}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => brlCurto(Number(v) * 100)}
                />
                <YAxis
                  type="category"
                  dataKey="curto"
                  width={160}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={dicaEstilo}
                  formatter={(v) => brl(Number(v) * 100)}
                  labelFormatter={(_, p) => p?.[0]?.payload?.nome ?? ""}
                />
                <Bar dataKey="valor" name="Valor ganho" fill={MARINHO} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao titulo="Negócios por estado" className="lg:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.por_uf} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="uf"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={dicaEstilo} cursor={{ fill: "rgba(22,63,91,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="qtd" name="Negócios" fill={AZUL} radius={[6, 6, 0, 0]} />
                <Bar dataKey="ganhos" name="Ganhos" fill={VERDE} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Cartao>

        <Cartao titulo="Por categoria e funil">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dados.por_categoria}
                  dataKey="qtd"
                  nameKey="nome"
                  innerRadius="35%"
                  outerRadius="60%"
                >
                  {dados.por_categoria.map((c, i) => (
                    <Cell key={c.nome} fill={CORES[(i + 1) % CORES.length]} />
                  ))}
                </Pie>
                <Pie
                  data={dados.por_funil}
                  dataKey="qtd"
                  nameKey="nome"
                  innerRadius="68%"
                  outerRadius="88%"
                  paddingAngle={1}
                >
                  {dados.por_funil.map((f, i) => (
                    <Cell key={f.nome} fill={CORES[(i + 6) % CORES.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={dicaEstilo} formatter={(v) => num(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Cartao>
      </div>
    </div>
  );
}
