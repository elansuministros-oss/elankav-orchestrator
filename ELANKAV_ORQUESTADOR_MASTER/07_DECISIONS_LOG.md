# ELANKAV — Registro de decisiones técnicas

## ADR-2026-08-02 — CONNECT como CRM maestro de conversaciones

Estado: ACEPTADA Y ACTIVA EN PRODUCCIÓN

### Contexto

La bandeja de conversaciones de CONNECT existía, pero utilizaba una fuente pendiente y no persistía mensajes reales de WhatsApp. El flujo de voz V2 procesaba y respondía mensajes, pero no publicaba los eventos hacia CONNECT.

### Decisión

1. CONNECT es la fuente oficial de conversaciones del ecosistema ELANKAV.
2. WAHA recibe y entrega mensajes, pero no se conecta directamente con la interfaz CRM.
3. Orchestrator procesa los mensajes y publica eventos hacia CONNECT mediante `POST /api/v1/conversations/events`.
4. CONNECT persiste conversaciones y mensajes en Supabase.
5. Las tablas oficiales son `crm_conversations` y `crm_messages`.
6. Toda entrada y salida debe persistirse con dirección `inbound` u `outbound`.
7. `externalMessageId` se utiliza como clave de idempotencia para impedir duplicados.
8. La comunicación interna utiliza `CONNECT_INTERNAL_TOKEN` y `ORCHESTRATOR_INTERNAL_TOKEN`.
9. Ningún servicio debe escribir directamente en las tablas CRM fuera del repositorio oficial de CONNECT.

### Consecuencias

- Conversation Hub muestra historial real de WhatsApp.
- Los pipelines de texto y voz deben publicar eventos inbound y outbound.
- Cualquier nuevo canal debe integrarse mediante el mismo contrato de CONNECT.
- Los errores del adaptador de contexto comercial heredado no deben confundirse con la persistencia de conversaciones.

### Evidencia de producción

- Evento controlado: `HTTP 201 Created`.
- Conversación creada en `crm_conversations`.
- Mensaje creado en `crm_messages`.
- Mensajes reales inbound y outbound visibles en Conversation Hub.
- Servicios `elankav-connect` y `elankav-orchestrator` activos.

### Commits relacionados

```text
CONNECT
7f213b6 feat(connect): enable real WhatsApp conversation inbox

ORCHESTRATOR
aa817ed feat(orchestrator): bridge WhatsApp conversations with CONNECT
7876df5 fix(orchestrator): persist WhatsApp outbound message id
```

### Regla de mantenimiento

No rediseñar ni sustituir este flujo con una arquitectura paralela. Cualquier cambio debe conservar la separación WAHA → Orchestrator → CONNECT → Supabase.
