"use client";
/**
 * sfy (fork Sales for You, Bloco A) — cartão das regras da organização em
 * Configurações › Organização. A trava real mora no banco (migration 5001);
 * este cartão só liga e desliga.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { atualizarRegrasSfy } from "@/app/actions/settings/sfyRegrasDaOrganizacao";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { irAoDesafioDeMfa } from "@/lib/auth/ir-ao-desafio-de-mfa";

interface Props {
  /** Só as duas chaves: o resto de `settings` não vai para o navegador. */
  exclusaoSoAdmin: boolean;
  valorDoGanhoSoAdmin: boolean;
  origemProtegida: boolean;
  origemManualSemIdentificacao: boolean;
}

export function RegrasSfyDaOrganizacaoForm({
  exclusaoSoAdmin,
  valorDoGanhoSoAdmin,
  origemProtegida,
  origemManualSemIdentificacao,
}: Props) {
  const t = useT();
  const [exclusao, setExclusao] = useState(exclusaoSoAdmin);
  const [ganho, setGanho] = useState(valorDoGanhoSoAdmin);
  const [origem, setOrigem] = useState(origemProtegida);
  const [semId, setSemId] = useState(origemManualSemIdentificacao);
  const [isPending, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const r = await atualizarRegrasSfy({ exclusao_so_admin: exclusao, valor_do_ganho_so_admin: ganho,
        origem_protegida: origem,
        origem_manual_sem_identificacao: semId,
      });
      if (r.ok) {
        toast.success(t("Regras de proteção salvas."));
        return;
      }
      if (r.error === "mfa_required") return irAoDesafioDeMfa();
      toast.error(t("Não foi possível salvar as regras de proteção."));
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">{t("Regras de proteção")}</h2>
      <p className="text-xs text-muted-foreground">
        {t("Valem para a empresa inteira. Quem é administrador continua podendo tudo.")}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={exclusao} onChange={(e) => setExclusao(e.target.checked)} />
        <span>{t("Só o administrador exclui negócios e contatos")}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={ganho} onChange={(e) => setGanho(e.target.checked)} />
        <span>{t("Só o administrador altera o valor ou reabre um negócio ganho")}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={origem} onChange={(e) => setOrigem(e.target.checked)} />
        <span>{t("Só o administrador altera a origem de contatos e negócios vindos de anúncio, site ou integração")}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={semId} onChange={(e) => setSemId(e.target.checked)} />
        <span>{t("Cadastro manual entra com a origem \"Sem identificação\"")}</span>
      </label>
      <Button type="button" size="sm" disabled={isPending} onClick={salvar}>
        {t("Aplicar regras de proteção")}
      </Button>
    </Card>
  );
}
