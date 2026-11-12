-- manifest: sfy (fork Sales for You, Bloco B1/B2): duas regras opt-in por organização em `organizations.settings.sfy` — `origem_protegida` (gatilho BEFORE UPDATE em `contacts` e `crm_leads`: só o admin altera `source`/`source_metadata`; quem não é admin só mexe na origem de registro cuja origem é "manual"/"sem_identificacao" e só para outro desses dois valores; escrita sem usuário — service role, webhooks, ingestão de anúncio — passa) e `origem_manual_sem_identificacao` (gatilho BEFORE INSERT: cadastro manual com source='manual' passa a gravar 'sem_identificacao'). Ausentes = comportamento do original.

-- 5004 — origem protegida contra edição manual e cadastro manual "sem identificação".

create or replace function public.fn_sfy_guarda_origem()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.source is not distinct from old.source
     and new.source_metadata is not distinct from old.source_metadata then
    return new;
  end if;
  -- Escrita sem usuário (service role: ingestão de anúncio, webhooks, workers).
  if auth.uid() is null then
    return new;
  end if;
  if not public.fn_sfy_regra_ligada(old.organization_id, 'origem_protegida') then
    return new;
  end if;
  if public.fn_is_platform_admin_full() or public.fn_role_at_least(old.organization_id, 'admin') then
    return new;
  end if;
  -- Quem não é admin só reclassifica origem de cadastro manual, e só dentro
  -- do mundo manual: nunca apaga nem forja origem de anúncio, site ou webhook.
  if coalesce(old.source, 'manual') in ('manual', 'sem_identificacao')
     and coalesce(new.source, 'manual') in ('manual', 'sem_identificacao') then
    return new;
  end if;
  raise exception 'sfy_origin_admin_only'
    using errcode = '42501',
          hint = 'Só o administrador altera a origem de um contato ou negócio que veio de anúncio, site ou integração.';
end;
$$;

revoke all on function public.fn_sfy_guarda_origem() from public, anon, authenticated;
grant execute on function public.fn_sfy_guarda_origem() to service_role;

drop trigger if exists trg_sfy_guarda_origem on public.contacts;
create trigger trg_sfy_guarda_origem
  before update on public.contacts
  for each row execute function public.fn_sfy_guarda_origem();

drop trigger if exists trg_sfy_guarda_origem on public.crm_leads;
create trigger trg_sfy_guarda_origem
  before update on public.crm_leads
  for each row execute function public.fn_sfy_guarda_origem();

create or replace function public.fn_sfy_origem_manual_sem_identificacao()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.source = 'manual'
     and public.fn_sfy_regra_ligada(new.organization_id, 'origem_manual_sem_identificacao') then
    new.source := 'sem_identificacao';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_sfy_origem_manual_sem_identificacao() from public, anon, authenticated;
grant execute on function public.fn_sfy_origem_manual_sem_identificacao() to service_role;

drop trigger if exists trg_sfy_origem_manual on public.contacts;
create trigger trg_sfy_origem_manual
  before insert on public.contacts
  for each row execute function public.fn_sfy_origem_manual_sem_identificacao();

drop trigger if exists trg_sfy_origem_manual on public.crm_leads;
create trigger trg_sfy_origem_manual
  before insert on public.crm_leads
  for each row execute function public.fn_sfy_origem_manual_sem_identificacao();

notify pgrst, 'reload schema';
