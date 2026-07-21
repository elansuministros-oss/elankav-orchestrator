# 03 — CRM, identidad, roles, relaciones y contactos

## 1. Propósito

Este documento consolida el contrato maestro del CRM del ecosistema ELANKAV. Debe leerse antes de auditar, modificar o extender clientes, proveedores, contactos, plataformas, roles o relaciones.

La conclusión vigente es:

> El esquema del CORE ya soporta identidad, roles y relaciones. La principal deficiencia identificada está en el contrato de lectura del CRM y en cómo el dashboard reconstruye las plataformas, no en la estructura base de Supabase.

## 2. Fuente maestra de identidad

La entidad maestra es:

```text
crm_identities.id
```

Reglas obligatorias:

- `customer_id`, `supplier_id` o referencias equivalentes de las plataformas deben apuntar a `crm_identities.id` cuando representen a la misma persona o empresa.
- `canonical_id` se utiliza para resolución, deduplicación o vinculación canónica; no sustituye la clave primaria relacional.
- Las plataformas conservan referencias al cliente maestro y su información operacional propia.
- Los documentos históricos pueden conservar snapshots de nombre, dirección, identificación fiscal y otros datos para preservar la evidencia del momento de emisión.
- No se deben crear identidades duplicadas para una misma persona o empresa por cada plataforma.

## 3. Modelo verificado

La auditoría de código confirmó la existencia de los siguientes componentes de dominio:

```text
crm_identities
crm_roles
crm_client_relationships
crm_contacts
crm_conversations
crm_messages
crm_events
crm_documents
crm_quotes
crm_quote_items
```

### 3.1 Identidades

`crm_identities` representa a la persona o empresa maestra. Debe concentrar la identidad transversal y no la lógica operativa específica de una plataforma.

### 3.2 Roles

`crm_roles` permite que una misma identidad tenga uno o varios roles. El dominio versionado contempla, entre otros:

```text
client
supplier
owner
seller
employee
design_partner
```

Una identidad puede ser simultáneamente cliente y proveedor. No se debe duplicar para representar roles distintos.

### 3.3 Relaciones por plataforma

`crm_client_relationships` representa la relación comercial u operacional de una identidad con una plataforma.

Ejemplos:

```text
Identidad A → ELANVISUAL → cliente
Identidad A → ELANHOME → proveedor
Identidad A → ELANPET → cliente
```

La existencia de una relación no depende de que exista una conversación de WhatsApp.

## 4. Hallazgo CRM-101A — contrato de lectura

### 4.1 Comportamiento incorrecto identificado

El dashboard actual reconstruye las plataformas asociadas desde:

```text
crm_conversations.platform
```

Ese enfoque es incompleto porque una identidad puede pertenecer a una plataforma sin haber tenido todavía una conversación.

### 4.2 Fuente correcta

La relación oficial debe obtenerse desde:

```text
crm_client_relationships.platform
```

Las conversaciones son evidencia de interacción, no el registro maestro de pertenencia o relación comercial.

### 4.3 Movimiento recomendado

```text
CRM-101A
```

Objetivo:

Ampliar el contrato de lectura del CRM para devolver, por identidad:

- `identity`;
- `roles`;
- `relationships`;
- plataformas derivadas de relaciones oficiales;
- contactos cuando corresponda.

Este primer movimiento no requiere:

- tablas nuevas;
- migraciones nuevas;
- cambios de RLS;
- SQL nuevo;
- modificación directa de producción.

Debe implementarse y validarse en Preview antes de cualquier merge o despliegue.

## 5. Contrato Orchestrator → CORE para contactos

Movimientos relevantes ya documentados:

- CRM-042B — escritura segura de proveedores y clientes en CORE.
- CRM-042C — servicios de escritura desde Orchestrator.
- CRM-042D — flujo conversacional desde WhatsApp.
- CRM-042H — contactos múltiples y normalización E.164.
- CRM-042I — agregar y editar contactos.
- CRM-042J — variantes naturales de comandos.

El adapter deriva el endpoint de contactos reemplazando `/api/crm` por `/api/crm-contact`.

### Acciones verificadas

| Acción | Entrada mínima | Salida esperada |
|---|---|---|
| `find_supplier` | `name` | `supplier` o error de búsqueda |
| `list_contacts` | `identityId` | arreglo `contacts` |
| `add_contact` | `identityId`, `whatsapp` | contacto creado |
| `update_contact` | `identityId`, `contactId`, campo(s) | contacto actualizado |

