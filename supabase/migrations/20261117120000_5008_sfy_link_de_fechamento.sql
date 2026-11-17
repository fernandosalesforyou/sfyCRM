-- manifest: sfy (fork Sales for You, Bloco D): tabelas `sfy_links_fechamento` (link secreto por parceiro para informar fechamentos; guarda só o HASH do token, com validade e revogação) e `sfy_fechamentos_sinalizados` (pedido do parceiro: valor e nota de um negócio, que o administrador trata; não muda o negócio para Ganho). Só o servidor lê e escreve. Sem linhas = nada muda no original.

-- 5008 — link de fechamento do parceiro (Bloco D, D4).
-- O parceiro não tem login. Recebe um link com token aleatório de 256 bits (guardado só como
-- SHA-256), que mostra os negócios abertos DELE e deixa informar valor e nota. A informação vira
-- um PEDIDO para o administrador; o negócio só vira Ganho pelas regras de sempre (Bloco A).

create table if not exists public.sfy_links_fechamento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parceiro_id uuid not null references public.sfy_parceiros(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  ultimo_uso_em timestamptz
);

create index if not exists sfy_links_fechamento_parceiro
  on public.sfy_links_fechamento (organization_id, parceiro_id);

comment on table public.sfy_links_fechamento is
  'sfy (fork Sales for You, migration 5008): link de fechamento por parceiro. Só o hash do token; validade e revogação. Só o servidor lê e escreve.';

create table if not exists public.sfy_fechamentos_sinalizados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  parceiro_id uuid not null references public.sfy_parceiros(id) on delete cascade,
  link_id uuid references public.sfy_links_fechamento(id) on delete set null,
  valor_centavos bigint not null check (valor_centavos > 0 and valor_centavos < 100000000000),
  moeda text not null default 'BRL',
  nota_fiscal text not null default '' check (length(nota_fiscal) <= 60),
  observacao text not null default '' check (length(observacao) <= 500),
  status text not null default 'pendente' check (status in ('pendente', 'tratado', 'recusado')),
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid
);

create unique index if not exists sfy_fechamentos_um_pendente_por_negocio
  on public.sfy_fechamentos_sinalizados (lead_id, parceiro_id) where status = 'pendente';

create index if not exists sfy_fechamentos_por_status
  on public.sfy_fechamentos_sinalizados (organization_id, status, criado_em desc);

comment on table public.sfy_fechamentos_sinalizados is
  'sfy (fork Sales for You, migration 5008): fechamento informado pelo parceiro (valor e nota). É um PEDIDO: o administrador trata; o negócio não muda sozinho. Só o servidor lê e escreve.';

alter table public.sfy_links_fechamento enable row level security;
alter table public.sfy_fechamentos_sinalizados enable row level security;
revoke all on public.sfy_links_fechamento from anon;
revoke all on public.sfy_links_fechamento from authenticated;
revoke all on public.sfy_fechamentos_sinalizados from anon;
revoke all on public.sfy_fechamentos_sinalizados from authenticated;
grant select, insert, update, delete on public.sfy_links_fechamento to service_role;
grant select, insert, update, delete on public.sfy_fechamentos_sinalizados to service_role;

notify pgrst, 'reload schema';
