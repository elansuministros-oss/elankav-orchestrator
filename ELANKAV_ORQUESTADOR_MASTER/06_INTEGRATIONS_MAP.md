# ELANKAV — Mapa de integraciones

Última actualización: 2026-08-02

## Integración CRM conversacional

### Flujo de entrada

```text
WhatsApp → WAHA → POST /webhook/inbound → Orchestrator
→ POST http://127.0.0.1:4400/api/v1/conversations/events
→ CONNECT → Supabase → Conversation Hub
```

### Flujo de salida de ELAN IA

```text
Orchestrator → WAHA → WhatsApp
            ↘ CONNECT → crm_messages (outbound)
```

### Flujo de salida desde CONNECT

```text
Conversation Hub → CONNECT → Orchestrator → WAHA → WhatsApp
```

## Contrato Orchestrator → CONNECT

Endpoint:

```text
POST /api/v1/conversations/events
```

Autenticación:

```text
Authorization: Bearer <CONNECT_INTERNAL_TOKEN>
X-Elankav-Platform: ORCHESTRATOR
Content-Type: application/json
```

Campos mínimos:

```text
platform
channel
externalUserId
phone
chatId
direction
text
messageType
externalMessageId
actorType
actorName
metadata
```

`externalMessageId` es obligatorio para garantizar idempotencia. Para mensajes salientes se debe usar primero el ID devuelto por WAHA; si no existe, se debe generar una clave única controlada.

## Variables oficiales

### Orchestrator

```text
ELANKAV_CONNECT_URL=http://127.0.0.1:4400
CONNECT_INTERNAL_TOKEN
ORCHESTRATOR_INTERNAL_TOKEN
WAHA_BASE_URL=http://127.0.0.1:3000
WAHA_SESSION=ELANKAV
```

### CONNECT

```text
BUSINESS_PERSISTENCE=supabase
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CONNECT_INTERNAL_TOKEN
ORCHESTRATOR_INTERNAL_TOKEN
ORCHESTRATOR_URL=<URL interna del Orchestrator>
```

Los tokens internos deben coincidir en ambos servicios. No documentar valores secretos.

## Servicios de producción

```text
elankav-orchestrator.service
  WorkingDirectory=/opt/elankav/orchestrator
  ExecStart=/usr/bin/node /opt/elankav/orchestrator/server.voice-pipeline-v2.js

elankav-connect.service
  WorkingDirectory=/opt/elankav/connect
  ExecStart=/usr/bin/npm start
```

## Validación operativa

1. `systemctl is-active elankav-connect`
2. `systemctl is-active elankav-orchestrator`
3. `curl http://127.0.0.1:4400/health`
4. Publicar un evento controlado y confirmar `HTTP 201 Created`.
5. Confirmar registros en `crm_conversations` y `crm_messages`.
6. Confirmar historial inbound/outbound en Conversation Hub.