Autorización: `Bearer` aceptado contra `KAVTORE_SESSION_TOKEN` o `CRM_INTERNAL_TOKEN`.

## 6. Persistencia de contactos

La migración `supabase/migrations/20260712_crm_042h_multi_contact.sql` crea `public.crm_contacts` con:

- `id` UUID;
- `identity_id` como FK a `crm_identities`;
- nombre y cargo o área;
- WhatsApp obligatorio;
- teléfono, correo, país, ciudad, dirección y notas;
- contacto principal;
- estado;
- metadata;
- fechas.

Seguridad declarada en la migración:

- RLS habilitado;
- permisos retirados a `anon` y `authenticated`;
- acceso concedido a `service_role`.

## 7. Incidente histórico Vargas Centro

### Hechos verificados

1. `findSupplier()` consulta `crm_identities` y puede encontrar una identidad de tipo proveedor.
2. `listContacts(identityId)` consulta exclusivamente `crm_contacts`.
3. `crmConversationService` lanza `CRM_SUPPLIER_HAS_NO_CONTACTS` cuando la respuesta contiene cero contactos.
4. La migración que crea `crm_contacts` no contiene backfill ni copia desde tablas anteriores.

### Conclusión

La existencia del proveedor en `crm_identities` no implica la existencia de un registro en `crm_contacts`. El error demuestra únicamente que la tabla nueva no devuelve contactos activos asociados al `identity_id` consultado.

### Pendientes de datos vivos

- ubicación exacta del contacto histórico;
- posible existencia en perfiles o tablas heredadas;
- identidad real vinculada;
- necesidad de backfill;
- reglas de deduplicación y contacto principal.

No ejecutar backfill sin consulta previa, respaldo y regla de deduplicación.

## 8. Responsabilidades por componente

### ELANKAV Core

Responsable de:

- identidad maestra;
- roles;
- relaciones;
- contactos;
- contratos de lectura y escritura del CRM;
- acceso servidor a Supabase.

No debe convertirse en ERP ni absorber OT, OC, producción, inventario o compras.

### Orchestrator

Responsable de:

- coordinación;
- WhatsApp y WAHA;
- jobs;
- automatizaciones;
- adapters y services;
- consumo de APIs autorizadas del CORE.

No debe derivar relaciones maestras desde conversaciones cuando existe un contrato oficial de relaciones.

### Plataformas

ELANVISUAL, ELANHOME y ELANPET deben reutilizar `crm_identities.id` y conservar únicamente la lógica operacional específica de su dominio.

## 9. Riesgos vigentes

- reconstruir relaciones desde conversaciones;
- duplicar identidades por plataforma o rol;
- usar `canonical_id` como clave relacional permanente;
- mezclar snapshots documentales con datos maestros editables;
- conectar interfaces directamente a Supabase cuando existe Adapter o Service;
- ampliar el CORE con lógica propia de ERP o marketplace;
- ejecutar backfills sin evidencia de datos históricos.

## 10. Criterio de cierre CRM-101A

CRM-101A se considera cerrado únicamente cuando:

1. el endpoint de lectura devuelve identidad, roles y relaciones;
2. las plataformas se derivan desde `crm_client_relationships`;
3. una identidad sin conversaciones conserva sus plataformas asociadas;
4. una identidad con múltiples roles no se duplica;
5. `customer_id` continúa referenciando `crm_identities.id`;
6. el dashboard deja de usar conversaciones como fuente maestra de plataformas;
7. existen pruebas de contrato y regresión;
8. el cambio se valida en Preview;
9. la documentación y la línea base se actualizan con commit y PR.

## 11. Prohibiciones

- No crear otro CRM.
- No crear tablas nuevas para resolver CRM-101A.
- No duplicar identidades por plataforma.
- No modificar Supabase ni RLS sin evidencia de necesidad.
- No desplegar antes de validar en Preview.
- No repetir la auditoría del modelo de identidad salvo que cambien el código, las migraciones o el contrato.

## 12. Estado documental

| Movimiento | Estado | Fecha |
|---|---|---|
| CRM-042B/J | Documentado; validación E2E debe conservarse | Julio de 2026 |
| Auditoría de identidad, roles y relaciones | CERRADA | 21 de julio de 2026 |
| CRM-101A — ampliación del contrato de lectura | PROPUESTO / NO IMPLEMENTADO | 21 de julio de 2026 |

Clasificación de la conclusión CRM-101A: **VERIFICADO en código para el modelo y el origen actual de plataformas; PROPUESTA para la corrección del contrato**.
