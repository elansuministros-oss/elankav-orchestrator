# 02 — Arquitectura y mapa de accesos

## 1. ELANKAV Orchestrator como Centro de Control

ELANKAV Orchestrator deja de documentarse únicamente como API Gateway. Su responsabilidad oficial es operar como **Centro de Control del Ecosistema ELANKAV**.

Responsabilidades:

- descubrimiento del ecosistema;
- resolución de contexto operativo;
- consulta de GitHub;
- consulta de Docker;
- consulta de WAHA;
- consulta de Health;
- consulta de Dashboard;
- consulta de documentación oficial;
- autorización mediante IAM;
- auditoría;
- acceso futuro a VS Code Web.

```text
Canales / UI / ELAN IA / VS Code Web
  ↓
IAM y Authorization Service
  ↓
ELANKAV Orchestrator
  ├─ Servicios
  ├─ Adapters
  ├─ Auditoría
  └─ Knowledge Base
```

El servicio escucha internamente en `172.19.0.1:4100` y carga configuración desde `/etc/elankav-orchestrator.env`.

## 2. Arquitectura verificada

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

## 3. Endpoints observados

| Endpoint | Función | Naturaleza |
|---|---|---|
| `/health`, `/api/health` | Salud del Orchestrator | Lectura |
| `/api/projects` | Catálogo de proyectos | Lectura |
| `/api/dashboard` | Resumen sistema/ecosistema/Docker/GitHub | Lectura agregada |
| `/api/ecosystem` | Verificación HTTP de servicios | Lectura |
| `/api/docker` | Contenedores y estadísticas Docker | Lectura privilegiada |
| `/api/github` | Estado de repositorios | Lectura |
| API de mensajes | Entrada operativa WhatsApp/IA | Operativa |
| API de jobs | Gestión de trabajos | Operativa |
| API de decisión PR | Aprobación/rechazo de movimientos Git | Operativa |

## 4. Servicios Autorizados

Todo recurso integrado debe registrarse como Servicio Autorizado y pasar por IAM antes de ser consultado o ejecutado.

Servicios registrados actualmente:

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación.

Los servicios futuros deben incorporarse mediante el mismo mecanismo: registro, permisos, adapter, service, auditoría y contrato.

## 5. Contexto operativo oficial

ELAN IA puede consultar mediante el Orchestrator:

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- repositorios;
- servicios;
- contenedores.

No debe asumir el estado actual del ecosistema usando únicamente memoria conversacional. La fuente oficial del contexto operativo es el Orchestrator y sus Servicios Autorizados.

## 6. Acceso Docker

`dockerAdapter` ejecuta exclusivamente el binario `/usr/bin/docker` mediante `execFile` y utiliza:

- `docker ps --all --format {{json .}}`;
- `docker stats --no-stream --format {{json .}}`.

El adapter observado es de lectura; no contiene arranque, parada, eliminación ni ejecución dentro de contenedores.

### Riesgo

El endpoint `/api/docker` revela información operativa sensible. Debe requerir autorización IAM y nunca exponerse como acceso público sin control.

## 7. Acceso al ecosistema

`ecosystemAdapter` carga `config/ecosystem.json` y realiza consultas HTTP concurrentes con timeout de 8 segundos.

Servicios observados:

- ELANVISUAL;
- ELANPET;
- ELANKAV CORE;
- ELANKAV PLATFORM;
- WAHA;
- ORCHESTRATOR.

El estado `online` representa alcanzabilidad HTTP, no necesariamente salud funcional.

## 8. Dashboard agregado

`dashboardService` consolida sistema VPS, ecosistema HTTP, Docker y GitHub mediante `Promise.allSettled`. Una fuente caída no impide devolver las demás.

## 9. Cadena CRM verificada

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

## 10. VS Code Web — arquitectura planificada

**Estado: PLANIFICADO — VSC-001.**

```text
Usuario autorizado
  ↓
VS Code Web
  ↓
Workspaces VPS
  ↓
ELANKAV Orchestrator
  ↓
Servicios Autorizados
```

VS Code Web no tendrá acceso directo a:

- GitHub;
- Docker;
- Supabase;
- WAHA;
- Producción.

Todo acceso deberá pasar por el Orchestrator, ser autorizado por IAM y quedar registrado en auditoría. La primera integración debe limitarse a disponibilidad del servicio, autenticación, workspace autorizado y permisos efectivos. La ejecución sobre producción se habilitará únicamente en movimientos posteriores y validados.

## 11. Fronteras arquitectónicas

- La UI no debe consultar Supabase directamente si existe API del CORE.
- El Orchestrator debe usar adapters para infraestructura externa.
- Los servicios deben normalizar datos antes de invocar adapters.
- La identidad y el rol determinan permisos; el canal no concede privilegios.
- Los Servicios Autorizados deben denegar por defecto.
- Las migraciones pertenecen al repositorio que gobierna el modelo de datos.
- La documentación maestra vive en Orchestrator y cada repositorio conserva su contrato local.
- VS Code Web nunca sustituye IAM ni se convierte en acceso lateral a infraestructura.

## 12. Acceso disponible y pendiente

| Recurso | Estado |
|---|---|
| GitHub | Integrado |
| Docker | Integrado en lectura |
| WAHA | Integrado |
| Dashboard | Integrado |
| Health | Integrado |
| CRM | Integrado mediante CORE |
| Documentación | Knowledge Base en evolución |
| IAM | Inicial; autorización granular pendiente |
| VS Code Web | Planificado |
| Supabase | Indirecto mediante servicios autorizados |
| DNS/TLS/proxy | Auditoría específica pendiente |
