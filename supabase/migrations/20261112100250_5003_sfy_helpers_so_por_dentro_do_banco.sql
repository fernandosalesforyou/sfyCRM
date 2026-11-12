-- manifest: sfy (fork Sales for You, Bloco A, forward-fix de 5001/5002): as cinco funções sfy (`fn_sfy_regra_ligada`, `fn_sfy_pode_excluir`, `fn_sfy_ve_todos_os_leads`, `fn_sfy_guarda_exclusao`, `fn_sfy_guarda_valor_do_ganho`) deixam de ser executáveis por `authenticated`: só são chamadas por dentro de outras SECURITY DEFINER e por gatilhos, que não precisam do EXECUTE de quem chama. `fn_sfy_ve_todos_os_leads` passa a conferir o pertencimento (`fn_user_org_ids`), e a tabela `sfy_permissoes_do_membro` fica declarada na varredura de RLS pela prova de 5002. Medido pelo ci do fork: definer-membership, hardening-definer e rls-completude.

-- 5003 — as funções sfy só por dentro do banco.

create or replace function public.fn_sfy_ve_todos_os_leads(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_org in (select public.fn_user_org_ids())
     and exists (
       select 1 from public.sfy_permissoes_do_membro p
        where p.organization_id = p_org
          and p.user_id = auth.uid()
          and p.ver_todos_os_leads
     );
$$;

revoke all on function public.fn_sfy_regra_ligada(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_sfy_regra_ligada(uuid, text) to service_role;

revoke all on function public.fn_sfy_pode_excluir(uuid) from public, anon, authenticated;
grant execute on function public.fn_sfy_pode_excluir(uuid) to service_role;

revoke all on function public.fn_sfy_ve_todos_os_leads(uuid) from public, anon, authenticated;
grant execute on function public.fn_sfy_ve_todos_os_leads(uuid) to service_role;

revoke all on function public.fn_sfy_guarda_exclusao() from public, anon, authenticated;
grant execute on function public.fn_sfy_guarda_exclusao() to service_role;

revoke all on function public.fn_sfy_guarda_valor_do_ganho() from public, anon, authenticated;
grant execute on function public.fn_sfy_guarda_valor_do_ganho() to service_role;

notify pgrst, 'reload schema';
