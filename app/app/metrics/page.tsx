import type { Metadata } from "next";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";

import { MetricsClient } from "./_components/MetricsClient";
import { PainelComercial, type DadosDoPainel } from "./_components/PainelComercial";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Data de início do período do painel (null = tudo). */
function inicioDoPeriodo(periodo: string): string | null {
  if (periodo === "tudo") return null;
  return new Date(Date.now() - Number(periodo) * 86_400_000).toISOString().slice(0, 10);
}
export const metadata: Metadata = { title: "Desempenho" };

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo: bruto } = await searchParams;
  const periodo = bruto === "90" || bruto === "tudo" ? bruto : "365";
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // spec 13 §6.1: agent vê as próprias (RLS); a comparação por atendente é manager+.
  const canCompare = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma` (a cadeia pessoa → organização →
  // padrão vive em `lib/auth/server.ts`), sem reler o `locale` cru.
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  // sfy (Climabrisa): painel comercial agregado no banco (gerente ou acima).
  let painel: DadosDoPainel | null = null;
  if (activeOrg && canCompare) {
    const desde = inicioDoPeriodo(periodo);
    const supabase = await createClient();
    const { data } = await supabase.rpc(
      "fn_sfy_painel_comercial" as never,
      { p_org: activeOrg.orgId, p_desde: desde } as never,
    );
    painel = (data as DadosDoPainel | null) ?? null;
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Desempenho")}</h1>
        <p className="text-sm text-muted-foreground">
          {painel
            ? t("Indicadores comerciais da Climabrisa e o atendimento pelo WhatsApp.")
            : canCompare
              ? t("Atrito, funil e performance por atendente nos últimos 30 dias.")
              : t("Atrito, seu funil e sua performance nos últimos 30 dias.")}
        </p>
      </header>

      {painel && <PainelComercial dados={painel} periodo={periodo} />}

      {painel ? (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("Ver detalhes do atendimento pelo WhatsApp")}
          </summary>
          <div className="mt-4">
            <MetricsClient canCompare={canCompare} currentUserId={user.id} />
          </div>
        </details>
      ) : (
        <MetricsClient canCompare={canCompare} currentUserId={user.id} />
      )}
    </div>
  );
}
