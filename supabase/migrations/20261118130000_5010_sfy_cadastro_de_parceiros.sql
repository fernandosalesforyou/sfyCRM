-- manifest: sfy (fork Sales for You, etapa 7B): o cadastro de parceiros vira a fonte de verdade. `sfy_parceiros` ganha `certificado`, `certificado_em`, `recebe_leads` (só pode ser verdadeiro para quem está ativo e certificado), `saiu_em` e `user_id`; nascem `sfy_parceiro_apelidos` (nomes antigos de um parceiro, únicos por organização) e `sfy_municipios` (lista pública do IBGE com coordenadas, só o servidor lê); `sfy_cidade_supervisor` ganha `manual`. `fn_sfy_escolher_destino` passa a exigir `ativo e recebe_leads`, aceita `p_simular` (não gasta a vez do rodízio) e cai no supervisor padrão da Climabrisa; `fn_sfy_recalcular_cidades_supervisor` refaz o supervisor das cidades sem parceiro elegível. Parceiros que já existiam ficam certificados e recebendo, então nada muda para quem já usa. Sem linhas novas = nada muda no original.

-- 5010 — cadastro de parceiros no CRM (etapa 7B).

-- 1) Colunas novas em sfy_parceiros. Os parceiros que já existiam (carga do Bloco C, feita antes
--    desta regra) ficam certificados e recebendo, para o comportamento não mudar. O ajuste roda
--    SÓ na primeira aplicação (o baseline pode ser reaplicado e não pode desfazer decisões).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sfy_parceiros' and column_name = 'certificado'
  ) then
    alter table public.sfy_parceiros
      add column certificado boolean not null default false,
      add column recebe_leads boolean not null default false;
    update public.sfy_parceiros set certificado = true, recebe_leads = true where ativo;
  end if;
end $$;

alter table public.sfy_parceiros add column if not exists certificado_em date;
alter table public.sfy_parceiros add column if not exists saiu_em date;
alter table public.sfy_parceiros add column if not exists user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sfy_parceiros_recebe_leads_exige_certificado'
  ) then
    alter table public.sfy_parceiros
      add constraint sfy_parceiros_recebe_leads_exige_certificado
      check (not recebe_leads or (ativo and certificado));
  end if;
end $$;

comment on column public.sfy_parceiros.certificado is
  'sfy (fork Sales for You, migration 5010): fez o curso da Universidade Climabrisa. Só certificado pode receber lead.';
comment on column public.sfy_parceiros.recebe_leads is
  'sfy (fork Sales for You, migration 5010): pode entrar no rodízio. Só verdadeiro se ativo e certificado (constraint). Falso = a região dele vai para o supervisor.';
comment on column public.sfy_parceiros.user_id is
  'sfy (fork Sales for You, migration 5010): usuário do CRM deste parceiro, para um login futuro. Hoje fica vazio (representantes não têm login).';

-- 2) sfy_cidade_supervisor: linhas manuais não são refeitas pelo recálculo.
alter table public.sfy_cidade_supervisor add column if not exists manual boolean not null default false;

-- 3) Apelidos: outros nomes do mesmo parceiro (mapa, RD, Salesforce), únicos por organização.
create table if not exists public.sfy_parceiro_apelidos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  apelido_norm text not null check (apelido_norm = lower(apelido_norm) and length(apelido_norm) > 0),
  apelido text not null check (length(btrim(apelido)) > 0),
  parceiro_id uuid not null references public.sfy_parceiros(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, apelido_norm)
);

create index if not exists sfy_parceiro_apelidos_parceiro
  on public.sfy_parceiro_apelidos (parceiro_id);

comment on table public.sfy_parceiro_apelidos is
  'sfy (fork Sales for You, migration 5010): nomes antigos de um parceiro (mapa, RD, Salesforce). Servem para casar importações e relatórios; um nome aponta para um só parceiro.';

alter table public.sfy_parceiro_apelidos enable row level security;
revoke all on public.sfy_parceiro_apelidos from anon;
revoke all on public.sfy_parceiro_apelidos from authenticated;
grant select on public.sfy_parceiro_apelidos to authenticated;
grant select, insert, update, delete on public.sfy_parceiro_apelidos to service_role;
drop policy if exists tenant_isolation_sfy_parceiro_apelidos_select on public.sfy_parceiro_apelidos;
create policy tenant_isolation_sfy_parceiro_apelidos_select on public.sfy_parceiro_apelidos
  for select to authenticated using (organization_id in (select public.fn_user_org_ids()));

-- 4) Municípios do IBGE (dado público, igual para toda a instalação). Sem organização e SEM política:
--    ninguém lê pela API do navegador; só o servidor (service_role). Carga por script.
create table if not exists public.sfy_municipios (
  codigo_ibge integer primary key,
  nome text not null,
  nome_norm text not null check (nome_norm = lower(nome_norm)),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  latitude double precision not null,
  longitude double precision not null
);

