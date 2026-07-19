-- ERP-RECEIPTS-01
-- Migración propuesta. No aplicar automáticamente en producción.
-- Separa pagos de clientes de elankav_project_receipts, que conserva comprobantes de proyecto/proveedor.

begin;

create table if not exists public.elankav_customer_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique,
  quotation_id uuid not null references public.elankav_quotations(id) on delete restrict,
  project_id uuid not null references public.elankav_projects(id) on delete restrict,
  customer_id text not null,
  executive_id text not null,

  status text not null default 'confirmed'
    check (status in ('draft','confirmed','cancelled','refunded')),
  concept text not null default 'Anticipo de cotización',
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('USD','NIO')),
  payment_method text not null
    check (payment_method in ('cash','transfer','deposit','card','other')),
  payment_reference text,
  paid_at timestamptz not null,
  notes text,

  quotation_total numeric(14,2) not null check (quotation_total >= 0),
  previous_paid numeric(14,2) not null default 0 check (previous_paid >= 0),
  total_paid numeric(14,2) not null default 0 check (total_paid >= 0),
  pending_balance numeric(14,2) not null default 0 check (pending_balance >= 0),
  required_deposit_percentage numeric(7,4) not null
    check (required_deposit_percentage > 0 and required_deposit_percentage <= 100),
  required_deposit_amount numeric(14,2) not null check (required_deposit_amount >= 0),
  deposit_completed boolean not null default false,

  customer_snapshot jsonb not null default '{}'::jsonb,
  executive_snapshot jsonb not null default '{}'::jsonb,
  payment_terms_snapshot jsonb not null default '{}'::jsonb,
  document_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  confirmed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_elankav_customer_payments_project
  on public.elankav_customer_payments(project_id, paid_at desc);
create index if not exists idx_elankav_customer_payments_quotation
  on public.elankav_customer_payments(quotation_id, paid_at desc);
create index if not exists idx_elankav_customer_payments_customer
  on public.elankav_customer_payments(customer_id, paid_at desc);
create index if not exists idx_elankav_customer_payments_status
  on public.elankav_customer_payments(status, paid_at desc);

-- La reserva transaccional del número REC se agregará al activar esta migración,
-- siguiendo el mismo patrón utilizado por el número de proyecto.
-- RLS y permisos se definirán en una migración separada con identidades confirmadas.

commit;
