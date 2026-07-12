# PROG-001A — Router Owner para programación remota

## Estado

`COMPLETADO EN GITHUB — PENDIENTE DE VALIDACIÓN EN SERVICIO VIVO`

Fecha: 12 de julio de 2026.

## Objetivo

Permitir que Erick Cano emita órdenes técnicas desde WhatsApp o cualquier canal autorizado de ELAN IA, usando ELANKAV Orchestrator como entrada operativa hacia Codex, sin depender de una computadora local y sin permitir cambios directos en producción.

## Evidencia Git

| Campo | Valor |
|---|---|
| Repositorio | `elansuministros-oss/elankav-orchestrator` |
| Rama base | `orchestrator-next` |
| Rama técnica | `prog-001a-owner-programmer-router` |
| Pull Request | `#20` |
| Commit técnico final | `3bf87a94ae726fbaf17bd2fd9c860c6252b43d42` |
| Merge | `57bafe7f3722aa1318d3d9e3a00a57be69906c3f` |
| Archivos modificados | `3` |
| Estado Git | Fusionado |

## Problema resuelto

El flujo anterior ejecutaba primero `processCrmConversation()`. Esto permitía que un formulario CRM activo capturara órdenes del propietario, incluyendo cancelaciones y solicitudes técnicas.

El orden anterior era:

```text
Owner reconocido
→ CRM
→ comando owner
→ respuesta general
```

PROG-001A establece:

```text
Owner reconocido
→ cancelación o comando owner
→ router de programación
→ CRM
→ respuesta general
```

## Capacidades incorporadas

### 1. Prioridad Owner

Los comandos del propietario se detectan antes del flujo CRM.

### 2. Cancelación prioritaria

Se reconocen órdenes directas como:

- `Cancelar esta conversación`;
- `Eliminar esa orden`;
- `Detener`;
- `Cambiar de tema`.

La cancelación no crea Job ni ejecuta Codex.

### 3. Creación de Job de código

Una orden técnica autorizada debe contener:

1. una acción técnica reconocida;
2. una plataforma configurada explícitamente.

Acciones reconocidas inicialmente:

- auditar;
- revisar;
- corregir;
- programar;
- implementar;
- crear;
- modificar;
- reparar;
- actualizar.

Plataformas autorizadas:

- `elan-ai`;
- `elanvisual`;
- `elanpet`;
- `elankav-core`;
- `elankav-platform`.

Ejemplo:

```text
Audita ELAN IA, corrige el problema y abre un PR.
```

El router crea un Job `CODE` y entrega la tarea al pipeline existente.

## Pipeline reutilizado

PROG-001A no crea un segundo sistema de programación. Reutiliza:

```text
mensaje Owner autorizado
→ Owner Command Router
→ Job Engine
→ workspace aislado
→ rama temporal
→ Codex
→ QA
→ publicación de rama
→ Pull Request
```

## Controles de seguridad

PROG-001A no habilita:

- merge automático;
- despliegue automático;
- reinicio de servicios;
- modificación directa de producción;
- activación de Codex sin plataforma explícita;
- activación de Codex por conversación normal;
- privilegios por el simple hecho de usar WhatsApp.

La identidad Owner determina los permisos; el canal no concede privilegios.

## Respuesta operativa esperada

Cuando la orden es aceptada, ELAN IA debe responder con:

```text
Orden de programación aceptada.

Job: JOB-...
Plataforma: elan-ai
Rama temporal: job/job-...
Estado: PENDING

Codex trabajará en un workspace aislado. El flujo puede crear una rama y un Pull Request, pero no hará merge ni despliegue automático.
```

## Pruebas agregadas

Archivo:

```text
tests/prog001aOwnerProgrammerRouter.test.js
```

Casos cubiertos:

- detecta corrección para ELAN IA;
- resuelve plataformas autorizadas;
- no activa programación sin plataforma;
- no activa programación por conversación normal;
- prioriza cancelación;
- conserva `CONTEXT SYNC`.

## Limitaciones vigentes

### Servicio vivo no verificado

El merge en GitHub no confirma que el VPS esté ejecutando el commit nuevo.

Antes de declarar PROG-001A operativo desde WhatsApp debe verificarse:

1. rama y commit desplegados;
2. suite `npm test` en el VPS;
3. estado del proceso o contenedor;
4. `/api/health`;
5. una cancelación real desde WhatsApp;
6. una orden técnica controlada desde WhatsApp;
7. creación del Job, rama y PR;
8. ausencia de merge o despliegue automático.

### Persistencia de Jobs

La cola actual utiliza memoria de proceso. Un reinicio puede perder el historial del Job. La persistencia oficial en Supabase queda pendiente de un movimiento separado.

### Seguridad de entrada

PROG-001A depende del Owner Mode existente. El endurecimiento de firma, idempotencia, auditoría central y persistencia corresponde a movimientos posteriores.

## Siguientes movimientos recomendados

### PROG-001B — Consulta y control de Jobs desde WhatsApp

- consultar estado por Job ID;
- listar últimos Jobs;
- mostrar PR generado;
- informar fallo de QA;
- cancelar Job pendiente cuando sea técnicamente seguro.

### PROG-001C — Persistencia Supabase

- `orchestrator_jobs`;
- `orchestrator_job_steps`;
- `orchestrator_approvals`;
- `orchestrator_audit_log`.

### PROG-001D — Aprobaciones remotas

- aprobar o rechazar PR;
- confirmación fuerte para merge;
- despliegue como operación independiente;
- rollback documentado.

## Regla de cierre

PROG-001A queda cerrado documentalmente en GitHub, pero no debe declararse operativo en WhatsApp hasta completar la validación del servicio vivo y registrar la evidencia de despliegue.