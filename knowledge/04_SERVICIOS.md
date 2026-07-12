# Servicios actuales

## Orchestrator

- systemd: `elankav-orchestrator`;
- función: Centro de Control del Ecosistema;
- estado esperado: active / enabled.

## Endpoints actuales

- `/api/health`;
- `/api/docker`;
- `/api/ecosystem`;
- `/api/github`;
- `/api/dashboard`.

## Servicios Autorizados

Los servicios registrados actualmente son:

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación;
- VS Code Web.

Todo servicio futuro debe incorporarse mediante registro, permisos IAM, Service, Adapter, contrato, auditoría y pruebas.

## Service Registry

SRV-001A incorpora el registro central interno de Servicios Autorizados en:

- `services/serviceRegistryService.js`.

El registro distingue obligatoriamente:

- `INTEGRATED`: existe integración operativa verificable;
- `REGISTERED`: el servicio está reconocido oficialmente, pero todavía requiere Adapter, Service o contrato operativo;
- `read-only`: SRV-001A no concede permisos nuevos ni habilita escritura dinámica.

Estado actual registrado:

- Integrados: GitHub, Docker, WAHA, Dashboard, Health, Jobs y VS Code Web;
- Integrados: GitHub, Docker, WAHA, Dashboard, Health, Jobs, Documentación y VS Code Web;
- Registrados pendientes de integración directa: CRM y QA.

KB-001A integró la Documentación en modo de lectura interna mediante Adapter y Service, limitada exclusivamente a archivos Markdown ubicados en `docs/` y `knowledge/`. La lectura bloquea traversal, rutas externas, enlaces simbólicos y archivos no autorizados. El permiso nominal `documentation.write` continúa registrado, pero la capacidad de escritura permanece deshabilitada hasta KB-002.

La exposición HTTP del Service Registry queda reservada para SRV-001B. Debe reutilizar el IAM compartido; no se permite duplicar controles Owner, Bearer o sesión en un módulo independiente.

## Reglas de acceso

- La identidad determina permisos, no el canal.
- Denegar por defecto.
- No exponer infraestructura directamente a UI, ELAN IA o VS Code Web.
- No enviar secretos al modelo.
- Registrar actor, permiso, recurso, acción y resultado.
- Un servicio registrado no puede ejecutar capacidades que no estén marcadas como operativas.

## Contexto operativo

ELAN IA debe consultar GitHub, Docker, WAHA, Dashboard, Health, repositorios, servicios y contenedores mediante Orchestrator. La memoria conversacional no es una fuente válida del estado vivo.

## Integraciones

- GitHub integrado;
- Docker integrado en lectura;
- WAHA integrado;
- Dashboard integrado;
- Health integrado;
- OpenAI Responses API conectada;
- CRM registrado mediante CORE, pendiente de contrato directo del Orchestrator;
- Jobs integrado;
- Knowledge Base registrada y en evolución;
- VS Code Web integrado en lectura y acceso Owner mediado por Orchestrator.
