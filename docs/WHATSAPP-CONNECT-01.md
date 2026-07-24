# WHATSAPP-CONNECT-01

## Objetivo

Sincronizar mensajes entrantes de WhatsApp con ELANKAV CONNECT sin interrumpir la respuesta existente de ELAN AI.

## Flujo

WAHA → Core → Orchestrator `/api/messages` → ELAN AI → CONNECT Lead/Opportunity → WAHA

## Reglas

- Owner Mode nunca crea Lead.
- Solo aplica al canal `whatsapp`.
- El teléfono se normaliza antes de buscar.
- Se reutiliza el Lead existente por teléfono y plataforma.
- Se reutiliza la Opportunity existente por `leadId`.
- El primer mensaje crea Lead en estado `new` y Opportunity en etapa `discovery`.
- Una falla de CONNECT no bloquea la respuesta al cliente.
- CONNECT puede configurarse con `ELANKAV_CONNECT_URL`; el fallback es `https://elankav-connect.vercel.app`.

## Validación requerida antes de producción

1. Tests y build.
2. Deploy controlado del Orchestrator.
3. Mensaje real desde un número externo.
4. Confirmar respuesta por WAHA.
5. Confirmar Lead y Opportunity únicos en CONNECT.
6. Enviar segundo mensaje y confirmar que no se duplican.