create index if not exists sfy_municipios_busca on public.sfy_municipios (uf, nome_norm);

comment on table public.sfy_municipios is
  'sfy (fork Sales for You, migration 5010): municípios do IBGE com coordenadas, para o supervisor das cidades sem parceiro e a busca por cidade. Dado público; só o servidor lê.';

alter table public.sfy_municipios enable row level security;
revoke all on public.sfy_municipios from anon;
revoke all on public.sfy_municipios from authenticated;
grant select, insert, update, delete on public.sfy_municipios to service_role;

-- 5) Para quem vai o negócio. A assinatura muda (p_simular), então a antiga sai antes.
drop function if exists public.fn_sfy_escolher_destino(uuid, text, text, text);

create or replace function public.fn_sfy_escolher_destino(
  p_org uuid,
  p_categoria text,
  p_cidade text,
  p_uf text,
  p_simular boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_cidade text := public.fn_sfy_normaliza_cidade(p_cidade);
  v_uf text := upper(btrim(coalesce(p_uf, '')));
  v_cat text := lower(btrim(coalesce(p_categoria, '')));
  v_extra jsonb := jsonb_build_object('simulacao', coalesce(p_simular, false));
  v_sup public.sfy_supervisores%rowtype;
  v_par public.sfy_parceiros%rowtype;
  v_candidatos int;
  v_elegiveis jsonb;
begin
  if v_cat not in ('climabrisa', 'agro') then
    return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'categoria_invalida') || v_extra;
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
      return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'agro_sem_supervisor') || v_extra;
    end if;
    return jsonb_build_object(
      'motivo', 'agro_por_uf', 'etapa', 'supervisor',
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id) || v_extra;
  end if;

  if v_cidade = '' or v_uf !~ '^[A-Z]{2}$' then
    return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'cidade_ou_uf_ausente') || v_extra;
  end if;

  -- Climabrisa: parceiros ativos, certificados e recebendo, com como ser avisados, que atendem a cidade.
  select count(*),
         jsonb_agg(jsonb_build_object('codigo', x.codigo, 'nome', x.nome)
                   order by x.ultimo_recebimento_em asc nulls first, x.codigo asc)
    into v_candidatos, v_elegiveis
    from (
      select p.codigo, p.nome, p.ultimo_recebimento_em
        from public.sfy_parceiro_cidades c
        join public.sfy_parceiros p on p.id = c.parceiro_id
       where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
         and p.ativo and p.recebe_leads and p.categoria = 'climabrisa'
         and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
    ) x;

  if v_candidatos > 0 then
    if p_simular then
      -- Só olha: quem seria o próximo, sem gastar a vez de ninguém.
      select p.* into v_par
        from public.sfy_parceiro_cidades c
        join public.sfy_parceiros p on p.id = c.parceiro_id
       where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
         and p.ativo and p.recebe_leads and p.categoria = 'climabrisa'
         and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
       order by p.ultimo_recebimento_em asc nulls first, p.codigo asc
       limit 1;
    else
      -- Quem recebeu há mais tempo (nunca recebeu vem primeiro); trava a linha para dois
      -- negócios simultâneos não caírem no mesmo parceiro.
      select p.* into v_par
        from public.sfy_parceiro_cidades c
        join public.sfy_parceiros p on p.id = c.parceiro_id
       where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
         and p.ativo and p.recebe_leads and p.categoria = 'climabrisa'
         and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
       order by p.ultimo_recebimento_em asc nulls first, p.codigo asc
       limit 1
         for update of p skip locked;
      if not found then
        select p.* into v_par
          from public.sfy_parceiro_cidades c
          join public.sfy_parceiros p on p.id = c.parceiro_id
         where c.organization_id = p_org and c.uf = v_uf and c.cidade_norm = v_cidade
           and p.ativo and p.recebe_leads and p.categoria = 'climabrisa'
           and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
         order by p.ultimo_recebimento_em asc nulls first, p.codigo asc
         limit 1
           for update of p;
      end if;
      update public.sfy_parceiros set ultimo_recebimento_em = clock_timestamp(), updated_at = now()
       where id = v_par.id;
    end if;
    select * into v_sup from public.sfy_supervisores
     where id = v_par.supervisor_id and organization_id = p_org and ativo;
    return jsonb_build_object(
      'motivo', case when v_candidatos = 1 then 'parceiro_unico' else 'rodizio' end,
      'etapa', 'representante',
      'parceiro_id', v_par.id, 'parceiro_codigo', v_par.codigo, 'parceiro_nome', v_par.nome,
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id,
      'elegiveis', v_elegiveis) || v_extra;
  end if;

  -- Sem parceiro elegível na cidade: supervisor da cidade (refeito por fn_sfy_recalcular_cidades_supervisor).
  select s.* into v_sup
    from public.sfy_cidade_supervisor cs
    join public.sfy_supervisores s on s.id = cs.supervisor_id
   where cs.organization_id = p_org and cs.uf = v_uf and cs.cidade_norm = v_cidade and s.ativo;
  if found then
    return jsonb_build_object(
      'motivo', 'supervisor_da_cidade', 'etapa', 'supervisor',
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id) || v_extra;
  end if;

  -- Cidade fora de todas as tabelas: o supervisor padrão da Climabrisa, se houver.
  select * into v_sup from public.sfy_supervisores
   where organization_id = p_org and categoria = 'climabrisa' and ativo and padrao
   order by nome limit 1;
  if found then
    return jsonb_build_object(
      'motivo', 'supervisor_padrao', 'etapa', 'supervisor',
      'supervisor_id', v_sup.id, 'supervisor_nome', v_sup.nome, 'supervisor_user_id', v_sup.user_id) || v_extra;
  end if;

  return jsonb_build_object('motivo', 'sem_destino', 'detalhe', 'cidade_sem_cobertura') || v_extra;
