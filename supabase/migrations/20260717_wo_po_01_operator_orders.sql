-- WO-01 + PO-01 + WO-02/PO-02 base operativa.
-- Migracion preparada para Supabase. No ejecutar automaticamente desde Codex.

create table if not exists public.elankav_master_case_counters (
  year text primary key,
  last_sequence integer not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.elankav_reserve_master_base_sequence(target_year text default to_char(now(), 'YYYY'))
returns text
language plpgsql
as $$
declare
  next_value integer;
begin
  insert into public.elankav_master_case_counters(year, last_sequence, updated_at)
  values (target_year, 1, now())
  on conflict (year) do update
    set last_sequence = public.elankav_master_case_counters.last_sequence + 1,
        updated_at = now()
  returning last_sequence into next_value;

  return target_year || '-' || lpad(next_value::text, 6, '0');
end;
$$;

create table if not exists public.elankav_master_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null,
  platform_id text not null,
  case_type text not null
    check (case_type in ('commercial','internal_purchase','inventory','maintenance','internal_work')),
  origin_type text not null
    check (origin_type in ('quotation','manual_purchase','manual_work_order','purchase_request')),
  origin_id text,
  quotation_id text,
  quotation_number text,
  base_sequence text not null,
  status text not null default 'open'
    check (status in ('open','active','completed','cancelled')),
  contract_version text not null default '1.0.0',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_elankav_master_cases_number_unique
  on public.elankav_master_cases(case_number);

create index if not exists idx_elankav_master_cases_platform_status
  on public.elankav_master_cases(platform_id, status, created_at desc);

create index if not exists idx_elankav_master_cases_platform_type
  on public.elankav_master_cases(platform_id, case_type, created_at desc);

create index if not exists idx_elankav_master_cases_quotation
  on public.elankav_master_cases(quotation_id);

create table if not exists public.elankav_document_lineage_counters (
  case_id uuid not null references public.elankav_master_cases(id) on delete cascade,
  document_type text not null check (document_type in ('work_order','purchase_order')),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (case_id, document_type)
);

create or replace function public.elankav_reserve_document_suffix(target_case_id uuid, target_document_type text)
returns integer
language plpgsql
as $$
declare
  next_value integer;
begin
  insert into public.elankav_document_lineage_counters(case_id, document_type, last_sequence, updated_at)
  values (target_case_id, target_document_type, 1, now())
  on conflict (case_id, document_type) do update
    set last_sequence = public.elankav_document_lineage_counters.last_sequence + 1,
        updated_at = now()
  returning last_sequence into next_value;

  return next_value;
end;
$$;

create table if not exists public.elankav_ops_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null,
  case_id uuid not null references public.elankav_master_cases(id),
  case_number text not null,
  base_sequence text not null,
  quotation_id text,
  quotation_number text,
  lineage jsonb not null default '{}'::jsonb,
  platform_id text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','scheduled','in_production','quality_review','completed','cancelled')),
  title text not null,
  priority text not null default 'normal',
  source_type text not null default 'manual'
    check (source_type in ('manual','quotation','project')),
  source_id text,
  source_quotation_id text,
  source_project_id text,
  customer_snapshot jsonb not null default '{}'::jsonb,
  project_snapshot jsonb not null default '{}'::jsonb,
  production_scope jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  document_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  contract_version text not null default '1.0.0',
  issued_at timestamptz not null default now(),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  completed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.elankav_ops_work_orders
  add column if not exists case_id uuid,
  add column if not exists case_number text,
  add column if not exists base_sequence text,
  add column if not exists quotation_id text,
  add column if not exists quotation_number text,
  add column if not exists lineage jsonb not null default '{}'::jsonb;

create unique index if not exists idx_elankav_ops_work_orders_number_unique
  on public.elankav_ops_work_orders(work_order_number);

do $$
begin
  alter table public.elankav_ops_work_orders
    add constraint fk_elankav_ops_work_orders_case
    foreign key (case_id) references public.elankav_master_cases(id);
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.elankav_ops_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_order_number text not null,
  case_id uuid not null references public.elankav_master_cases(id),
  case_number text not null,
  base_sequence text not null,
  quotation_id text,
  quotation_number text,
  lineage jsonb not null default '{}'::jsonb,
  platform_id text not null,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','ordered','partially_received','received','cancelled')),
  title text not null,
  source_type text not null default 'manual'
    check (source_type in ('manual','workOrder','quotation','purchaseRequest')),
  source_id text,
  source_work_order_id text,
  source_quotation_id text,
  source_purchase_request_id text,
  supplier_id text,
  supplier_snapshot jsonb not null default '{}'::jsonb,
  requester_snapshot jsonb not null default '{}'::jsonb,
  project_snapshot jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  approvals jsonb not null default '{}'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  document_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  contract_version text not null default '1.0.0',
  issued_at timestamptz not null default now(),
  required_by timestamptz,
  approved_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.elankav_ops_purchase_orders
  add column if not exists case_id uuid,
  add column if not exists case_number text,
  add column if not exists base_sequence text,
  add column if not exists quotation_id text,
  add column if not exists quotation_number text,
  add column if not exists lineage jsonb not null default '{}'::jsonb;

create unique index if not exists idx_elankav_ops_purchase_orders_number_unique
  on public.elankav_ops_purchase_orders(purchase_order_number);

do $$
begin
  alter table public.elankav_ops_purchase_orders
    add constraint fk_elankav_ops_purchase_orders_case
    foreign key (case_id) references public.elankav_master_cases(id);
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.elankav_ops_purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null
    references public.elankav_ops_purchase_orders(id) on delete cascade,
  received_by text,
  received_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.elankav_document_audit_events (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('work_order','purchase_order','master_case')),
  document_id text,
  case_id uuid references public.elankav_master_cases(id),
  platform_id text,
  actor_id text,
  actor_type text not null default 'user',
  action text not null,
  previous_status text,
  new_status text,
  comment text,
  created_at timestamptz not null default now()
);

