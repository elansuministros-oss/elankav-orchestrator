begin;

create table if not exists public.commercial_conversation_states (
  conversation_key text primary key,
  platform text not null,
  channel text not null,
  external_user_id text,
  phone_hash text,
  active_item_id text,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists commercial_conversation_states_lookup_idx
  on public.commercial_conversation_states (platform, channel, external_user_id);

create index if not exists commercial_conversation_states_phone_idx
  on public.commercial_conversation_states (platform, channel, phone_hash);

create index if not exists commercial_conversation_states_expiry_idx
  on public.commercial_conversation_states (expires_at);

alter table public.commercial_conversation_states enable row level security;
revoke all on table public.commercial_conversation_states from anon, authenticated;
grant select, insert, update on table public.commercial_conversation_states to service_role;

commit;
