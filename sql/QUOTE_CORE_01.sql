-- QUOTE-CORE-01
-- Esquema nuevo. No migra ni reutiliza tablas del cotizador anterior.

create extension if not exists pgcrypto;

create table if not exists public.elankav_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text unique,
  platform_id text not null,
  source_type text not null check (source_type in ('design','store','manual')),
  source_id text,
  design_mode text not null default 'optional' check (design_mode in ('required','optional','not_required')),
  customer_id uuid not null,
  executive_id uuid not null,
  status text not null default 'draft' check (status in ('draft','quoted','sent','viewed','approved','awaiting_deposit','deposit_confirmed','rejected','expired','cancelled')),
  public_token uuid not null default gen_random_uuid() unique,
  public_url text,
  customer_snapshot jsonb not null default '{}'::jsonb,
  executive_snapshot jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  payment_terms jsonb not null default '{}'::jsonb,
  brand_snapshot jsonb not null default '{}'::jsonb,
  template_snapshot jsonb not null default '{}'::jsonb,
  issued_at timestamptz,
  valid_until timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_projects (
  id uuid primary key default gen_random_uuid(),
  project_number text unique,
  quotation_id uuid not null unique references public.elankav_quotations(id) on delete restrict,
  platform_id text not null,
  customer_id uuid not null,
  executive_id uuid not null,
  status text not null default 'pending_activation' check (status in ('pending_activation','active','design','work_order_ready','production','installation','completed','cancelled')),
  current_stage text not null default 'quotation',
  priority text not null default 'normal',
  expected_delivery_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_quotation_follow_ups (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.elankav_quotations(id) on delete cascade,
  owner_executive_id uuid not null,
  action_type text not null default 'note',
  notes text,
  last_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.elankav_project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.elankav_projects(id) on delete cascade,
  quotation_id uuid references public.elankav_quotations(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'user',
  actor_id text,
  actor_role text,
  platform_id text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (project_id is not null or quotation_id is not null)
);

create table if not exists public.elankav_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text unique,
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  quotation_id uuid not null references public.elankav_quotations(id) on delete restrict,
  generated_by uuid not null,
  generated_by_role text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_order_number text unique,
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  supplier_id uuid,
  generated_by uuid not null,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elankav_project_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  purchase_order_id uuid references public.elankav_purchase_orders(id) on delete set null,
  supplier_id uuid,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  amount numeric(14,2),
  currency text,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_elankav_quotations_customer on public.elankav_quotations(customer_id);
create index if not exists idx_elankav_quotations_executive on public.elankav_quotations(executive_id);
create index if not exists idx_elankav_quotations_status on public.elankav_quotations(status);
create index if not exists idx_elankav_projects_status on public.elankav_projects(status);
create index if not exists idx_elankav_projects_customer on public.elankav_projects(customer_id);
create index if not exists idx_elankav_followups_next on public.elankav_quotation_follow_ups(next_follow_up_at) where completed_at is null;
create index if not exists idx_elankav_project_events_project on public.elankav_project_events(project_id, occurred_at desc);

-- RLS se activará cuando se conecten los identificadores oficiales de usuarios,
-- ejecutivos y administradores. No aplicar políticas genéricas antes de esa auditoría.
