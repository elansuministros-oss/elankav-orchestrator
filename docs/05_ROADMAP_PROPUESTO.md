# 05 — Roadmap propuesto sin implementación

Este documento contiene propuestas. No autoriza cambios automáticos.

## Prioridad 0 — Congelamiento controlado

Hasta cerrar CRM-042:

- no agregar funciones CRM nuevas;
- no recrear WAHA;
- no duplicar integraciones;
- no rediseñar interfaces;
- no crear nuevas tablas para evadir el problema;
- no ejecutar backfill sin auditoría de datos.

## Prioridad 1 — Certificar la fuente histórica de contactos

### Objetivo

Determinar dónde están los contactos previos a `crm_contacts`.

### Evidencia requerida

- definición de `crm_identities`;
- definición y datos de `crm_supplier_profiles`;
- existencia de `crm_supplier_contacts` u otras tablas;
- columnas telefónicas o de contacto heredadas;
- `identity_id` real de Vargas Centro;
- conteos antes y después de CRM-042H;
- registros duplicados por WhatsApp.

### Salida esperada

Informe de correspondencia:

```text
fuente histórica → transformación → crm_contacts
```

Sin ejecutar todavía la transformación.

## Prioridad 2 — Diseñar backfill seguro

Solo después de identificar la fuente:

1. consulta de previsualización;
2. respaldo verificable;
3. regla de normalización E.164;
4. regla de deduplicación por identidad y WhatsApp;
5. selección de contacto principal;
6. conteos esperados;
7. ejecución transaccional o reversible;
8. validación postmigración;
9. rollback documentado.

## Prioridad 3 — Certificación E2E CRM-042

Probar en orden:

1. proveedor nuevo;
2. cliente nuevo;
3. contacto principal automático;
4. segundo contacto;
5. listado;
6. edición;
7. cancelación;
8. reinicio del Orchestrator;
9. WhatsApp real;
10. dato histórico migrado.

No avanzar hasta obtener evidencia de cada movimiento.

## Prioridad 4 — Normalización documental por repositorio

### ELANKAV CORE

- reemplazar README de Vite;
- documentar `/api/crm` y `/api/crm-contact`;
- catálogo de migraciones;
- variables requeridas;
- modelo de seguridad.

### ELANVISUAL

- sustituir README heredado de ELANPET;
- declarar rama operativa real;
- documentar Supabase Auth, EMC, AI-23, cotizador y producción;
- separar estado actual de funcionalidades proyectadas.

### ELANPET

- revisar usuarios demo y confirmar si deben permanecer documentados;
- documentar autenticación real y despliegue actual.

### ELANKAV PLATFORM

- reemplazar README de Vite;
- definir responsabilidad frente a ELANKAV OS y Orchestrator.

### ELAN AI

- completar contratos de Channel, Dispatcher, Planner, Memory, Knowledge, Reasoning, Operators, Tools y Business Engine;
- documentar integración real con WAHA y Orchestrator.

### ELANKAV OS

- inventariar contenido privado;
- crear README y límites del producto;
- evitar duplicidad con Orchestrator y Platform.

## Prioridad 5 — Control de producción

Proponer posteriormente:

- manifiesto por servicio con commit desplegado;
- health check semántico;
- inventario Docker;
- mapa de dominios y proxy;
- política de logs;
- backup y restore;
- procedimiento de rollback;
- registro de incidentes.

## Orden recomendado de proyectos

1. Cerrar CRM-042 y contactos heredados.
2. Certificar Orchestrator como plano de control de lectura.
3. Normalizar documentación de CORE.
4. Normalizar documentación de ELANVISUAL.
5. Auditar ELAN AI y cadena WAHA.
6. Definir límites ELANKAV Platform / ELANKAV OS.
7. Implantar QA y CI.
8. Reanudar nuevas funciones.

## Criterio para retomar desarrollo

El desarrollo puede continuar cuando:

- el incidente de contacto histórico tiene causa y resolución verificadas;
- los contratos CRM están documentados;
- existe una prueba E2E aprobada;
- producción está vinculada a un commit conocido;
- hay rollback definido;
- el próximo movimiento tiene un único objetivo y dependencias identificadas.