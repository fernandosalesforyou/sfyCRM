"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { emPreparacao } from "@/lib/sfy/preparacao";
import { Hourglass } from "@/lib/ui/icons";

/** sfy — no lugar da tela que ainda não está pronta, só o aviso: nada dela é montado. */
export function PortaoDePreparacao({
  liberadas,
  children,
}: {
  liberadas: readonly string[];
  children: ReactNode;
}) {
  const t = useT();
  const caminho = usePathname() ?? "";
  if (!emPreparacao(caminho, liberadas)) return <>{children}</>;

  const prontas = NAV_CATALOG.filter((destino) => liberadas.includes(destino.href));
  return (
    <div className="mx-auto flex max-w-xl flex-col py-10">
      <Card className="flex flex-col items-center gap-4 p-8 text-center" data-testid="em-preparacao">
        <Hourglass size={40} aria-hidden className="text-primary" />
        <h1 className="text-xl font-semibold">{t("Esta área ainda está em preparação")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Estamos configurando esta parte do sistema para a sua empresa. Ela será liberada assim que estiver pronta.",
          )}
        </p>
        {prontas.length > 0 && (
          <>
            <p className="text-sm font-medium">{t("O que você já pode ver:")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {prontas.map((destino) => (
                <Button key={destino.href} asChild variant="outline">
                  <Link href={destino.href}>{t(destino.label)}</Link>
                </Button>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
