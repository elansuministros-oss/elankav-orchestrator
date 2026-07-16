begin;

create table if not exists public.commercial_products (
  id uuid primary key default gen_random_uuid(),
  platform_id text not null,
  product_code text not null,
  product_name text not null,
  category text,
  aliases jsonb not null default '[]'::jsonb,
  standard_width_cm numeric,
  standard_height_cm numeric,
  advertised_price_usd numeric,
  pricing_model text,
  pricing_rules jsonb not null default '{}'::jsonb,
  materials jsonb not null default '[]'::jsonb,
  finishes jsonb not null default '[]'::jsonb,
  lighting jsonb not null default '[]'::jsonb,
  description text,
  faq jsonb not null default '[]'::jsonb,
  production_time jsonb,
  installation jsonb,
  warranty jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_id, product_code)
);

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
