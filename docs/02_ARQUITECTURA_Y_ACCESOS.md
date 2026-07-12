# 02 — Arquitectura y mapa de accesos

## 1. Arquitectura verificada del Orchestrator

```text
HTTP / UI
  ↓
server.js
  ├─ messageApi
  ├─ pullRequestDecisionApi
  ├─ jobApi
  ├─ dashboardAdapter
  ├─ ecosystemAdapter
  ├─ dockerAdapter
  └─ githubAdapter
```

El servicio escucha internamente en `172.19.0.1:4100` y carga configuración desde `/etc/elankav-orchestrator.env`.

## 2. Endpoints observados

| Endpoint | Función | Naturaleza |
|---|---|---|
| `/health`, `/api/health` | Salud del Orchestrator | Lectura |
| `/api/projects` | Catálogo estático de proyectos | Lectura |
| `/api/dashboard` | Resumen sistema/ecosistema/Docker/GitHub | Lectura agregada |
| `/api/ecosystem` | Verificación HTTP de servicios | Lectura |
| `/api/docker` | Contenedores y estadísticas Docker | Lectura privilegiada |
| `/api/github` | Estado de repositorios | Lectura |
| API de mensajes | Entrada operativa WhatsApp/IA | Operativa |
| API de jobs | Gestión de trabajos | Operativa |
| API de decisión PR | Aprobación/rechazo de movimientos Git | Operativa |

## 3. Acceso Docker

`dockerAdapter` ejecuta exclusivamente el binario `/usr/bin/docker` mediante `execFile` y utiliza:

- `docker ps --all --format {{json .}}`
- `docker stats --no-stream --format {{json .}}`

El adapter observado es de lectura; no contiene arranque, parada, eliminación ni ejecución dentro de contenedores.

### Riesgo

El endpoint `/api/docker` revela nombres, estados, consumo de CPU, memoria y procesos. Debe considerarse información operativa sensible y requerir control de acceso en el proxy o aplicación.

## 4. Acceso al ecosistema

`ecosystemAdapter` carga `config/ecosystem.json` y realiza consultas HTTP concurrentes con timeout de 8 segundos.

Servicios registrados:

- ELANVISUAL — `https://visual.elankav.com`
- ELANPET — `https://pet.elankav.com`
- ELANKAV CORE — `https://elankav-core.vercel.app`
- ELANKAV PLATFORM — `https://elankav-platform.vercel.app`
- WAHA — `https://waha.elankav.com`
- ORCHESTRATOR — `https://orchestrator.elankav.com/health`

### Limitación técnica

El adapter considera `online: true` cualquier respuesta que tenga un estado HTTP, incluso 4xx o 5xx. Por tanto, “online” significa alcanzable, no necesariamente saludable.

## 5. Dashboard agregado

`dashboardService` consolida cuatro fuentes:

1. sistema VPS;
2. ecosistema HTTP;
3. Docker;
4. GitHub.

Usa `Promise.allSettled`, por lo que una fuente caída no impide devolver las demás. Genera alertas críticas o de advertencia y un estado `OK` o `DEGRADED`.

## 6. Cadena CRM verificada

```text
WhatsApp
  ↓
WAHA
  ↓
messageService
  ↓
crmConversationService
  ↓
contactService / supplierService / clientService
  ↓
crmWriteAdapter
  ↓
ELANKAV CORE
  ├─ /api/crm
  └─ /api/crm-contact
  ↓
Supabase REST con service role
```

## 7. Fronteras arquitectónicas

- La UI no debe consultar Supabase directamente si existe API del CORE.
- El Orchestrator debe usar adapters para infraestructura externa.
- Los servicios deben normalizar datos antes de invocar adapters.
- Las migraciones pertenecen al repositorio que gobierna el modelo de datos: actualmente CORE.
- La documentación maestra puede vivir en Orchestrator, pero cada repositorio debe mantener su README y contrato local.

## 8. Acceso disponible y pendiente

| Recurso | Acceso por esta auditoría | Estado |
|---|---|---|
| GitHub | Directo mediante conector | VERIFICADO |
| Código Orchestrator/CORE | Directo | VERIFICADO |
| Docker | Capacidad indirecta del Orchestrator | VERIFICADO en código; entorno vivo pendiente |
| Servicios HTTP | Capacidad indirecta del Orchestrator | VERIFICADO en código; estado vivo pendiente |
| Supabase | Indirecto mediante CORE service role | VERIFICADO en código; datos vivos pendientes |
| WAHA | Servicio registrado | Configuración verificada; sesión viva pendiente |
| VPS/systemd | Parcial mediante adapters/código | Estado vivo pendiente |
| DNS/TLS/proxy | No expuesto por los contratos revisados | PENDIENTE |