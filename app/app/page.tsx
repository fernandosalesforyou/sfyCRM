import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { homeDaInterface } from "@/lib/navigation/interface";
import { emPreparacao, telasLiberadas } from "@/lib/sfy/preparacao";
export default async function AppHome() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const inicio = homeDaInterface(
    org?.interface_settings,
    user.is_platform_admin && !user.support,
    org?.role ?? null,
  );
  // sfy — no primeiro acesso, ninguém deve cair numa tela em preparação.
  const liberadas = user.is_platform_admin ? null : telasLiberadas(process.env.SFY_TELAS_LIBERADAS);
  redirect(liberadas && emPreparacao(inicio, liberadas) ? liberadas[0]! : inicio);
}
