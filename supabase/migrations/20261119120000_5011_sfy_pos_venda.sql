-- manifest: sfy (fork Sales for You, etapa 10): tabela `sfy_pedidos_pos_venda` (um registro por negócio ganho com número de NF-e: guarda o link de rastreio vindo da ponte do Microsys, a data de entrega, a situação da sequência de pós-venda e os carimbos das 3 mensagens: rastreio, confirmação de instalação aos 45 dias e manutenção aos 8 meses). Só o servidor lê e escreve. Sem linhas = nada muda no original.

-- 5011 — pós-venda: rastreio, confirmação de instalação e manutenção (etapa 10).
-- A chave do cruzamento com o Microsys é o número da NF-e (campo do negócio ganho). O cron
-- `sfy-pos-venda` cria a linha, consulta a ponte da TI e envia as mensagens vencidas. O carimbo
-- de cada mensagem é gravado ANTES do envio, para nunca mandar duas vezes. Não guarda dados
-- pessoais do Microsys: o contato é o do CRM.

create table if not exists public.sfy_pedidos_pos_venda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  nfe_numero text not null check (length(nfe_numero) between 1 and 20),
  nfe_serie text not null default '' check (length(nfe_serie) <= 5),
  venda_numero text not null default '' check (length(venda_numero) <= 40),
  link_rastreio text check (link_rastreio is null or (length(link_rastreio) <= 500 and link_rastreio ~ '^https://')),
  link_valido_ate timestamptz,
  origem_link text check (origem_link in ('microsys', 'manual')),
  situacao_rastreio text not null default '' check (length(situacao_rastreio) <= 120),
  entregue_em timestamptz,
  instalacao_confirmada_em timestamptz,
  instalacao_adiada_em timestamptz,
  situacao text not null default 'aguardando_link'
    check (situacao in ('aguardando_link', 'ativa', 'pausada', 'cancelada', 'concluida')),
  msg1_em timestamptz,
  msg2_em timestamptz,
  msg2_repetida_em timestamptz,
  msg3_em timestamptz,
  ultima_consulta_em timestamptz,
  tentativas integer not null default 0 check (tentativas >= 0),
  ultimo_erro text not null default '' check (length(ultimo_erro) <= 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists sfy_pedidos_pos_venda_um_por_negocio
  on public.sfy_pedidos_pos_venda (organization_id, lead_id);

create unique index if not exists sfy_pedidos_pos_venda_nfe_unica
  on public.sfy_pedidos_pos_venda (organization_id, nfe_numero, nfe_serie);

create index if not exists sfy_pedidos_pos_venda_por_situacao
  on public.sfy_pedidos_pos_venda (organization_id, situacao, ultima_consulta_em);

comment on table public.sfy_pedidos_pos_venda is
  'sfy (fork Sales for You, migration 5011): sequência de pós-venda por NF-e (rastreio, instalação aos 45 dias, manutenção aos 8 meses). Só o servidor lê e escreve.';

alter table public.sfy_pedidos_pos_venda enable row level security;
revoke all on public.sfy_pedidos_pos_venda from anon;
revoke all on public.sfy_pedidos_pos_venda from authenticated;
grant select, insert, update, delete on public.sfy_pedidos_pos_venda to service_role;

-- LGPD: contato anonimizado não recebe mais mensagem e o rastreio (que leva a endereço) some.
-- O número da NF-e fica: é referência de documento fiscal.
create or replace function public.fn_sfy_pos_venda_anonimizado()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
begin
  update public.sfy_pedidos_pos_venda
     set situacao = 'cancelada', link_rastreio = null, link_valido_ate = null, origem_link = null,
         situacao_rastreio = '', venda_numero = '', ultimo_erro = '', atualizado_em = now()
   where organization_id = new.organization_id and contact_id = new.id;
  return new;
end$$;

revoke all on function public.fn_sfy_pos_venda_anonimizado() from public;
revoke execute on function public.fn_sfy_pos_venda_anonimizado() from anon;
revoke execute on function public.fn_sfy_pos_venda_anonimizado() from authenticated;

drop trigger if exists trg_contacts_anonimizado_sfy_pos_venda on public.contacts;
create trigger trg_contacts_anonimizado_sfy_pos_venda
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_sfy_pos_venda_anonimizado();

notify pgrst, 'reload schema';
