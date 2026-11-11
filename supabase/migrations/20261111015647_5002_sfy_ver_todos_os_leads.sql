-- manifest: sfy (fork Sales for You, Bloco A1): permissão por membro "ver todos os leads", sem 5º papel. Tabela nova `sfy_permissoes_do_membro` (organização + usuário; leitura pelos membros, escrita só pelo servidor) e um ramo a mais em `fn_can_view_lead` e `fn_can_view_conversation`: o ATENDENTE (agent) com a permissão vê os negócios e as conversas da organização inteira, qualquer que seja o `visibility_mode`. Corpo igual ao da 9090 + esse ramo. Sem linha na tabela = comportamento do original.

-- 5002 — "ver todos os leads" por membro (Bloco A1).

create table if not exists public.sfy_permissoes_do_membro (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ver_todos_os_leads boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, user_id)
);

comment on table public.sfy_permissoes_do_membro is
  'sfy (fork Sales for You, migration 5002): permissões extras por membro, sem papel novo. ver_todos_os_leads = o atendente enxerga negócios e conversas da organização inteira. Escrita só pelo servidor (rota admin).';

alter table public.sfy_permissoes_do_membro enable row level security;

revoke all on public.sfy_permissoes_do_membro from anon;
revoke all on public.sfy_permissoes_do_membro from authenticated;
grant select on public.sfy_permissoes_do_membro to authenticated;
grant select, insert, update, delete on public.sfy_permissoes_do_membro to service_role;

drop policy if exists tenant_isolation_sfy_permissoes_do_membro_select on public.sfy_permissoes_do_membro;
create policy tenant_isolation_sfy_permissoes_do_membro_select on public.sfy_permissoes_do_membro
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

-- O chamador tem a permissão nesta organização? (lida pelos dois helpers abaixo)
create or replace function public.fn_sfy_ve_todos_os_leads(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sfy_permissoes_do_membro p
     where p.organization_id = p_org
       and p.user_id = auth.uid()
       and p.ver_todos_os_leads
  );
$$;

revoke all on function public.fn_sfy_ve_todos_os_leads(uuid) from public;
revoke execute on function public.fn_sfy_ve_todos_os_leads(uuid) from anon;
grant execute on function public.fn_sfy_ve_todos_os_leads(uuid) to authenticated, service_role;

-- Corpo da 9090 + o ramo sfy (marcado). Ao trazer atualização do original que
-- redefina estas funções, reaplicar o ramo: o invariante
-- tests/invariants/sfy-ver-todos-os-leads.test.ts reprova se ele sumir.
create or replace function public.fn_can_view_lead(
  p_org uuid,
  p_owner_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.fn_is_platform_admin() then true
    else (
      with actor as materialized (
        select public.fn_user_role_in_org(p_org) as role
      )
      select case
        when actor.role is null then false
        when actor.role in ('viewer','manager','admin') then true
        when p_owner_user_id = auth.uid() then true
        -- sfy (5002): atendente com "ver todos os leads"
        when public.fn_sfy_ve_todos_os_leads(p_org) then true
        else case coalesce(
               (select settings->>'visibility_mode' from public.organizations where id = p_org),
               'own_and_unassigned')
             when 'all' then true
             when 'own_and_unassigned' then p_owner_user_id is null
             else false
           end
      end
      from actor
    )
  end;
$$;

create or replace function public.fn_can_view_conversation(
  p_org uuid,
  p_assigned_to_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.fn_is_platform_admin() then true
    else (
      with actor as materialized (
        select public.fn_user_role_in_org(p_org) as role
      )
      select case
        when actor.role is null then false
        when actor.role in ('viewer','manager','admin') then true
        when p_assigned_to_user_id = auth.uid() then true
        -- sfy (5002): atendente com "ver todos os leads"
        when public.fn_sfy_ve_todos_os_leads(p_org) then true
        else case coalesce(
               (select settings->>'visibility_mode' from public.organizations where id = p_org),
               'own_and_unassigned')
             when 'all' then true
             when 'own_and_unassigned' then p_assigned_to_user_id is null
             else false
           end
      end
      from actor
    )
  end;
$$;

-- A RLS de `conversations` (policy conversations_select) lê o escopo por esta
-- função, não por fn_can_view_conversation: o ramo sfy entra em org_wide_read.
-- Corpo igual ao do original + o ramo (marcado).
create or replace function public.fn_conversation_scope()
returns table (organization_id uuid, org_wide_read boolean, sees_unassigned boolean)
language sql stable security definer
set search_path = public
as $$
  select o.organization_id,
         public.fn_user_role_in_org(o.organization_id) in ('viewer','manager','admin')
           or coalesce((select z.settings->>'visibility_mode' from public.organizations z
                        where z.id = o.organization_id), 'own_and_unassigned') = 'all'
           -- sfy (5002): atendente com "ver todos os leads"
           or public.fn_sfy_ve_todos_os_leads(o.organization_id),
         coalesce((select z.settings->>'visibility_mode' from public.organizations z
                   where z.id = o.organization_id), 'own_and_unassigned') = 'own_and_unassigned'
  from public.fn_user_org_ids() as o(organization_id);
$$;

revoke all on function public.fn_conversation_scope() from public, anon;
grant execute on function public.fn_conversation_scope() to authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_can_view_lead(uuid,uuid), public.fn_can_view_conversation(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_view_lead(uuid,uuid), public.fn_can_view_conversation(uuid,uuid) TO authenticated, service_role;

-- As travas do suporte alcançam a tabela nova.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