end;
$$;

revoke all on function public.fn_sfy_escolher_destino(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fn_sfy_escolher_destino(uuid, text, text, text, boolean) to service_role;

-- 6) Refaz o supervisor das cidades SEM parceiro elegível (linhas manuais ficam como estão):
--    a) a cidade de um parceiro ativo que não recebe lead (pausado ou não certificado) vai para o
--       supervisor DELE;
--    b) a cidade sem nenhuma área vai para o supervisor do parceiro ativo mais próximo.
create or replace function public.fn_sfy_recalcular_cidades_supervisor(p_org uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_total int;
begin
  if not exists (select 1 from public.sfy_municipios) then
    return jsonb_build_object('erro', 'sem_municipios');
  end if;

  delete from public.sfy_cidade_supervisor where organization_id = p_org and not manual;

  insert into public.sfy_cidade_supervisor (organization_id, cidade_norm, uf, supervisor_id)
  with elegivel as (
    select pc.cidade_norm, pc.uf
      from public.sfy_parceiro_cidades pc
      join public.sfy_parceiros p on p.id = pc.parceiro_id
     where pc.organization_id = p_org and p.ativo and p.recebe_leads and p.categoria = 'climabrisa'
       and (coalesce(btrim(p.whatsapp), '') <> '' or coalesce(btrim(p.email), '') <> '')
  ),
  dono as (
    select distinct on (pc.cidade_norm, pc.uf) pc.cidade_norm, pc.uf, p.supervisor_id
      from public.sfy_parceiro_cidades pc
      join public.sfy_parceiros p on p.id = pc.parceiro_id
      join public.sfy_supervisores s on s.id = p.supervisor_id and s.ativo and s.categoria = 'climabrisa'
     where pc.organization_id = p_org and p.ativo and p.categoria = 'climabrisa'
       and not exists (select 1 from elegivel e where e.cidade_norm = pc.cidade_norm and e.uf = pc.uf)
     order by pc.cidade_norm, pc.uf, s.nome, p.codigo
  ),
  pontos as (
    select p.supervisor_id, m.latitude as lat, m.longitude as lon
      from public.sfy_parceiro_cidades pc
      join public.sfy_parceiros p on p.id = pc.parceiro_id
      join public.sfy_supervisores s on s.id = p.supervisor_id and s.ativo and s.categoria = 'climabrisa'
      join public.sfy_municipios m on m.nome_norm = pc.cidade_norm and m.uf = pc.uf
     where pc.organization_id = p_org and p.ativo and p.categoria = 'climabrisa'
  ),
  restantes as (
    select m.nome_norm as cidade_norm, m.uf, m.latitude as lat, m.longitude as lon
      from public.sfy_municipios m
     where not exists (select 1 from elegivel e where e.cidade_norm = m.nome_norm and e.uf = m.uf)
       and not exists (select 1 from dono d where d.cidade_norm = m.nome_norm and d.uf = m.uf)
  ),
  novas as (
    select d.cidade_norm, d.uf, d.supervisor_id from dono d
    union all
    select r.cidade_norm, r.uf,
           (select pt.supervisor_id from pontos pt
             order by power(pt.lat - r.lat, 2) + power((pt.lon - r.lon) * cos(radians(r.lat)), 2)
             limit 1)
      from restantes r
  )
  select p_org, n.cidade_norm, n.uf, n.supervisor_id
    from novas n
   where n.supervisor_id is not null
     and not exists (
       select 1 from public.sfy_cidade_supervisor x
        where x.organization_id = p_org and x.cidade_norm = n.cidade_norm and x.uf = n.uf)
  on conflict do nothing;

  select count(*) into v_total from public.sfy_cidade_supervisor where organization_id = p_org;
  return jsonb_build_object('cidades_com_supervisor', v_total);
end;
$$;

revoke all on function public.fn_sfy_recalcular_cidades_supervisor(uuid) from public, anon, authenticated;
grant execute on function public.fn_sfy_recalcular_cidades_supervisor(uuid) to service_role;

notify pgrst, 'reload schema';
