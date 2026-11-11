-- manifest: sfy (fork Sales for You, Bloco A2/A3): duas regras opt-in por organização em `organizations.settings.sfy` — `exclusao_so_admin` (só o admin apaga negócio e contato: gatilho BEFORE DELETE em `crm_leads` e `contacts` que LANÇA e desfaz a transação inteira, inclusive o histórico que `fn_apagar_contato_com_historico` apaga antes da ficha) e `valor_do_ganho_so_admin` (gatilho BEFORE UPDATE em `crm_leads`: negócio ganho só tem `value_cents`/`currency` alterados ou é reaberto pelo admin; escrita sem usuário — service role, automações, integrações — passa). Ausentes = comportamento do original.

-- 5001 — exclusão e valor do ganho só pelo admin (opt-in por organização).
--
-- Leitura das chaves: `organizations.settings -> 'sfy' ->> '<chave>'`, booleano;
-- qualquer outro valor conta como desligado.

create or replace function public.fn_sfy_regra_ligada(p_org uuid, p_chave text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select (o.settings -> 'sfy' ->> p_chave) = 'true'
       from public.organizations o where o.id = p_org),
    false);
$$;

revoke all on function public.fn_sfy_regra_ligada(uuid, text) from public;
revoke execute on function public.fn_sfy_regra_ligada(uuid, text) from anon;
grant execute on function public.fn_sfy_regra_ligada(uuid, text) to authenticated, service_role;

-- Quem pode APAGAR nesta organização, pela régua sfy: regra desligada = todos
-- os que as policies do original já deixam; ligada = só admin (e o super-admin
-- de plataforma com escopo total).
create or replace function public.fn_sfy_pode_excluir(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.fn_is_platform_admin_full()
      or not public.fn_sfy_regra_ligada(p_org, 'exclusao_so_admin')
      or public.fn_role_at_least(p_org, 'admin');
$$;

revoke all on function public.fn_sfy_pode_excluir(uuid) from public;
revoke execute on function public.fn_sfy_pode_excluir(uuid) from anon;
grant execute on function public.fn_sfy_pode_excluir(uuid) to authenticated, service_role;

-- A trava é um GATILHO que LANÇA, e não uma policy restritiva: apagar contato
-- passa por `fn_apagar_contato_com_historico`, que apaga mensagens e conversas
-- ANTES da ficha. Uma policy só faria a ficha "sumir da vista" do DELETE (0
-- linhas, sem erro) e o histórico já teria ido embora na mesma transação. O
-- erro desfaz a transação inteira. Escrita sem usuário (service role: LGPD,
-- workers) não é barrada.
create or replace function public.fn_sfy_guarda_exclusao()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if public.fn_sfy_pode_excluir(old.organization_id) then
    return old;
  end if;
  raise exception 'sfy_delete_admin_only'
    using errcode = '42501',
          hint = 'Só o administrador apaga negócios e contatos.';
end;
$$;

revoke all on function public.fn_sfy_guarda_exclusao() from public;
revoke execute on function public.fn_sfy_guarda_exclusao() from anon;
grant execute on function public.fn_sfy_guarda_exclusao() to authenticated, service_role;

drop policy if exists "sfy_crm_leads_delete_so_admin" on public.crm_leads;
drop trigger if exists trg_sfy_guarda_exclusao on public.crm_leads;
create trigger trg_sfy_guarda_exclusao
  before delete on public.crm_leads
  for each row execute function public.fn_sfy_guarda_exclusao();

drop policy if exists "sfy_contacts_delete_so_admin" on public.contacts;
drop trigger if exists trg_sfy_guarda_exclusao on public.contacts;
create trigger trg_sfy_guarda_exclusao
  before delete on public.contacts
  for each row execute function public.fn_sfy_guarda_exclusao();

-- O valor do GANHO e a reabertura do ganho. Roda depois de
-- `trg_crm_lead_close_on_stage` (ordem alfabética dos BEFORE: "zz"), então já
-- vê o `status` que a mudança de etapa produziu.
create or replace function public.fn_sfy_guarda_valor_do_ganho()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.status is distinct from 'won' then
    return new;
  end if;
  if new.value_cents is not distinct from old.value_cents
     and new.currency is not distinct from old.currency
     and new.status = 'won' then
    return new;
  end if;
  -- Escrita sem usuário (service role: automações, workers, integrações).
  if auth.uid() is null then
    return new;
  end if;
  if not public.fn_sfy_regra_ligada(old.organization_id, 'valor_do_ganho_so_admin') then
    return new;
  end if;
  if public.fn_is_platform_admin_full() or public.fn_role_at_least(old.organization_id, 'admin') then
    return new;
  end if;
  raise exception 'sfy_won_value_admin_only'
    using errcode = '42501',
          hint = 'Só o administrador altera o valor ou reabre um negócio ganho.';
end;
$$;

revoke all on function public.fn_sfy_guarda_valor_do_ganho() from public;
revoke execute on function public.fn_sfy_guarda_valor_do_ganho() from anon;
grant execute on function public.fn_sfy_guarda_valor_do_ganho() to authenticated, service_role;

drop trigger if exists trg_zz_sfy_guarda_valor_do_ganho on public.crm_leads;
create trigger trg_zz_sfy_guarda_valor_do_ganho
  before update on public.crm_leads
  for each row execute function public.fn_sfy_guarda_valor_do_ganho();

notify pgrst, 'reload schema';
