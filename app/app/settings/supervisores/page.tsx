import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PainelDeParceiros } from "../parceiros/_painel";

export const metadata = { title: "Supervisores" };
export const dynamic = "force-dynamic";

/** sfy (Climabrisa): supervisores em aba própria do menu (grupo Interno). Todos veem; só admin edita. */
export default async function SupervisoresPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Supervisores")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("Os supervisores da Climabrisa e do Agro, e a quem cada parceiro responde.")}
        </p>
      </header>
      <PainelDeParceiros
        podeEditar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin}
        mostrar="supervisores"
      />
    </div>
  );
}
