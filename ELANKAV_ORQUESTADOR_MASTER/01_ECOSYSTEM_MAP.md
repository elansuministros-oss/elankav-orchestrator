# ELANKAV — Mapa oficial del ecosistema

Última actualización: 2026-08-02

## Flujo conversacional oficial

```text
Cliente WhatsApp
    ↓
WAHA
    ↓ webhook /webhook/inbound
ELANKAV Orchestrator
    ↓ POST /api/v1/conversations/events
ELANKAV CONNECT
    ↓
Supabase
    ├── crm_conversations
    └── crm_messages
    ↓
Conversation Hub
https://connect.elankav.com/console/conversations
```

## Responsabilidades

### WAHA
- Recibir y enviar mensajes de WhatsApp.
- Descargar y entregar medios.
- Mantener la sesión `ELANKAV`.

### ELANKAV Orchestrator
- Procesar mensajes de texto y audio.
- Ejecutar ELAN IA.
- Publicar eventos `inbound` y `outbound` hacia CONNECT.
- Enviar respuestas por WAHA.
- No escribir directamente en las tablas CRM de Supabase.

### ELANKAV CONNECT
- Ser el CRM maestro de conversaciones.
- Autenticar eventos internos del Orchestrator.
- Persistir conversaciones y mensajes en Supabase.
- Exponer lista, historial, asignación y envío desde Conversation Hub.

### Supabase
- Persistencia oficial mediante `crm_conversations` y `crm_messages`.
- Protección mediante RLS y acceso de servicio.

## Regla arquitectónica

CONNECT es la fuente oficial de conversaciones. La interfaz no se conecta directamente a WAHA y Orchestrator no escribe directamente en las tablas CRM.
