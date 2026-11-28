-- manifest: sfy 5013: painel comercial (indicadores e gráficos de Desempenho) agregados numa chamada, só para gerente ou acima
create or replace function public.fn_sfy_painel_comercial(p_org uuid, p_desde date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = p_org and uo.user_id = auth.uid()
       and uo.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;

  with base as (
    select l.id, l.status, l.value_cents, l.created_at, l.closed_at, l.pipeline_id, l.stage_id,
           nullif(l.custom_fields->>'supervisor', '') as supervisor,
           nullif(l.custom_fields->>'parceiro_responsavel', '') as parceiro,
           upper(nullif(l.custom_fields->>'uf', '')) as uf,
           nullif(l.custom_fields->>'categoria', '') as categoria
      from public.crm_leads l
     where l.organization_id = p_org and l.status <> 'archived'
       and (p_desde is null or l.created_at >= p_desde)
  )
  select jsonb_build_object(
    'kpis', (select jsonb_build_object(
        'total', count(*),
        'abertos', count(*) filter (where status = 'open'),
        'ganhos', count(*) filter (where status = 'won'),
        'perdidos', count(*) filter (where status = 'lost'),
        'valor_ganho', coalesce(sum(value_cents) filter (where status = 'won'), 0),
        'valor_aberto', coalesce(sum(value_cents) filter (where status = 'open'), 0),
        'ganhos_com_valor', count(*) filter (where status = 'won' and value_cents > 0),
        'parceiros_ativos', count(distinct parceiro) filter (where status = 'open'))
      from base),
    'por_mes', coalesce((select jsonb_agg(m order by m->>'mes') from (
        select jsonb_build_object('mes', to_char(date_trunc('month', created_at at time zone 'America/Sao_Paulo'), 'YYYY-MM'),
               'criados', count(*), 'ganhos', count(*) filter (where status = 'won'),
               'perdidos', count(*) filter (where status = 'lost'),
               'valor_ganho', coalesce(sum(value_cents) filter (where status = 'won'), 0)) m
          from base group by 1 is not null, date_trunc('month', created_at at time zone 'America/Sao_Paulo')) x), '[]'::jsonb),
    'por_etapa', coalesce((select jsonb_agg(jsonb_build_object('funil', p.name, 'etapa', s.name, 'pos', s.position,
               'qtd', (select count(*) from base b where b.stage_id = s.id),
               'valor', (select coalesce(sum(value_cents), 0) from base b where b.stage_id = s.id)) order by p.position, s.position)
          from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
         where p.organization_id = p_org and p.is_default and not s.is_archived), '[]'::jsonb),
    'por_funil', coalesce((select jsonb_agg(jsonb_build_object('nome', p.name, 'qtd', c.qtd) order by c.qtd desc)
          from (select pipeline_id, count(*) qtd from base group by 1) c join public.crm_pipelines p on p.id = c.pipeline_id), '[]'::jsonb),
    'por_supervisor', coalesce((select jsonb_agg(x order by (x->>'total')::int desc) from (
        select jsonb_build_object('nome', supervisor, 'total', count(*), 'abertos', count(*) filter (where status = 'open'),
               'ganhos', count(*) filter (where status = 'won'), 'perdidos', count(*) filter (where status = 'lost'),
               'valor_ganho', coalesce(sum(value_cents) filter (where status = 'won'), 0)) x
          from base where supervisor is not null group by supervisor order by count(*) desc limit 12) y), '[]'::jsonb),
    'por_parceiro', coalesce((select jsonb_agg(x order by (x->>'valor_ganho')::bigint desc, (x->>'total')::int desc) from (
        select jsonb_build_object('codigo', b.parceiro, 'nome', coalesce(sp.nome, b.parceiro), 'total', count(*),
               'ganhos', count(*) filter (where b.status = 'won'),
               'valor_ganho', coalesce(sum(b.value_cents) filter (where b.status = 'won'), 0)) x
          from base b left join public.sfy_parceiros sp on sp.organization_id = p_org and sp.codigo::text = b.parceiro
         where b.parceiro is not null group by b.parceiro, sp.nome
         order by coalesce(sum(b.value_cents) filter (where b.status = 'won'), 0) desc, count(*) desc limit 10) y), '[]'::jsonb),
    'por_uf', coalesce((select jsonb_agg(x order by (x->>'qtd')::int desc) from (
        select jsonb_build_object('uf', uf, 'qtd', count(*), 'ganhos', count(*) filter (where status = 'won')) x
          from base where uf is not null and length(uf) = 2 group by uf order by count(*) desc limit 15) y), '[]'::jsonb),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('nome', categoria, 'qtd', qtd) order by qtd desc)
          from (select coalesce(categoria, 'Sem categoria') categoria, count(*) qtd from base group by 1) c), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

revoke all on function public.fn_sfy_painel_comercial(uuid, date) from public, anon;
grant execute on function public.fn_sfy_painel_comercial(uuid, date) to authenticated;
