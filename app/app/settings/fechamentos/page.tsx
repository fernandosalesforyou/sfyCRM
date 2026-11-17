/**
 * sfy (fork Sales for You, Bloco D) — Configurações → Fechamentos informados.
 *
 * Os pedidos de fechamento que os parceiros enviam pelo link. Gerente vê; só administrador
 * marca como tratado ou recusado (a rota confere de novo). Tratar = conferir e concluir o
 * negócio pelas regras de sempre; esta tela não muda o negócio.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PainelDeFechamentos } from "./_painel";

export const metadata = { title: "Fechamentos informados" };
export const dynamic = "force-dynamic";

export default async function FechamentosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Fechamentos informados")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Pedidos que os parceiros enviam pelo link do relatório semanal. Abra o negócio, confira o valor e a nota, conclua pelas regras de sempre e depois marque o pedido como tratado.",
          )}
        </p>
      </header>
      <PainelDeFechamentos podeTratar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin} />
    </div>
  );
}