create or replace function public.elankav_block_document_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'elankav_document_audit_events is immutable'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_elankav_document_audit_events_immutable
  on public.elankav_document_audit_events;
create trigger trg_elankav_document_audit_events_immutable
before update or delete on public.elankav_document_audit_events
for each row execute function public.elankav_block_document_audit_mutation();

create index if not exists idx_elankav_ops_work_orders_platform_status
  on public.elankav_ops_work_orders(platform_id, status, created_at desc);

create index if not exists idx_elankav_ops_work_orders_quotation
  on public.elankav_ops_work_orders(quotation_id);

create index if not exists idx_elankav_ops_work_orders_case_status
  on public.elankav_ops_work_orders(case_id, status, created_at desc);

create index if not exists idx_elankav_ops_work_orders_source
  on public.elankav_ops_work_orders(source_type, source_id);

create index if not exists idx_elankav_ops_purchase_orders_platform_status
  on public.elankav_ops_purchase_orders(platform_id, status, created_at desc);

create index if not exists idx_elankav_ops_purchase_orders_quotation
  on public.elankav_ops_purchase_orders(quotation_id);

create index if not exists idx_elankav_ops_purchase_orders_case_status
  on public.elankav_ops_purchase_orders(case_id, status, created_at desc);

create index if not exists idx_elankav_ops_purchase_orders_supplier
  on public.elankav_ops_purchase_orders(supplier_id, status, created_at desc);

create index if not exists idx_elankav_ops_purchase_receipts_order
  on public.elankav_ops_purchase_order_receipts(purchase_order_id, received_at desc);

create index if not exists idx_elankav_document_audit_case
  on public.elankav_document_audit_events(case_id, created_at desc);

create index if not exists idx_elankav_document_audit_document
  on public.elankav_document_audit_events(document_type, document_id, created_at desc);

-- Rollback manual documentado. No ejecutar automaticamente desde Codex.
-- Ejecutar en una ventana de mantenimiento y respaldar datos antes de revertir.
--
-- drop trigger if exists trg_elankav_document_audit_events_immutable
--   on public.elankav_document_audit_events;
-- drop function if exists public.elankav_block_document_audit_mutation();
-- drop index if exists public.idx_elankav_document_audit_document;
-- drop index if exists public.idx_elankav_document_audit_case;
-- drop index if exists public.idx_elankav_ops_purchase_receipts_order;
-- drop index if exists public.idx_elankav_ops_purchase_orders_supplier;
-- drop index if exists public.idx_elankav_ops_purchase_orders_case_status;
-- drop index if exists public.idx_elankav_ops_purchase_orders_quotation;
-- drop index if exists public.idx_elankav_ops_purchase_orders_platform_status;
-- drop index if exists public.idx_elankav_ops_work_orders_source;
-- drop index if exists public.idx_elankav_ops_work_orders_case_status;
-- drop index if exists public.idx_elankav_ops_work_orders_quotation;
-- drop index if exists public.idx_elankav_ops_work_orders_platform_status;
-- drop table if exists public.elankav_document_audit_events;
-- drop table if exists public.elankav_ops_purchase_order_receipts;
-- alter table public.elankav_ops_purchase_orders
--   drop constraint if exists fk_elankav_ops_purchase_orders_case;
-- alter table public.elankav_ops_work_orders
--   drop constraint if exists fk_elankav_ops_work_orders_case;
-- drop index if exists public.idx_elankav_ops_purchase_orders_number_unique;
-- drop index if exists public.idx_elankav_ops_work_orders_number_unique;
-- alter table public.elankav_ops_purchase_orders
--   drop column if exists lineage,
--   drop column if exists quotation_number,
--   drop column if exists quotation_id,
--   drop column if exists base_sequence,
--   drop column if exists case_number,
--   drop column if exists case_id;
-- alter table public.elankav_ops_work_orders
--   drop column if exists lineage,
--   drop column if exists quotation_number,
--   drop column if exists quotation_id,
--   drop column if exists base_sequence,
--   drop column if exists case_number,
--   drop column if exists case_id;
-- drop function if exists public.elankav_reserve_document_suffix(uuid, text);
-- drop table if exists public.elankav_document_lineage_counters;
-- drop index if exists public.idx_elankav_master_cases_quotation;
-- drop index if exists public.idx_elankav_master_cases_platform_type;
-- drop index if exists public.idx_elankav_master_cases_platform_status;
-- drop index if exists public.idx_elankav_master_cases_number_unique;
-- drop table if exists public.elankav_master_cases;
-- drop function if exists public.elankav_reserve_master_base_sequence(text);
-- drop table if exists public.elankav_master_case_counters;
