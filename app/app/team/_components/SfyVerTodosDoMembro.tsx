"use client";
/**
 * sfy (fork Sales for You, Bloco A1) — chave "Vê todos os leads" do atendente,
 * na tabela de membros. Só aparece para Atendente: gerente, leitor e admin já
 * veem tudo pela regra do original. Quem aplica é o banco (migration 5002).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

const CHAVE = ["sfy", "permissoes-do-membro"] as const;
const ROTA = "/api/v1/sfy/permissoes-do-membro";

interface Permissao {
  user_id: string;
  ver_todos_os_leads: boolean;
}

export function useSfyPermissoesDoMembro(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVE,
    enabled: habilitado,
    queryFn: async () => (await apiClient.get<{ data: Permissao[] }>(ROTA)).data,
  });
}

export function SfyVerTodosDoMembro({
  userId,
  rotulo,
  podeEditar,
}: {
  userId: string;
  rotulo: string;
  podeEditar: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useSfyPermissoesDoMembro(true);
  const ligado = data?.some((p) => p.user_id === userId && p.ver_todos_os_leads) ?? false;

  const mudar = useMutation({
    mutationFn: (ver_todos_os_leads: boolean) =>
      apiClient.put(ROTA, { user_id: userId, ver_todos_os_leads }),
    onSuccess: () => {
      toast.success(t("Permissão atualizada."));
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: showApiError,
  });

  if (!podeEditar) {
    return ligado ? <div className="mt-1 text-xs text-muted-foreground">{t("Vê todos os leads")}</div> : null;
  }

  return (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={ligado}
        disabled={mudar.isPending || data === undefined}
        aria-label={`${t("Vê todos os leads")}: ${rotulo}`}
        onChange={(e) => mudar.mutate(e.target.checked)}
      />
      {t("Vê todos os leads")}
    </label>
  );
}
