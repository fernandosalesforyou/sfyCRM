-- manifest: sfy (fork Sales for You, etapa 7B): a empresa mantém o cadastro pela tela. `sfy_parceiro_cidades` ganha `cidade_nome` (nome escrito de distrito ou povoado, que não existe na lista do IBGE); `sfy_supervisores` ganha `nomes_anteriores` (o relatório semanal continua achando os negócios gravados com o nome antigo); nasce `fn_sfy_desativar_supervisor`, que desativa um supervisor passando parceiros, cidades manuais, estados e a condição de padrão para um substituto, numa só operação. Só acrescenta: quem não usa a tela não muda.

-- 5012 — localidades escritas à mão e manutenção de supervisores (etapa 7B).

alter table public.sfy_parceiro_cidades add column if not exists cidade_nome text;
alter table public.sfy_supervisores add column if not exists nomes_anteriores text[] not null default '{}';

comment on column public.sfy_parceiro_cidades.cidade_nome is
  'sfy (fork Sales for You, migration 5012): nome como foi escrito, só para localidade que não é município do IBGE (distrito, povoado). Nos municípios fica vazio e o nome vem de sfy_municipios.';
comment on column public.sfy_supervisores.nomes_anteriores is
  'sfy (fork Sales for You, migration 5012): nomes que este supervisor já teve. Negócios antigos guardam o nome em texto.';

-- Desativa um supervisor sem deixar ninguém órfão. Devolve {erro: ...} sem mudar nada quando falta
-- um substituto válido.
create or replace function public.fn_sfy_desativar_supervisor(
  p_org uuid,
  p_supervisor uuid,
  p_substituto uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_sai public.sfy_supervisores%rowtype;
  v_entra public.sfy_supervisores%rowtype;
  v_parceiros int;
  v_transferidos int := 0;
begin
  select * into v_sai from public.sfy_supervisores
   where organization_id = p_org and id = p_supervisor
     for update;
  if not found then
    return jsonb_build_object('erro', 'nao_encontrado');
  end if;

  if p_substituto is not null then
    select * into v_entra from public.sfy_supervisores
     where organization_id = p_org and id = p_substituto and id <> p_supervisor
       and categoria = v_sai.categoria and ativo
       for update;
    if not found then
      return jsonb_build_object('erro', 'substituto_invalido');
    end if;
  else
    select count(*) into v_parceiros from public.sfy_parceiros
     where organization_id = p_org and supervisor_id = p_supervisor and ativo;
    if v_parceiros > 0 then
      return jsonb_build_object('erro', 'tem_parceiros', 'parceiros', v_parceiros);
    end if;
    if v_sai.categoria = 'agro' and (cardinality(v_sai.ufs) > 0 or v_sai.padrao) then
      return jsonb_build_object('erro', 'tem_estados');
    end if;
  end if;

  if p_substituto is not null then
    update public.sfy_parceiros set supervisor_id = p_substituto, updated_at = now()
     where organization_id = p_org and supervisor_id = p_supervisor;
    get diagnostics v_transferidos = row_count;
    update public.sfy_cidade_supervisor set supervisor_id = p_substituto
     where organization_id = p_org and supervisor_id = p_supervisor and manual;
    update public.sfy_supervisores
       set ufs = case when v_sai.categoria = 'agro'
                      then array(select distinct u from unnest(ufs || v_sai.ufs) u order by u)
                      else ufs end,
           padrao = padrao or v_sai.padrao,
           updated_at = now()
     where organization_id = p_org and id = p_substituto;
  end if;

  update public.sfy_supervisores
     set ativo = false,
         padrao = false,
         ufs = case when p_substituto is not null and categoria = 'agro' then '{}' else ufs end,
         updated_at = now()
   where organization_id = p_org and id = p_supervisor;

  return jsonb_build_object('desativado', true, 'parceiros_transferidos', v_transferidos);
end;
$$;

revoke all on function public.fn_sfy_desativar_supervisor(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_sfy_desativar_supervisor(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
