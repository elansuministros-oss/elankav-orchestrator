# 01 — Auditoría maestra de evidencia y calidad

Fecha de corte: 12 de julio de 2026.

## 1. Alcance efectivo

Se auditó todo lo accesible desde el conector GitHub del usuario y el código del plano de control ELANKAV Orchestrator.

### Repositorios confirmados

| Repositorio | Visibilidad | Rama por defecto | Observación documental |
|---|---|---|---|
| `elanpet-platform` | Pública | `main` | README funcional de ELANPET |
| `elankav-platform` | Pública | `main` | README genérico de React/Vite |
| `elankav-core` | Pública | `main` | README genérico de React/Vite |
| `elanvisual-platform` | Pública | `elanvisual-desde-elanpet` | README incorrecto: conserva contenido ELANPET |
| `elankav-orchestrator` | Pública | `orchestrator-next` | Sin README antes de esta rama documental |
| `elan-ai` | Pública | `main` | README mínimo con arquitectura incompleta |
| `elankav-os` | Privada | `main` | README y package.json no localizados |

## 2. Hallazgos documentales críticos

### D-001 — Ausencia de punto de entrada en Orchestrator

**Estado:** corregido en esta rama.

La rama operativa no contenía `README.md`. El conocimiento estaba distribuido entre código, commits y conversaciones.

### D-002 — README de CORE no representa el producto

**Estado:** pendiente de corrección en el repositorio CORE.

El README contiene la plantilla estándar de Vite y no documenta APIs, Supabase, seguridad ni contratos.

### D-003 — README de ELANKAV PLATFORM no representa el producto

**Estado:** pendiente de corrección en ese repositorio.

También conserva la plantilla de Vite.

### D-004 — README de ELANVISUAL pertenece a ELANPET

**Estado:** crítico; pendiente de corrección en el repositorio correspondiente.

El archivo identifica el proyecto como `ELANPET.COM V7`, incluye usuarios demo y flujo veterinario. No representa ELANVISUAL y constituye contaminación documental entre productos.

### D-005 — ELAN AI solo tiene arquitectura nominal

El README lista Channel, Dispatcher, Planner, Memory, Knowledge, Reasoning, Operators, Tools y Business Engine, pero no documenta contratos, flujos, persistencia ni despliegue.

### D-006 — ELANKAV OS carece de entrada documental localizada

No se encontró `README.md` ni `package.json` en la rama por defecto mediante los accesos utilizados. El contenido requiere inventario específico posterior.

## 3. Calidad Git y trazabilidad

### Fortalezas

- Commits pequeños y descriptivos en CRM-042.
- PR separados por movimiento.
- Migración SQL versionada para `crm_contacts`.
- Separación razonable entre Adapter, Service y flujo conversacional.
- Uso de token interno y service role en el CORE.

### Debilidades

- Las afirmaciones “5/5” o “10/10 pruebas” aparecen en cuerpos de PR sin checks de CI asociados visibles.
- PR #1 de CRM-042C permanece abierto contra `main`, aunque movimientos posteriores están fusionados en `orchestrator-next`.
- No existe changelog oficial.
- No existe matriz de compatibilidad entre ramas y producción.
- No existe inventario oficial de variables de entorno.
- No existe contrato formal entre Orchestrator y CORE.

## 4. Estado de evidencia

| Afirmación | Clasificación |
|---|---|
| Existe `crm_contacts` como migración versionada | VERIFICADO |
| `/api/crm-contact` consulta `crm_contacts` | VERIFICADO |
| El editor lanza `CRM_SUPPLIER_HAS_NO_CONTACTS` cuando la lista está vacía | VERIFICADO |
| Vargas Centro existe en `crm_identities` | DECLARADO por evidencia conversacional/captura |
| La migración fue ejecutada en Supabase | DECLARADO; no verificado desde Git |
| Producción ejecuta `c9f9dc4` | DECLARADO; commit existe, despliegue vivo pendiente |
| Servicio systemd está activo | DECLARADO; pendiente de consulta viva |
| WAHA está conectado y operativo | DECLARADO/configurado; estado vivo pendiente |

## 5. Evaluación por disciplina

| Disciplina | Nivel observado | Motivo |
|---|---:|---|
| Trazabilidad Git | 8/10 | Movimientos y commits claros |
| Arquitectura nominal | 7/10 | Capas reconocibles, contratos incompletos |
| Documentación previa | 2/10 | Ausente, genérica o incorrecta |
| Contratos API | 4/10 | Inferibles del código, no publicados |
| Datos y migraciones | 5/10 | Migraciones presentes, sin catálogo ni backfill |
| QA verificable | 4/10 | Tests declarados, CI no visible |
| Operación/Deploy | 2/10 | Sin runbook versionado |
| Seguridad documental | 4/10 | Controles en código, inventario ausente |

## 6. Regla de corrección

No se eliminará documentación histórica automáticamente. Primero se reemplaza por documentación verificada; después se propone, en PR separado, retirar o archivar contenido incorrecto.