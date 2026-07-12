# 05 — Roadmap oficial de evolución

Este documento ordena los movimientos futuros. No autoriza cambios automáticos ni permite omitir auditoría, validación o rollback.

## Principios de ejecución

- Un movimiento = un objetivo.
- Producción tiene prioridad.
- No duplicar módulos ni documentación.
- Todo acceso sensible pasa por IAM y Orchestrator.
- Todo cambio debe actualizar código, pruebas, arquitectura y Base Oficial de Conocimiento.

## Prioridad 0 — Estabilidad y cierre de movimientos abiertos

- cerrar incidencias y contratos CRM pendientes;
- no recrear WAHA;
- no duplicar integraciones;
- no rediseñar interfaces sin alcance aprobado;
- no ejecutar migraciones o backfill sin evidencia, respaldo y rollback.

## Prioridad 1 — Orchestrator como Centro de Control

### Estado

**EN EVOLUCIÓN.**

Consolidar oficialmente:

- descubrimiento del ecosistema;
- contexto operativo;
- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- documentación;
- auditoría;
- Servicios Autorizados.

Criterio de cierre: ELAN IA debe consultar el estado mediante Orchestrator y no asumirlo desde memoria conversacional.

## Prioridad 2 — Knowledge Base

### Objetivo

Convertir la documentación existente en la Base Oficial de Conocimiento, sin crear documentación paralela.

### Entregables

- índice maestro sincronizado;
- documento maestro único por tema;
- relaciones entre módulos;
- estado implementado/planificado explícito;
- trazabilidad a código, pruebas, commits y migraciones;
- consulta mediante Servicio Autorizado de Documentación.

## Prioridad 3 — IAM

### Estado

**IAM INICIAL.** Owner Mode existe; la autorización granular permanece pendiente.

### Orden

1. identidad canónica;
2. roles: Owner, Administrador, Ejecutivo, Operador, Proveedor, Cliente e Invitado;
3. catálogo versionado de permisos;
4. Authorization Service;
5. registro de auditoría;
6. pruebas positivas y negativas por rol;
7. denegación por defecto en todos los Servicios Autorizados.

Identidades oficiales:

- `50588388940`: único Owner;
- `50578828089`: número comercial receptor de ELAN IA, sin privilegios administrativos.

## Prioridad 4 — Servicios Autorizados

Servicios registrados:

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación.

Todo servicio futuro deberá registrarse mediante el mismo mecanismo: contrato, permisos, service, adapter, auditoría, pruebas y estado.

## Prioridad 5 — VSC-001: VS Code Web base

### Estado

**PLANIFICADO.**

### Objetivo único

Integrar VS Code Web sin acceso lateral directo a infraestructura.

### Arquitectura obligatoria

```text
Usuario autorizado
  ↓
VS Code Web
  ↓
Workspace VPS autorizado
  ↓
ELANKAV Orchestrator
  ↓
Servicios Autorizados
```

### Alcance VSC-001

- seleccionar tecnología compatible con el VPS;
- desplegar servicio aislado;
- publicar detrás del proxy existente;
- autenticar mediante IAM/Owner Mode inicial;
- limitar workspaces permitidos;
- registrar el servicio en Orchestrator;
- exponer health y estado;
- registrar auditoría de acceso;
- validar rollback.

### Prohibiciones

VS Code Web no accederá directamente a GitHub, Docker, Supabase, WAHA ni Producción. No se habilitarán acciones destructivas, deploy ni terminal privilegiada en VSC-001.

### Criterio de cierre

- servicio accesible únicamente por identidad autorizada;
- workspace limitado;
- health visible desde Orchestrator;
- sin puertos administrativos expuestos directamente;
- pruebas de acceso autorizado y denegado;
- rollback probado;
- documentación existente actualizada.

## Prioridad 6 — VSC-002: autorización granular

- permisos por workspace;
- permisos de lectura/escritura;
- sesiones y expiración;
- auditoría detallada;
- revocación inmediata;
- pruebas de escalamiento de privilegios.

## Prioridad 7 — VSC-003: operaciones autorizadas

Solo después de IAM operativo:

- consulta GitHub mediante Orchestrator;
- QA y build mediante Jobs;
- creación de rama;
- commit y PR;
- operaciones Docker estrictamente autorizadas;
- deploy y rollback como movimientos independientes.

## Normalización documental por repositorio

Cada producto conserva su README y contrato local. La documentación transversal se mantiene únicamente en Orchestrator. No mezclar productos ni copiar el mismo tema en varios documentos.

## Control de producción

Mantener:

- manifiesto por servicio con commit desplegado;
- health check semántico;
- inventario Docker;
- mapa de dominios y proxy;
- política de logs;
- backup y restore;
- procedimiento de rollback;
- registro de incidentes.

## Orden inmediato aprobado

1. Sincronizar documentación existente.
2. Abrir y aprobar el cambio documental.
3. Ejecutar auditoría diferencial del VPS para VSC-001.
4. Diseñar el movimiento de instalación sin tocar producción.
5. Implementar VSC-001.
6. Validar IAM, proxy, health, workspace y rollback.
7. Actualizar línea base y Knowledge Base.
