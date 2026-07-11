# CRM-001 — ELANKAV CRM Core

## Estado

Fundación implementada. No conectada todavía al webhook de producción.

## Objetivo

Crear el CRM central del ecosistema ELANKAV como punto de entrada, organización y distribución de identidades, conversaciones y mensajes para todas las plataformas.

## Principios

- Supabase es la fuente oficial.
- No se reutiliza el CRM antiguo de ELANVISUAL.
- Una identidad canónica puede tener múltiples aliases, roles, empresas y plataformas.
- No se duplica una persona por cada plataforma.
- LID, teléfono, email y futuros IDs de canal son aliases externos, no claves primarias del negocio.
- Ninguna UI escribe directamente en Supabase; debe pasar por Adapter y Service.

## Arquitectura

```text
Canal / WhatsApp / Web / Email
↓
Identity Service
↓
CRM Core
↓
Contacto / empresa / roles / plataformas
↓
Conversación
↓
Mensajes
↓
Sales Engine / Cotizador / Pagos / Producción
```

## Esquema inicial

- `crm_identities`
- `crm_identity_aliases`
- `crm_roles`
- `crm_organizations`
- `crm_identity_organizations`
- `crm_conversations`
- `crm_messages`

## Archivos

- `supabase/migrations/20260711_crm_core_001.sql`
- `adapters/crmSupabaseAdapter.js`
- `services/crmCoreService.js`
- `crm-core/ACCESS_MATRIX.md`

## Responsabilidades

### Identity Service

Resuelve aliases externos y entrega identidad canónica.

### CRM Core

Registra identidad, organización, roles, conversación, plataforma, canal y mensajes.

### Sales Engine

Lee y actualiza etapa comercial, pero no administra directamente identidades.

## Estado de integración

Todavía no conectado a:

- WAHA / WhatsApp Bridge.
- OpenAI.
- Commercial Library.
- Cotizador.
- Pagos.
- Producción.
- UI.

## Próximo movimiento

1. Aplicar migración en Supabase.
2. Validar variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Hacer prueba controlada de identidad, conversación y mensaje.
4. Conectar WhatsApp en modo escritura paralela sin alterar respuestas.
5. Validar persistencia real.
6. Solo después reemplazar y eliminar el CRM viejo de ELANVISUAL.

## Contrato de continuidad

Todo mensaje futuro debe entrar primero al CRM Core y luego distribuirse por plataforma. Ninguna plataforma mantiene un CRM independiente como fuente oficial.
