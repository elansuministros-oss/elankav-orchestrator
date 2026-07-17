-- WO-01 + PO-01 base operativa.
-- Migracion preparada para Supabase. No ejecutar automaticamente desde Codex.

create sequence if not exists public.elankav_ops_work_order_number_seq;
create sequence if not exists public.elankav_ops_purchase_order_number_seq;

create or replace function public.elankav_next_work_order_number()
returns text
language plpgsql
as $$
begin
  return 'WO-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.elankav_ops_work_order_number_seq')::text, 6, '0');
end;
$$;

create or replace function public.elankav_next_purchase_order_number()
returns text
language plpgsql
as $$
begin
  return 'PO-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.elankav_ops_purchase_order_number_seq')::text, 6, '0');
end;
$$;

create table if not exists public.elankav_ops_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text unique,
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

create or replace function public.elankav_ops_work_orders_number_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.work_order_number is null or btrim(new.work_order_number) = '' then
    new.work_order_number := public.elankav_next_work_order_number();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_elankav_ops_work_orders_number on public.elankav_ops_work_orders;
create trigger trg_elankav_ops_work_orders_number
before insert on public.elankav_ops_work_orders
for each row execute function public.elankav_ops_work_orders_number_trigger();

create table if not exists public.elankav_ops_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_order_number text unique,
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

create or replace function public.elankav_ops_purchase_orders_number_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.purchase_order_number is null or btrim(new.purchase_order_number) = '' then
    new.purchase_order_number := public.elankav_next_purchase_order_number();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_elankav_ops_purchase_orders_number on public.elankav_ops_purchase_orders;
create trigger trg_elankav_ops_purchase_orders_number
before insert on public.elankav_ops_purchase_orders
for each row execute function public.elankav_ops_purchase_orders_number_trigger();

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

create index if not exists idx_elankav_ops_work_orders_platform_status
  on public.elankav_ops_work_orders(platform_id, status, created_at desc);

create index if not exists idx_elankav_ops_work_orders_source
  on public.elankav_ops_work_orders(source_type, source_id);

create index if not exists idx_elankav_ops_purchase_orders_platform_status
  on public.elankav_ops_purchase_orders(platform_id, status, created_at desc);

create index if not exists idx_elankav_ops_purchase_orders_supplier
  on public.elankav_ops_purchase_orders(supplier_id, status, created_at desc);

create index if not exists idx_elankav_ops_purchase_receipts_order
  on public.elankav_ops_purchase_order_receipts(purchase_order_id, received_at desc);
