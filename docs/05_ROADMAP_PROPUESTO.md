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

## Línea de voz y audio de ELAN IA

Esta línea es independiente de VSC y no modifica el orden de seguridad, IAM o producción.

### Movimientos cerrados

| Movimiento | Resultado | Estado |
|---|---|---|
| `AUD-001A` | Audio Intake Adapter, Audio Intake Service y webhook WAHA documentados/validados | CERRADO |
| `VOICE-001` | Identidad oficial de voz, diccionario, configuración y matriz A/B | CERRADO |

### Movimiento siguiente

#### STT-001A — Diseño de reconocimiento de audio

Objetivo único:

Definir e implementar de forma desacoplada la descarga temporal y transcripción de audio recibido, sin incorporar síntesis de voz.

Arquitectura objetivo:

```text
WAHA
  ↓
api/whatsapp-v2
  ↓
Audio Intake Adapter
  ↓
Audio Intake Service
  ↓
STT Service
  ↓
STT Provider Adapter
  ↓
Proveedor STT
  ↓
Resultado normalizado
```

Condiciones obligatorias:

- auditar primero el contrato real de audio WAHA;
- conservar AUD-001A;
- no mezclar STT con TTS;
- proveedor sustituible;
- archivo temporal controlado;
- límites de tamaño, duración, formato y timeout;
- limpieza garantizada;
- trazabilidad sin exponer audio sensible;
- pruebas unitarias y de integración;
- documentación y rollback.

### Movimientos posteriores, no autorizados todavía

| Movimiento | Alcance |
|---|---|
| `STT-001B` | Robustez, formatos, fallback y observabilidad STT |
| `TTS-001A` | Síntesis de voz usando el contrato `VOICE-001` |
| `MEDIA-001` | Almacenamiento, retención, acceso y eliminación multimedia |
| `VOICE-002` | Ajustes del perfil oficial sustentados por pruebas A/B |

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

1. `KB-001A` — cerrado.
2. `AUD-001A` — cerrado.
3. `VOICE-001` — documentado y cerrado.
4. Iniciar `STT-001A` mediante auditoría diferencial del contrato real de audio.
5. Diseñar Adapter, Service, contrato neutral, errores y rollback de STT.
6. Implementar un movimiento pequeño sin síntesis de voz.
7. Ejecutar build, pruebas y validación funcional.
8. Actualizar índice, línea base y roadmap al cierre.

## Regla de continuidad para futuros chats

Todo chat que continúe esta línea debe leer, en este orden:

1. `docs/00_MASTER_INDEX.md`;
2. `docs/06_LINEA_BASE_ECOSISTEMA.md`;
3. `docs/VOICE-001.md`;
4. el documento del movimiento activo.

No debe reconstruir el estado desde memoria conversacional ni crear una estructura documental paralela.