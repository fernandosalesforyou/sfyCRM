/**
 * sfy (Climabrisa, Bloco D): página do link de fechamento do parceiro (sem login).
 *
 * Mostra os negócios ABERTOS do parceiro (nome curto, cidade e data — nunca telefone nem e-mail)
 * e deixa informar valor e nota de um fechamento. Quem trata o pedido é o administrador no CRM;
 * nada aqui muda o negócio. Link inexistente, expirado ou revogado dá a mesma página 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { acharLinkValido, negociosDoParceiro } from "@/lib/sfy/fechamento";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> };

const campo =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-hidden";

export default async function PaginaDeFechamento({ params, searchParams }: Props) {
  const { token } = await params;
  const { r } = await searchParams;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);
  const admin = createAdminClient();
  const alvo = await acharLinkValido(admin, token);
  if (!alvo) notFound();
  const negocios = await negociosDoParceiro(admin, alvo.parceiro);

  const aviso: Record<string, string> = {
    ok: t("Recebemos a informação. A Climabrisa vai conferir e confirmar com você."),
    valor_invalido: t("O valor não parece certo. Use só números, por exemplo 1500,00."),
    nota_invalida: t("Informe o número da nota fiscal."),
    ja_informado: t("Este negócio já tem um fechamento informado, aguardando conferência."),
    negocio_nao_e_seu: t("Não foi possível registrar este negócio."),
    erro: t("Não foi possível registrar agora. Tente de novo em alguns minutos."),
  };

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-4">
        <header>
          <p className="text-sm font-medium text-neutral-500">Climabrisa</p>
          <h1 className="text-2xl font-semibold text-neutral-900">{t("Informar um fechamento")}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {t("Parceiro")}: {alvo.parceiro.nome}. {t("Marque abaixo o negócio que você fechou, com o valor e a nota fiscal.")}
          </p>
        </header>

        {r && aviso[r] ? (
          <p role="status" className={`rounded-md px-3 py-2 text-sm ${r === "ok" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>
            {aviso[r]}
          </p>
        ) : null}

        {negocios.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-sm text-neutral-700 shadow-sm">{t("Você não tem negócios em aberto no momento.")}</p>
        ) : (
          negocios.map((n) => (
            <section key={n.id} className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-medium text-neutral-900">{n.nome}</h2>
              <p className="text-sm text-neutral-600">
                {[n.cidade, n.uf].filter(Boolean).join("/")}
                {n.cidade || n.uf ? " · " : ""}
                {t("recebido em")} {new Date(n.recebido_em).toLocaleDateString("pt-BR")}
              </p>
              {n.ja_informado ? (
                <p className="mt-3 text-sm text-neutral-700">{t("Fechamento informado, aguardando conferência.")}</p>
              ) : (
                <details className="mt-3">
                  <summary className="cursor-pointer rounded-md bg-neutral-900 px-4 py-3 text-center text-base font-medium text-white">
                    {t("Fechei este negócio")}
                  </summary>
                  <form action={`/api/v1/sfy/fechamento/${token}`} method="POST" className="mt-4 space-y-3">
                    <input type="hidden" name="lead_id" value={n.id} />
                    <div>
                      <label htmlFor={`v-${n.id}`} className="block text-sm font-medium text-neutral-800">
                        {t("Valor fechado (R$)")} <span aria-hidden>*</span>
                      </label>
                      <input id={`v-${n.id}`} name="valor" type="text" inputMode="decimal" required className={campo} />
                    </div>
                    <div>
                      <label htmlFor={`n-${n.id}`} className="block text-sm font-medium text-neutral-800">
                        {t("Número da nota fiscal")} <span aria-hidden>*</span>
                      </label>
                      <input id={`n-${n.id}`} name="nota_fiscal" type="text" maxLength={60} required className={campo} />
                    </div>
                    <div>
                      <label htmlFor={`o-${n.id}`} className="block text-sm font-medium text-neutral-800">
                        {t("Observação")}
                      </label>
                      <input id={`o-${n.id}`} name="observacao" type="text" maxLength={500} className={campo} />
                    </div>
                    <button type="submit" className="w-full rounded-md bg-neutral-900 px-4 py-3 text-base font-medium text-white hover:bg-neutral-700">
                      {t("Enviar")}
                    </button>
                  </form>
                </details>
              )}
            </section>
          ))
        )}
        <p className="pb-6 text-center text-xs text-neutral-500">{t("Este link é pessoal e vale por alguns dias. Não compartilhe.")}</p>
      </div>
    </main>
  );
}
