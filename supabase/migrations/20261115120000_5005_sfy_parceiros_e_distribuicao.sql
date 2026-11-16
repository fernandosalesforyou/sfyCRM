-- manifest: sfy (fork Sales for You, Bloco C): tabelas de parceiros e supervisores (`sfy_supervisores`, `sfy_parceiros`, `sfy_parceiro_cidades`, `sfy_cidade_supervisor`; leitura pelos membros da organização, escrita só pelo servidor) e a função `fn_sfy_escolher_destino`, que decide para quem vai um negócio: Agro por UF; Climabrisa pelo parceiro da cidade (um ou rodízio) ou, sem parceiro, pelo supervisor da cidade. Busca EXATA por cidade normalizada e UF, sem semelhança. Sem linhas nas tabelas = nada muda no original.

-- 5005 — parceiros, supervisores e escolha do destino do negócio (Bloco C).

create table if not exists public.sfy_supervisores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) > 0),
  categoria text not null check (categoria in ('climabrisa', 'agro')),
  whatsapp text,
  email text,
  user_id uuid references auth.users(id) on delete set null,
  ufs text[] not null default '{}',
  padrao boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sfy_supervisores is
  'sfy (fork Sales for You, migration 5005): supervisores. Agro: ufs = estados atendidos; padrao = atende os demais estados. user_id = usuário do CRM (dono do negócio), preenchido na entrega.';

create table if not exists public.sfy_parceiros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (length(btrim(codigo)) > 0),
  nome text not null check (length(btrim(nome)) > 0),
  categoria text not null default 'climabrisa' check (categoria in ('climabrisa', 'agro')),
  whatsapp text,
  email text,
  supervisor_id uuid references public.sfy_supervisores(id) on delete set null,
  ativo boolean not null default true,
  ultimo_recebimento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo)
);

comment on table public.sfy_parceiros is
  'sfy (fork Sales for You, migration 5005): parceiros (representantes). Sem login. ultimo_recebimento_em alimenta o rodízio.';

create table if not exists public.sfy_parceiro_cidades (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parceiro_id uuid not null references public.sfy_parceiros(id) on delete cascade,
  cidade_norm text not null check (cidade_norm = lower(cidade_norm) and length(cidade_norm) > 0),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  primary key (parceiro_id, cidade_norm, uf)
);

create index if not exists sfy_parceiro_cidades_busca
  on public.sfy_parceiro_cidades (organization_id, uf, cidade_norm);

comment on table public.sfy_parceiro_cidades is
  'sfy (fork Sales for You, migration 5005): cidades atendidas por parceiro (nome sem acento, minúsculo). Busca exata.';

create table if not exists public.sfy_cidade_supervisor (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cidade_norm text not null check (cidade_norm = lower(cidade_norm) and length(cidade_norm) > 0),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  supervisor_id uuid not null references public.sfy_supervisores(id) on delete cascade,
  primary key (organization_id, cidade_norm, uf)
);

comment on table public.sfy_cidade_supervisor is
  'sfy (fork Sales for You, migration 5005): supervisor das cidades SEM parceiro (o do parceiro mais próximo). Gerada por script a partir do mapa, conferida pela cliente.';

do $$
declare t text;
begin
  foreach t in array array['sfy_supervisores', 'sfy_parceiros', 'sfy_parceiro_cidades', 'sfy_cidade_supervisor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('drop policy if exists tenant_isolation_%I_select on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%I_select on public.%I for select to authenticated using (organization_id in (select public.fn_user_org_ids()))',
      t, t);
  end loop;
end $$;

-- Grants literais (a régua do baseline lê o texto, não o laço acima).
grant select on public.sfy_supervisores to authenticated;
grant select, insert, update, delete on public.sfy_supervisores to service_role;
grant select on public.sfy_parceiros to authenticated;
grant select, insert, update, delete on public.sfy_parceiros to service_role;
grant select on public.sfy_parceiro_cidades to authenticated;
grant select, insert, update, delete on public.sfy_parceiro_cidades to service_role;
grant select on public.sfy_cidade_supervisor to authenticated;
grant select, insert, update, delete on public.sfy_cidade_supervisor to service_role;

-- Nome de cidade sem acento, minúsculo, espaços únicos.
create or replace function public.fn_sfy_normaliza_cidade(p_texto text)
returns text
language sql stable
set search_path = public
as $$
  select lower(btrim(regexp_replace(coalesce(public.f_unaccent(p_texto), ''), '\s+', ' ', 'g')));
