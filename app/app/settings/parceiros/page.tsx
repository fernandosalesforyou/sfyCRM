/**
 * sfy (fork Sales for You, Bloco C) — Configurações → Parceiros e supervisores.
 *
 * Onde a empresa confere para quem o CRM encaminha cada cliente: o contato de cada parceiro
 * e supervisor, a quem cada parceiro responde e quem está fora do rodízio. Gerente vê; só
 * administrador edita (a rota confere de novo). A carga inicial vem da planilha conferida pela cliente.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PainelDeParceiros } from "./_painel";

export const metadata = { title: "Parceiros" };
export const dynamic = "force-dynamic";

export default async function ParceirosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Parceiros")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            'Os parceiros do CRM são a lista oficial. Só quem está "Certificado, recebe leads" entra no rodízio; nos outros casos o lead da região vai para o supervisor. Parceiro sem WhatsApp e sem e-mail também fica fora até ter um contato.',
          )}
        </p>
      </header>
      <PainelDeParceiros podeEditar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin} />
    </div>
  );
}
