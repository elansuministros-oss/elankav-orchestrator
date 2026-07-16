begin;

insert into public.commercial_products (
  product_id,
  platform_id,
  version,
  status,
  name,
  description,
  aliases,
  specifications,
  price_offers,
  sales_guidance,
  commercial_rules,
  updated_at
) values (
  'JALAVISTA_DOBLE',
  'ELANVISUAL',
  '1.0.0',
  'active',
  'Rótulo jala vista doble cara en acrílico',
  'Rótulo jala vista doble cara para uso comercial.',
  '["jala vista","jalavista","doble cara","rotulo acrilico de anuncio","rotulo acrilico estilo boton"]'::jsonb,
  '{
    "standardDimensions": {"widthCm": 60, "heightCm": 60},
    "materials": ["acrílico"],
    "finishes": [],
    "lighting": []
  }'::jsonb,
  '{
    "advertised": {"amount": 260, "currency": "USD"}
  }'::jsonb,
  '{
    "faq": [
      {
        "patterns": ["que medida tiene", "cual es la medida"],
        "answer": "El modelo anunciado mide 60 × 60 cm y tiene un valor de USD 260."
      }
    ]
  }'::jsonb,
  '{
    "pricingRule": {
      "type": "dimension-step",
      "stepCm": 10,
      "incrementUsd": 15,
      "minimumPriceUsd": 260,
      "roundMode": "ceil",
      "dimensions": ["width", "height"]
    }
  }'::jsonb,
  now()
)
on conflict (product_id) do update set
  platform_id = excluded.platform_id,
  version = excluded.version,
  status = excluded.status,
  name = excluded.name,
  description = excluded.description,
  aliases = excluded.aliases,
  specifications = excluded.specifications,
  price_offers = excluded.price_offers,
  sales_guidance = excluded.sales_guidance,
  commercial_rules = excluded.commercial_rules,
  updated_at = now();

commit;
