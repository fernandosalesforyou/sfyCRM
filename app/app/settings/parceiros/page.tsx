/**
 * sfy (fork Sales for You, Bloco C) — Configurações → Parceiros e supervisores.
 *
 * Onde a empresa confere para quem o CRM encaminha cada cliente: o contato de cada parceiro
 * e supervisor, a quem cada parceiro responde e quem está fora do rodízio. Gerente vê; só
 * administrador edita (a rota confere de novo). A carga inicial vem do mapa, por script.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PainelDeParceiros } from "./_painel";

export const metadata = { title: "Parceiros e supervisores" };
export const dynamic = "force-dynamic";

export default async function ParceirosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Parceiros e supervisores")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Para quem o CRM encaminha cada cliente. Parceiro sem WhatsApp e sem e-mail fica fora do rodízio até ter um contato. Desmarcar \"Ativo\" tira o parceiro do rodízio sem apagar o cadastro.",
          )}
        </p>
      </header>
      <PainelDeParceiros podeEditar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin} />
    </div>
  );
}
