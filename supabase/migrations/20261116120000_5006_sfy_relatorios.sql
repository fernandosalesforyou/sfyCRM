-- manifest: sfy (fork Sales for You, Bloco D): três funções só de leitura para os relatórios do Desempenho (`fn_sfy_relatorio_por_destino`, `fn_sfy_leads_por_periodo`, `fn_sfy_relatorio_por_origem`): negócios por parceiro/supervisor, leads por período e categoria no fuso da organização e por origem. Sem tabela nova, sem SECURITY DEFINER; só o servidor (service_role) executa.

-- 5006 — relatórios do Bloco D: por parceiro/supervisor, leads por dia e por origem.
-- Só leitura. Funções sem SECURITY DEFINER, chamadas pelo servidor (service_role) com a
-- organização explícita, no mesmo padrão das rotas de métricas.

-- Por parceiro ou por supervisor (p_chaves = chaves do campo personalizado no negócio; a chave
-- pode variar de funil para funil, vale a primeira preenchida).
-- Coorte: negócios CRIADOS na janela [p_de, p_ate); ganho/perdido é o estado de hoje.
create or replace function public.fn_sfy_relatorio_por_destino(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_chaves text[],
  p_incluir_historico boolean default false
) returns table (
  grupo text,
  moeda text,
  leads bigint,
  abertos bigint,
  ganhos bigint,
  perdidos bigint,
  valor_ganho_centavos bigint,
  mediana_dias_ate_ganho numeric
)
language sql stable
set search_path = public
as $$
  select
    coalesce((select nullif(btrim(l.custom_fields ->> k), '') from unnest(p_chaves) k
              where nullif(btrim(l.custom_fields ->> k), '') is not null limit 1), '') as grupo,
    coalesce(nullif(btrim(l.currency), ''), '') as moeda,
    count(*) as leads,
    count(*) filter (where l.status = 'open') as abertos,
    count(*) filter (where l.status = 'won') as ganhos,
    count(*) filter (where l.status = 'lost') as perdidos,
    coalesce(sum(l.value_cents) filter (where l.status = 'won'), 0)::bigint as valor_ganho_centavos,
    (percentile_cont(0.5) within group (
       order by extract(epoch from (l.closed_at - l.created_at)) / 86400.0)
     filter (where l.status = 'won' and l.closed_at is not null))::numeric as mediana_dias_ate_ganho
  from public.crm_leads l
  where l.organization_id = p_org
    and l.created_at >= p_de and l.created_at < p_ate
    and (p_incluir_historico or not ('historico-em-aberto' = any (l.tags)))
  group by 1, 2
$$;

-- Leads criados por balde de tempo, categoria e origem.
-- p_granularidade: dia | semana | mes (no fuso p_tz; semana começa na segunda).
create or replace function public.fn_sfy_leads_por_periodo(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_tz text,
  p_granularidade text,
  p_chaves_categoria text[],
  p_incluir_historico boolean default false
) returns table (
  balde date,
  categoria text,
  origem text,
  leads bigint
)
language sql stable
set search_path = public
as $$
  select
    date_trunc(
      case p_granularidade when 'mes' then 'month' when 'semana' then 'week' else 'day' end,
      l.created_at at time zone p_tz)::date as balde,
    coalesce((select nullif(btrim(l.custom_fields ->> k), '') from unnest(p_chaves_categoria) k
              where nullif(btrim(l.custom_fields ->> k), '') is not null limit 1), '') as categoria,
    coalesce(nullif(btrim(l.source), ''), '') as origem,
    count(*) as leads
  from public.crm_leads l
  where l.organization_id = p_org
    and l.created_at >= p_de and l.created_at < p_ate
    and p_granularidade in ('dia', 'semana', 'mes')
    and (p_incluir_historico or not ('historico-em-aberto' = any (l.tags)))
  group by 1, 2, 3
  order by 1, 2, 3
$$;

-- Por origem: volume e resultado (mesma coorte da função por destino).
create or replace function public.fn_sfy_relatorio_por_origem(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_incluir_historico boolean default false
) returns table (
  origem text,
  moeda text,
  leads bigint,
  ganhos bigint,
  perdidos bigint,
  valor_ganho_centavos bigint
)
language sql stable
set search_path = public
as $$
  select
    coalesce(nullif(btrim(l.source), ''), '') as origem,
    coalesce(nullif(btrim(l.currency), ''), '') as moeda,
    count(*) as leads,
    count(*) filter (where l.status = 'won') as ganhos,
    count(*) filter (where l.status = 'lost') as perdidos,
    coalesce(sum(l.value_cents) filter (where l.status = 'won'), 0)::bigint as valor_ganho_centavos
  from public.crm_leads l
  where l.organization_id = p_org
    and l.created_at >= p_de and l.created_at < p_ate
    and (p_incluir_historico or not ('historico-em-aberto' = any (l.tags)))
  group by 1, 2
$$;

revoke all on function public.fn_sfy_relatorio_por_destino(uuid, timestamptz, timestamptz, text[], boolean) from public, anon, authenticated;
revoke all on function public.fn_sfy_leads_por_periodo(uuid, timestamptz, timestamptz, text, text, text[], boolean) from public, anon, authenticated;
revoke all on function public.fn_sfy_relatorio_por_origem(uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.fn_sfy_relatorio_por_destino(uuid, timestamptz, timestamptz, text[], boolean) to service_role;
grant execute on function public.fn_sfy_leads_por_periodo(uuid, timestamptz, timestamptz, text, text, text[], boolean) to service_role;
grant execute on function public.fn_sfy_relatorio_por_origem(uuid, timestamptz, timestamptz, boolean) to service_role;

notify pgrst, 'reload schema';
