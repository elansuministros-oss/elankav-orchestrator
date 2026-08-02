## 2026-08-02 — CONNECT-CONVERSATIONS-LIVE-01

Proyecto:
ELANKAV ORCHESTRATOR + ELANKAV CONNECT

Movimiento:
Integración oficial de conversaciones WhatsApp en CONNECT.

Cambios:
- Se activó el flujo WAHA → Orchestrator → CONNECT → Supabase.
- CONNECT pasó a ser el CRM maestro de conversaciones.
- Se crearon y activaron `crm_conversations` y `crm_messages`.
- Se habilitó persistencia de mensajes inbound y outbound.
- Se incorporó autenticación interna mediante `CONNECT_INTERNAL_TOKEN` y `ORCHESTRATOR_INTERNAL_TOKEN`.
- Se conectó Conversation Hub con conversaciones e historial reales.
- Se corrigió Voice Pipeline V2 para publicar eventos hacia CONNECT.
- Se corrigió la persistencia del `externalMessageId` de mensajes salientes.
- Se confirmó protección contra duplicados mediante identificador externo único.

Commits de producción:
- CONNECT: `7f213b6` — `feat(connect): enable real WhatsApp conversation inbox`
- ORCHESTRATOR: `aa817ed` — `feat(orchestrator): bridge WhatsApp conversations with CONNECT`
- ORCHESTRATOR: `7876df5` — `fix(orchestrator): persist WhatsApp outbound message id`

QA:
- Typecheck CONNECT: OK.
- Tests CONNECT: 222 aprobados.
- Build CONNECT: OK.
- Tests Orchestrator: 403 aprobados.
- Node syntax checks: OK.
- Evento interno controlado: HTTP 201 Created.
- Persistencia Supabase: OK.
- Historial inbound: OK.
- Historial outbound: OK.
- Conversation Hub: operativo en producción.

Servicios:
- `elankav-connect.service`: active.
- `elankav-orchestrator.service`: active.

Incidencia principal:
Voice Pipeline V2 procesaba y respondía audios, pero no persistía los eventos en CONNECT. Posteriormente el outbound era rechazado con `VALIDATION_ERROR` por no incluir un `externalMessageId` válido.

Resolución:
Se integró `publishConversationEventSafely()` en los pipelines activos y se utilizó el identificador devuelto por WAHA, con fallback único controlado.

Estado:
COMPLETADO EN PRODUCCIÓN

---

## 2026-07-10 — ORCH-002

Proyecto:
ELANKAV ORCHESTRATOR

Movimiento:
Dashboard Ejecutivo V1

Cambios:
- Se reemplazó la página técnica inicial por un dashboard responsive.
- Se registraron seis servicios del ecosistema.
- Se agregó información básica del VPS y proceso Node.js.
- Se agregó endpoint /api/projects.
- Se amplió el endpoint de salud.
- Se validó funcionamiento desde computadora y celular.

Archivos modificados:
- server.js
- ELANKAV_ORQUESTADOR_MASTER/02_CURRENT_STATE.md
- ELANKAV_ORQUESTADOR_MASTER/08_CHANGELOG_MASTER.md
- ELANKAV_ORQUESTADOR_MASTER/modules/INFRAESTRUCTURA.md

Build:
Validación de sintaxis Node.js OK

QA:
- Servicio systemd activo.
- API health OK.
- Dashboard web OK.
- Vista móvil OK.

Deploy:
Producción activa en https://orchestrator.elankav.com

Estado:
COMPLETADO

## 2026-07-10 — ORCH-003

Proyecto:
ELANKAV ORCHESTRATOR

Movimiento:
Docker Adapter en tiempo real

Cambios:
- Se creó adapters/dockerAdapter.js.
- Se agregó lectura segura de contenedores Docker.
- Se agregó endpoint /api/docker.
- Se integraron métricas de CPU, memoria y procesos.
- Se sanitizó la respuesta pública.
- Se eliminaron IDs, imágenes, puertos y tráfico interno de la API.

Contenedores detectados:
- waha
- nginx-proxy-manager
- portainer

Build:
- node --check adapters/dockerAdapter.js: OK
- node --check server.js: OK
- git diff --check: OK

QA:
- Servicio systemd activo.
- Endpoint /api/docker operativo.
- 3 contenedores detectados.
- 3 contenedores activos.
- 0 contenedores detenidos.

Riesgos:
- El endpoint es solo de lectura.
- No permite iniciar, detener ni reiniciar contenedores.
- No se agregaron credenciales ni secretos.

Estado:
COMPLETADO

## 2026-07-10 — ORCH-004

Proyecto:
ELANKAV ORCHESTRATOR

Movimiento:
Dashboard Docker desacoplado

Objetivo:
Mostrar dentro del panel web el estado real de la infraestructura Docker.

Cambios:
- Se creó la carpeta public.
- Se separaron HTML, CSS y JavaScript del backend.
- Se creó public/index.html.
- Se creó public/styles.css.
- Se creó public/app.js.
- server.js ahora sirve archivos estáticos.
- El frontend consulta /api/docker.
- Los datos se actualizan automáticamente cada 15 segundos.
- Se muestran métricas reales de WAHA, Nginx Proxy Manager y Portainer.

Archivos modificados:
- server.js

Archivos nuevos:
- public/index.html
- public/styles.css
- public/app.js

Datos mostrados:
- estado
- tiempo activo
- CPU
- memoria
- porcentaje de RAM
- procesos

Validaciones:
- node --check server.js: OK
- node --check public/app.js: OK
- git diff --check: OK
- HTML: HTTP 200
- CSS: HTTP 200
- JavaScript: HTTP 200
- /api/docker: operativo
- Vista de escritorio: validada
- Vista móvil: validada

Deploy:
https://orchestrator.elankav.com

Estado:
COMPLETADO
