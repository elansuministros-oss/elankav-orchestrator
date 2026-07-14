# PROG-001C — Persistencia de Jobs en Neon

## Estado

`IMPLEMENTADO Y VALIDADO EN RAMA AISLADA — NO DESPLEGADO`

## Objetivo

Conservar el historial y estado de los Jobs cuando se reinicie ELANKAV Orchestrator, sin modificar OpenAI, WAHA, CRM ni el contrato de `/api/messages`.

## Diseño aprobado

- PostgreSQL administrado en Neon es la fuente oficial de Jobs, por decisión Owner del 14 de julio de 2026.
- `public.orchestrator_jobs` conserva el Job completo.
- El Orchestrator accede directamente mediante `DATABASE_URL` cifrada y el adapter PostgreSQL.
- El navegador no tiene permisos sobre la tabla.
- El Job se guarda antes de responder que fue aceptado.
- Un Job `pending` o `running` durante un reinicio se marca `failed` con `ORCHESTRATOR_RESTARTED`; nunca se reanuda automáticamente.
- `/api/health` informa el estado de la persistencia.

## Orden obligatorio del primer despliegue

1. Verificar que el VPS tenga `DATABASE_URL` con `sslmode=require`, sin imprimir su valor.
2. Confirmar la migración `20260714_prog_001c_orchestrator_jobs.sql`, ya aplicada en Neon.
3. Validar lectura y escritura de una fila de prueba y eliminar únicamente esa fila de prueba.
4. Evitar nuevas órdenes técnicas Owner durante la ventana controlada.
5. Ejecutar `scripts/PROG_001C_IMPORT_ACTIVE_JOBS.js` contra el proceso todavía activo.
6. Confirmar que la cantidad importada coincide con `GET /api/jobs`.
7. Desplegar el código mediante una copia limpia; no usar `git pull` sobre el workspace sucio del VPS.
8. Ejecutar pruebas y validación de sintaxis.
9. Reiniciar una sola vez `elankav-orchestrator.service`.
10. Verificar `/api/health` y consultar desde WhatsApp un Job creado antes del reinicio.

## Validación de aceptación

1. Crear un Job `CONTEXT SYNC` y conservar su ID.
2. Consultar el Job antes del reinicio.
3. Realizar el reinicio controlado.
4. Consultar el mismo ID desde WhatsApp.
5. Confirmar que el Job, fechas y resultado continúan disponibles.
6. Confirmar que CRM y los hotfixes locales permanecen intactos.

## Rollback

- Conservar la tabla y los datos; no ejecutar `drop table`.
- Restaurar únicamente los archivos del Orchestrator incluidos en este movimiento.
- Reiniciar una sola vez y verificar salud general.
- La versión anterior no leerá los Jobs guardados en Neon, pero la información permanecerá preservada para reactivar PROG-001C.

## Archivos del movimiento

- `database/migrations/20260714_prog_001c_orchestrator_jobs.sql`
- `adapters/jobPostgresAdapter.js`
- `services/jobs/jobQueue.js`
- `services/jobs/jobEngine.js`
- `services/jobs/jobExecutor.js`
- `services/jobService.js`
- `services/ownerCommandService.js`
- `api/jobApi.js`
- `server.js`
- `scripts/PROG_001C_IMPORT_ACTIVE_JOBS.js`
- pruebas `PROG-001C`
