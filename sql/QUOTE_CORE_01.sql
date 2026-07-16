-- QUOTE-CORE-01
-- Esquema nuevo. No migra ni reutiliza tablas del cotizador anterior.
-- Fuente oficial: Supabase.

begin;

create extension if not exists pgcrypto;

create table if not exists public.elankav_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text unique,
  platform_id text not null,
  source_type text not null check (source_type in ('design','store','manual')),
  source_id text,
  design_mode text not null default 'optional'
    check (design_mode in ('required','optional','not_required')),

  -- Identificadores externos oficiales. CRM y ejecutivos no se fuerzan a UUID.
  customer_id text not null,
  executive_id text not null,

  status text not null default 'draft'
    check (status in (
      'draft','quoted','sent','viewed','approved','awaiting_deposit',
      'deposit_confirmed','rejected','expired','cancelled'
    )),

  public_token uuid not null default gen_random_uuid() unique,
  public_url text,

  customer_snapshot jsonb not null default '{}'::jsonb,
  executive_snapshot jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  payment_terms jsonb not null default '{}'::jsonb,
  relations jsonb not null default '{}'::jsonb,
  brand_snapshot jsonb not null default '{}'::jsonb,
  template_snapshot jsonb not null default '{}'::jsonb,
  contract_version text not null default '1.0.0',

  -- Campos indexables y consultables sin interpretar JSON.
  subtotal_usd numeric(14,2) not null default 0,
  discount_usd numeric(14,2) not null default 0,
  tax_usd numeric(14,2) not null default 0,
  total_usd numeric(14,2) not null default 0,
  exchange_rate numeric(14,6) not null default 0,
  payable_total_nio numeric(14,2) not null default 0,

  sent_at timestamptz,
  viewed_at timestamptz,
  issued_at timestamptz,
  valid_until timestamptz,
  deposit_confirmed_at timestamptz,
  deposit_reference text,

  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (jsonb_typeof(items) = 'array'),
  check (subtotal_usd >= 0),
  check (discount_usd >= 0),
  check (tax_usd >= 0),
  check (total_usd >= 0),
  check (exchange_rate >= 0),
  check (payable_total_nio >= 0)
);

create table if not exists public.elankav_projects (
  id uuid primary key default gen_random_uuid(),
  project_number text unique,
  quotation_id uuid not null unique
    references public.elankav_quotations(id) on delete restrict,
  platform_id text not null,
  customer_id text not null,
  executive_id text not null,
  title text,
  customer_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending_activation'
    check (status in (
      'pending_activation','active','design','work_order_ready',
      'production','installation','completed','cancelled'
    )),
  current_stage text not null default 'quotation',
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  source jsonb not null default '{}'::jsonb,
  relations jsonb not null default '{}'::jsonb,
  expected_delivery_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_quotation_follow_ups (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null unique
    references public.elankav_quotations(id) on delete cascade,
  owner_executive_id text,
  action_type text not null default 'note',
  next_action text,
  notes text,
  last_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  completed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.elankav_projects(id) on delete cascade,
  quotation_id uuid references public.elankav_quotations(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'user',
  actor_user_id text,
  actor_executive_id text,
  actor_role text,
  platform_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (project_id is not null or quotation_id is not null)
);

create table if not exists public.elankav_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text unique,
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  quotation_id uuid not null references public.elankav_quotations(id) on delete restrict,
  generated_by text not null,
  generated_by_role text not null,
  status text not null default 'pending'
    check (status in ('pending','scheduled','in_progress','paused','completed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, quotation_id)
);

create table if not exists public.elankav_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_order_number text unique,
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  supplier_id text,
  generated_by text not null,
  status text not null default 'draft'
    check (status in (
      'draft','pending_approval','approved','ordered','partially_received',
      'received','cancelled'
    )),
  blocks_production boolean not null default true,
  expected_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_project_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  purchase_order_id uuid references public.elankav_purchase_orders(id) on delete set null,
  supplier_id text,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  amount numeric(14,2),
  currency text check (currency is null or currency in ('USD','NIO')),
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (amount is null or amount >= 0)
);

create index if not exists idx_elankav_quotations_platform
  on public.elankav_quotations(platform_id);
create index if not exists idx_elankav_quotations_customer
  on public.elankav_quotations(customer_id);
create index if not exists idx_elankav_quotations_executive
  on public.elankav_quotations(executive_id);
create index if not exists idx_elankav_quotations_status
  on public.elankav_quotations(status);
create index if not exists idx_elankav_quotations_followup_base
  on public.elankav_quotations(status, updated_at desc);

create index if not exists idx_elankav_projects_status
  on public.elankav_projects(status);
create index if not exists idx_elankav_projects_customer
  on public.elankav_projects(customer_id);
create index if not exists idx_elankav_projects_executive
  on public.elankav_projects(executive_id);
create index if not exists idx_elankav_projects_delivery
  on public.elankav_projects(expected_delivery_at)
  where status not in ('completed','cancelled');

create index if not exists idx_elankav_followups_next
  on public.elankav_quotation_follow_ups(next_follow_up_at)
  where completed_at is null;
create index if not exists idx_elankav_project_events_project
  on public.elankav_project_events(project_id, occurred_at desc);
create index if not exists idx_elankav_project_events_quotation
  on public.elankav_project_events(quotation_id, occurred_at desc);
create index if not exists idx_elankav_work_orders_project_status
  on public.elankav_work_orders(project_id, status);
create index if not exists idx_elankav_purchase_orders_project_status
  on public.elankav_purchase_orders(project_id, status);
create index if not exists idx_elankav_receipts_project
  on public.elankav_project_receipts(project_id, uploaded_at desc);

-- RLS se habilitará en una migración separada cuando se confirmen los IDs oficiales
-- de usuarios, ejecutivos, administradores y Service Role. No aplicar políticas
-- genéricas que puedan bloquear el Orchestrator o exponer datos entre ejecutivos.

commit;
