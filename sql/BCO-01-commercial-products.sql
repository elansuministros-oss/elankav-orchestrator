begin;

create extension if not exists pgcrypto;

create table if not exists public.commercial_products (
  id uuid primary key default gen_random_uuid()
);

alter table public.commercial_products
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists platform_id text,
  add column if not exists product_code text,
  add column if not exists product_name text,
  add column if not exists category text,
  add column if not exists aliases jsonb not null default '[]'::jsonb,
  add column if not exists standard_width_cm numeric,
  add column if not exists standard_height_cm numeric,
  add column if not exists advertised_price_usd numeric,
  add column if not exists pricing_model text,
  add column if not exists pricing_rules jsonb not null default '{}'::jsonb,
  add column if not exists materials jsonb not null default '[]'::jsonb,
  add column if not exists finishes jsonb not null default '[]'::jsonb,
  add column if not exists lighting jsonb not null default '[]'::jsonb,
  add column if not exists description text,
  add column if not exists faq jsonb not null default '[]'::jsonb,
  add column if not exists production_time jsonb,
  add column if not exists installation jsonb,
  add column if not exists warranty jsonb,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.commercial_products
set id = gen_random_uuid()
where id is null;

alter table public.commercial_products
  alter column id set default gen_random_uuid(),
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commercial_products'::regclass
      and contype = 'p'
  ) then
    alter table public.commercial_products
      add constraint commercial_products_pkey primary key (id);
  end if;
end $$;

create unique index if not exists commercial_products_platform_code_uidx
  on public.commercial_products (platform_id, product_code);

create index if not exists commercial_products_platform_active_idx
  on public.commercial_products (platform_id, active);

insert into public.commercial_products (
  platform_id,
  product_code,
  product_name,
  category,
  aliases,
  standard_width_cm,
  standard_height_cm,
  advertised_price_usd,
  pricing_model,
  pricing_rules,
  materials,
  faq,
  active
) values (
  'ELANVISUAL',
  'JALAVISTA_DOBLE',
  'Rótulo jala vista doble cara en acrílico',
  'Rótulos jala vista',
  '["jala vista","jalavista","doble cara","rotulo acrilico de anuncio","rotulo acrilico estilo boton"]'::jsonb,
  60,
  60,
  260,
  'dimension-step',
  '{"type":"dimension-step","stepCm":10,"incrementUsd":15,"minimumPriceUsd":260,"roundMode":"ceil","dimensions":["width","height"]}'::jsonb,
  '["acrílico"]'::jsonb,
  '[{"patterns":["que medida tiene","cual es la medida"],"answer":"El modelo anunciado mide 60 × 60 cm y tiene un valor de USD 260."}]'::jsonb,
  true
)
on conflict (platform_id, product_code) do update set
  product_name = excluded.product_name,
  category = excluded.category,
  aliases = excluded.aliases,
  standard_width_cm = excluded.standard_width_cm,
  standard_height_cm = excluded.standard_height_cm,
  advertised_price_usd = excluded.advertised_price_usd,
  pricing_model = excluded.pricing_model,
  pricing_rules = excluded.pricing_rules,
  materials = excluded.materials,
  faq = excluded.faq,
  active = excluded.active,
  updated_at = now();

commit;
