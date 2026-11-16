-- manifest: sfy (fork Sales for You, Bloco D): tabela `sfy_gasto_anuncio` (gasto diário por campanha, lido da plataforma de anúncios por rotina agendada e escrito só pelo servidor) e função só de leitura `fn_sfy_custo_por_campanha`, que cruza o gasto com os leads do CRM pelo campaign_id para dar custo por lead, custo por oportunidade e retorno. Sem linhas na tabela = nada muda no original.

-- 5007 — gasto de anúncio por dia e campanha, e custo por campanha (Bloco D, D3).
-- Guarda o gasto (uma leitura por dia) em vez de ler a plataforma a cada abertura da tela:
-- a conta Meta está em acesso de desenvolvimento, com cota baixa.

create table if not exists public.sfy_gasto_anuncio (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plataforma text not null check (plataforma in ('meta_ads', 'google_ads')),
  conta_id text not null,
  campanha_id text not null check (length(campanha_id) > 0),
  campanha_nome text not null default '',
  dia date not null,
  moeda text not null default 'BRL',
  gasto_centavos bigint not null check (gasto_centavos >= 0),
  impressoes bigint not null default 0,
  cliques bigint not null default 0,
  lido_em timestamptz not null default now(),
  primary key (organization_id, plataforma, campanha_id, dia)
);

create index if not exists sfy_gasto_anuncio_dia
  on public.sfy_gasto_anuncio (organization_id, dia);

comment on table public.sfy_gasto_anuncio is
  'sfy (fork Sales for You, migration 5007): gasto diário por campanha lido da plataforma de anúncios. Só o servidor lê e escreve (o gasto não é para todo membro).';

alter table public.sfy_gasto_anuncio enable row level security;
revoke all on public.sfy_gasto_anuncio from anon;
revoke all on public.sfy_gasto_anuncio from authenticated;
grant select, insert, update, delete on public.sfy_gasto_anuncio to service_role;

-- Custo por campanha. Leads: criados em [p_de, p_ate); gasto: dias [p_dia_de, p_dia_ate].
-- Oportunidade = negócio que está, ou passou, por etapa cujo nome começa com p_prefixo_etapa.
-- Lead sem campaign_id entra na linha com plataforma e campanha vazias (nunca é rateado).
create or replace function public.fn_sfy_custo_por_campanha(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_dia_de date,
  p_dia_ate date,
  p_prefixo_etapa text default 'Em negociação',
  p_incluir_historico boolean default false
) returns table (
  plataforma text,
  campanha_id text,
  campanha_nome text,
  moeda text,
  gasto_centavos bigint,
  leads bigint,
  oportunidades bigint,
  ganhos bigint,
  valor_ganho_centavos bigint
)
language sql stable
set search_path = public
as $$
  with etapas as (
    select s.id from public.crm_stages s
     where s.organization_id = p_org and s.name ilike (p_prefixo_etapa || '%')
  ),
  base as (
    select
      coalesce(nullif(btrim(l.source_metadata ->> 'campaign_id'), ''), '') as campanha_id,
      l.status, l.value_cents,
      coalesce(nullif(btrim(l.currency), ''), '') as moeda,
      (l.stage_id in (select id from etapas)
        or exists (
          select 1 from public.crm_lead_activities a
           where a.lead_id = l.id and a.type = 'stage_changed'
             and (a.payload ->> 'to_stage_id') in (select id::text from etapas))) as oportunidade
    from public.crm_leads l
    where l.organization_id = p_org
      and l.created_at >= p_de and l.created_at < p_ate
      and (p_incluir_historico or not ('historico-em-aberto' = any (l.tags)))
  ),
  leads_por_campanha as (
    select campanha_id,
           count(*) as leads,
           count(*) filter (where oportunidade) as oportunidades,
           count(*) filter (where status = 'won') as ganhos,
           coalesce(sum(value_cents) filter (where status = 'won'), 0)::bigint as valor
      from base group by campanha_id
  ),
  gasto as (
    select g.plataforma, g.campanha_id, max(g.campanha_nome) as nome, max(g.moeda) as moeda,
           sum(g.gasto_centavos)::bigint as gasto
      from public.sfy_gasto_anuncio g
     where g.organization_id = p_org and g.dia between p_dia_de and p_dia_ate
     group by g.plataforma, g.campanha_id
  )
  select
    coalesce(g.plataforma, '') as plataforma,
    coalesce(g.campanha_id, lc.campanha_id) as campanha_id,
    coalesce(g.nome, '') as campanha_nome,
    coalesce(g.moeda, '') as moeda,
    coalesce(g.gasto, 0)::bigint as gasto_centavos,
    coalesce(lc.leads, 0) as leads,
    coalesce(lc.oportunidades, 0) as oportunidades,
    coalesce(lc.ganhos, 0) as ganhos,
    coalesce(lc.valor, 0)::bigint as valor_ganho_centavos
  from gasto g
  full join leads_por_campanha lc on lc.campanha_id = g.campanha_id
$$;

revoke all on function public.fn_sfy_custo_por_campanha(uuid, timestamptz, timestamptz, date, date, text, boolean) from public, anon, authenticated;
grant execute on function public.fn_sfy_custo_por_campanha(uuid, timestamptz, timestamptz, date, date, text, boolean) to service_role;

notify pgrst, 'reload schema';