$$;

revoke all on function public.fn_sfy_normaliza_cidade(text) from public, anon, authenticated;
grant execute on function public.fn_sfy_normaliza_cidade(text) to service_role;

-- Para quem vai o negócio. Devolve jsonb; avança o rodízio quando escolhe parceiro.
-- motivo: agro_por_uf | parceiro_unico | rodizio | supervisor_da_cidade | sem_destino
create or replace function public.fn_sfy_escolher_destino(
  p_org uuid,
  p_categoria text,
  p_cidade text,
  p_uf text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_cidade text := public.fn_sfy_normaliza_cidade(p_cidade);
  v_uf text := upper(btrim(coalesce(p_uf, '')));
  v_cat text := lower(btrim(coalesce(p_categoria, '')));
  v_sup public.sfy_supervisores%rowtype;
  v_par public.sfy_parceiros%rowtype;
  v_candidatos int;
begin
  if v_cat not in ('climabrisa', 'agro') then
    return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'categoria_invalida');
  end if;

  -- Agro: supervisor pelo estado, sem parceiro.
  if v_cat = 'agro' then
    select * into v_sup from public.sfy_supervisores
     where organization_id = p_org and categoria = 'agro' and ativo and v_uf = any (ufs)
     order by nome limit 1;
    if not found then
      select * into v_sup from public.sfy_supervisores
       where organization_id = p_org and categoria = 'agro' and ativo and padrao
       order by nome limit 1;
    end if;
    if not found then
      return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'agro_sem_supervisor');
    end if;
    return jsonb_build_object(
      'motivo', 'agro_por_uf', 'etapa', 'supervisor',
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id);
  end if;

  if v_cidade = '' or v_uf !~ '^[A-Z]{2}$' then
    return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'cidade_ou_uf_ausente');
  end if;

  -- Climabrisa: parceiros ativos, com como ser avisados, que atendem a cidade.
  select count(*) into v_candidatos
    from public.sfy_parceiro_cidades c
    join public.sfy_parceiros p on p.id = c.parceiro_id
   where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
     and p.ativo and p.categoria = 'climabrisa'
     and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '');

  if v_candidatos > 0 then
    -- Quem recebeu há mais tempo (nunca recebeu vem primeiro); trava a linha para dois
    -- negócios simultâneos não caírem no mesmo parceiro.
    select p.* into v_par
      from public.sfy_parceiro_cidades c
      join public.sfy_parceiros p on p.id = c.parceiro_id
     where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
       and p.ativo and p.categoria = 'climabrisa'
       and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
     order by p.ultimo_recebimento_em asc nulls first, p.codigo asc
     limit 1
       for update of p skip locked;
    if not found then
      select p.* into v_par
        from public.sfy_parceiro_cidades c
        join public.sfy_parceiros p on p.id = c.parceiro_id
       where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
         and p.ativo and p.categoria = 'climabrisa'
         and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
       order by p.ultimo_recebimento_em asc nulls first, p.codigo asc
       limit 1
         for update of p;
    end if;
    update public.sfy_parceiros set ultimo_recebimento_em = clock_timestamp(), updated_at = now()
     where id = v_par.id;
    select * into v_sup from public.sfy_supervisores
     where id = v_par.supervisor_id and organization_id = p_org and ativo;
    return jsonb_build_object(
      'motivo', case when v_candidatos = 1 then 'parceiro_unico' else 'rodizio' end,
      'etapa', 'representante',
      'parceiro_id', v_par.id, 'parceiro_codigo', v_par.codigo, 'parceiro_nome', v_par.nome,
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id);
  end if;

  -- Sem parceiro na cidade: supervisor do parceiro mais próximo.
  select s.* into v_sup
    from public.sfy_cidade_supervisor cs
    join public.sfy_supervisores s on s.id = cs.supervisor_id
   where cs.organization_id = p_org and cs.uf = v_uf and cs.cidade_norm = v_cidade and s.ativo;
  if found then
    return jsonb_build_object(
      'motivo', 'supervisor_da_cidade', 'etapa', 'supervisor',
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id);
  end if;

  return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'cidade_sem_cobertura');
end;
$$;

revoke all on function public.fn_sfy_escolher_destino(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_sfy_escolher_destino(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
