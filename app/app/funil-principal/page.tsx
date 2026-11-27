import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * sfy (Climabrisa): atalho do menu lateral para o funil principal — o marcado como padrão
 * (`is_default`); sem padrão, o primeiro da lista. Sem funil, cai na lista de funis.
 */
export default async function FunilPrincipalPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    .select("id, is_default")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("is_default", { ascending: false })
    .order("position")
    .limit(1);

  const funil = data?.[0];
  redirect(funil ? `/app/pipelines/${funil.id}` : "/app/kanban");
}
