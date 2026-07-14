-- PROG-001C — Persistencia durable del Job Engine
-- Fuente oficial: Supabase. Acceso exclusivo mediante clave secreta de servidor.

create table if not exists public.orchestrator_jobs (
  id text primary key,
  type text not null check (type in ('code', 'context_sync')),
  platform text not null,
  task text not null,
  branch text,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  constraint orchestrator_jobs_id_format
    check (id ~ '^JOB-[0-9]+-[a-z0-9]+$')
);

create index if not exists idx_orchestrator_jobs_created_at
  on public.orchestrator_jobs (created_at desc);

create index if not exists idx_orchestrator_jobs_status
  on public.orchestrator_jobs (status, created_at desc);

alter table public.orchestrator_jobs enable row level security;

revoke all on table public.orchestrator_jobs from anon, authenticated;
grant all on table public.orchestrator_jobs to service_role;
