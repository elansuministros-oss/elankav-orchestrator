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

### R-007 — Defaults de Storage apuntando a recursos no verificados

El incidente del 18 de julio de 2026 demostró que un valor por defecto puede apuntar a un bucket inexistente mientras las pruebas unitarias y el servicio siguen reportando éxito. Todo bucket productivo debe comprobarse contra Storage vivo y documentarse como `bucket + objectPath`.

### R-008 — Persistencia de URLs firmadas como identidad de activo

Una `signedUrl` es una credencial temporal de entrega, no una referencia estable. Persistirla como identidad del archivo provoca expiración y pérdida de imágenes. La identidad estable debe ser `assetId` o `bucket + objectPath`; la URL se genera al entregar.

### R-009 — Declarar Asset Core completo con integración parcial

Un endpoint de upload operativo no demuestra Asset Registry, clasificación transversal, integración del frontend, compatibilidad histórica ni conexión de facturas, comprobantes, productos, diseños y WhatsApp.

## 2. Riesgos altos

- Búsqueda de proveedores por coincidencia parcial en memoria.
- Contrato API inferido, no formalizado.
- Doble normalización telefónica en Orchestrator y CORE.
- Configuración de proyectos duplicada entre `server.js` y `config/ecosystem.json`.
- Rama mostrada en tarjetas puede no coincidir con rama por defecto o despliegue real.
- El estado “Operativo” del catálogo estático no depende de health checks.
- README de CORE y Platform no representa sus productos.
- ELANKAV OS no tiene entrada documental localizada.
- Inferir nombres de buckets por carpetas, módulos, PR o memoria conversacional.
- Confundir `systemctl active` con certificación funcional E2E.
- Ejecutar reinicios o cambios de entorno antes de consultar documentación y fuentes vivas.
- Mantener variables productivas críticas sin inventario versionado.
- Tener múltiples flujos de carga sin Asset Service y Asset Registry comunes.

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
- Respaldo del archivo de entorno antes del cambio VQS del 18 de julio de 2026.
- Validación real del upload contra el bucket `elanvisual`.
- Documentación específica del incidente en `docs/EAC_STORAGE_VQS_INCIDENT_20260718.md`.

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
| Storage configuración | Variable cargada y bucket existente | Verificado para `VQS_ASSET_BUCKET=elanvisual` el 18-07-2026 |
| Storage integración | Upload real con `bucket + objectPath` | Verificado para prueba controlada VQS |
| VQS contrato | Referencia estable persistida, no `signedUrl` | Pendiente de certificación E2E |
| ELANVISUAL E2E | Seleccionar → miniatura → upload → guardar → abrir → público | Pendiente |
| Compatibilidad histórica | Cotizaciones antiguas con imagen | Pendiente |
| Asset Core transversal | Facturas, comprobantes, catálogo, diseños, documentos y WhatsApp | No certificado |

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

Para Storage debe documentar adicionalmente:

- bucket físico;
- objectPath lógico;
- público o privado;
- políticas y consumidor;
- identidad estable del activo;
- forma de generación de URL de entrega;
- prueba viva controlada;
- prueba E2E del consumidor.

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
11. Validación de arranque que falle claramente si `VQS_ASSET_BUCKET` no está configurado o no puede verificarse mediante el procedimiento autorizado.
12. Prueba de integración Storage en entorno controlado, separada de pruebas unitarias.
13. Gate E2E obligatorio antes de declarar resuelto un incidente visible en ELANVISUAL.
14. Asset Registry transversal con `assetId`, clasificación y relaciones de negocio.
15. Prohibición automatizada o revisión estática para evitar persistir `signedUrl` como identidad estable.
16. Inventario versionado de buckets y prefijos lógicos sin secretos.
17. Revisión obligatoria de `docs/EAC_STORAGE_VQS_INCIDENT_20260718.md` en cualquier cambio de Storage, VQS o Asset Core.

## 7. Lección operativa obligatoria — Incidente EAC/VQS 2026-07-18

El orden correcto es:

```text
Documentación oficial
→ diff desde línea base
→ entorno vivo de solo lectura
→ clasificación del alcance
→ respaldo
→ cambio mínimo
→ upload real
→ contrato VQS
→ E2E ELANVISUAL
→ regresión
→ actualización documental
```

Queda prohibido sustituir ese orden por:

```text
suposición
→ cambio
→ reinicio
→ prueba parcial
→ nueva suposición
```

La evidencia completa, los errores cometidos, la configuración validada, el rollback y el procedimiento detallado están en:

```text
docs/EAC_STORAGE_VQS_INCIDENT_20260718.md
```
