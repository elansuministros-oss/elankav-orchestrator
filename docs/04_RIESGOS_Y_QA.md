# 04 — Riesgos, deuda técnica y QA

## 1. Riesgos críticos

### R-001 — Datos históricos sin estrategia de migración

`crm_contacts` fue creada sin backfill. Impacto: proveedores existentes pueden quedar visibles como identidades, pero sin contactos editables.

### R-002 — Documentación incorrecta entre productos

ELANVISUAL conserva README de ELANPET. Impacto: operadores pueden ejecutar flujos, credenciales demo o decisiones equivocadas sobre el producto.

### R-003 — Estado de producción declarado, no certificado

No existe manifiesto versionado que relacione servicio, commit desplegado, fecha, entorno y validación posterior.

### R-004 — Pruebas declaradas sin CI visible

Los PR indican 5/5 o 10/10, pero el commit auditado no expone checks automáticos asociados.

### R-005 — Endpoints operativos y de infraestructura

El Orchestrator expone datos de Docker, GitHub y dashboard. La autenticación o restricción de proxy debe verificarse; no debe asumirse por estar detrás de un dominio.

### R-006 — Estado conversacional en archivo local

El CRM guarda estados en `/opt/elankav/state/crm-command-state.json`. Riesgos: concurrencia, volumen no persistente, conversaciones abandonadas y escalado a múltiples instancias.

## 2. Riesgos altos

- Búsqueda de proveedores por coincidencia parcial en memoria.
- Contrato API inferido, no formalizado.
- Doble normalización telefónica en Orchestrator y CORE.
- Configuración de proyectos duplicada entre `server.js` y `config/ecosystem.json`.
- Rama mostrada en tarjetas puede no coincidir con rama por defecto o despliegue real.
- El estado “Operativo” del catálogo estático no depende de health checks.
- README de CORE y Platform no representa sus productos.
- ELANKAV OS no tiene entrada documental localizada.

## 3. Controles existentes verificados

- `Promise.allSettled` en dashboard para aislar fallos.
- Timeout de consultas HTTP del ecosistema.
- `execFile` para Docker, evitando shell directo.
- Timeout y límite de buffer en Docker.
- Bearer token para APIs CRM internas.
- Service role de Supabase solo del lado servidor.
- RLS y revocación a `anon`/`authenticated` en `crm_contacts`.
- Restricción de actualización por `contactId`, `identityId` y estado activo.
- Migraciones SQL versionadas en CORE.
- Commits pequeños en el bloque CRM-042.

## 4. Matriz mínima de QA propuesta

| Nivel | Prueba | Estado actual |
|---|---|---|
| Sintaxis | `node --check` / build | Declarado en PR |
| Unitario | normalización E.164 | Verificado por archivo de prueba |
| Dominio | proveedor/cliente/contacto | Parcial |
| Contrato | Orchestrator ↔ CORE | No formalizado |
| Integración | CORE ↔ Supabase | Pendiente de entorno controlado |
| E2E | WhatsApp ↔ edición contacto | Fallando para dato histórico |
| Producción | health, logs, commit | Pendiente de certificación |
| Regresión | flujos anteriores | Declarado, cobertura no demostrada |

## 5. Criterios de calidad documental

Cada módulo debe documentar:

- propietario técnico;
- repositorio y rama;
- endpoints;
- variables de entorno sin secretos;
- tablas y migraciones;
- flujo normal;
- errores;
- pruebas;
- despliegue;
- rollback;
- riesgos conocidos.

## 6. Controles propuestos, no implementados

1. CI obligatorio para test, sintaxis y validación de migraciones.
2. Manifiesto de despliegue con commit y fecha.
3. Pruebas contractuales entre Orchestrator y CORE.
4. Fixture de proveedor histórico y contactos heredados.
5. Health checks semánticos, no solo conectividad HTTP.
6. Autenticación explícita de endpoints de infraestructura.
7. Inventario de variables en `.env.example` sin valores sensibles.
8. Política de migración con respaldo, dry run, conteos y rollback.
9. ADR para decisiones arquitectónicas importantes.
10. Revisión documental obligatoria en cada PR.