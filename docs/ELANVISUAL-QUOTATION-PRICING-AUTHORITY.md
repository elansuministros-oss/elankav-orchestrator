# ELANVISUAL — Pricing y cotización natural

## Autoridad

ELAN no mantiene un listado estático de servicios ni precios en Orchestrator o Langflow.

La autoridad automática es CONNECT:

```text
commercial_products
```

El runtime consulta:

- `POST /api/v1/business/vqs/pricing/resolve` para calcular un servicio.
- `GET /api/v1/business/vqs/pricing/catalog` para consultar/listar servicios y tarifas publicadas.

## Crecimiento

Cuando se aprueba y publica un nuevo servicio en CONNECT, queda disponible para el mismo flujo de pricing sin agregar un nuevo comando o un nuevo bloque de código en Orchestrator.

Knowledge/Biblioteca puede conservar borradores, evidencia y productos pendientes de revisión. Solo `commercial_products` publicado gobierna el precio automático.

## Cotización Owner

```text
Mensaje natural
→ parse/intención de cotización
→ cliente activo
→ requisitos mínimos
→ CONNECT pricing
→ commercial_products
→ cálculo
→ documento VQS
→ CONNECT quotation
```

La cotización guarda en el ítem y en pricing:

- `source = COMMERCIAL_PRODUCTS`
- `authority = CONNECT_COMMERCIAL_PRODUCTS`
- regla de coincidencia cuando aplica.

Si el Owner dicta un precio final explícito, la fuente queda `OWNER_EXPLICIT_PRICE`.

## Regla

Langflow puede interpretar la conversación, pero nunca se convierte en autoridad de precio. Los precios se leen de CONNECT y la creación real de la cotización permanece en Orchestrator/VQS.
