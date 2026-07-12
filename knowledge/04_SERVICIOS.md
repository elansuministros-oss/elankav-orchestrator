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
- Documentación.

Todo servicio futuro debe incorporarse mediante registro, permisos IAM, Service, Adapter, contrato, auditoría y pruebas.

## Reglas de acceso

- La identidad determina permisos, no el canal.
- Denegar por defecto.
- No exponer infraestructura directamente a UI, ELAN IA o VS Code Web.
- No enviar secretos al modelo.
- Registrar actor, permiso, recurso, acción y resultado.

## Contexto operativo

ELAN IA debe consultar GitHub, Docker, WAHA, Dashboard, Health, repositorios, servicios y contenedores mediante Orchestrator. La memoria conversacional no es una fuente válida del estado vivo.

## Integraciones

- GitHub integrado;
- Docker integrado en lectura;
- WAHA integrado;
- Dashboard integrado;
- Health integrado;
- OpenAI Responses API conectada;
- CRM integrado mediante CORE;
- Knowledge Base en evolución;
- VS Code Web planificado.
