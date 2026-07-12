# 03 — CRM y contactos

## 1. Estado funcional documentado

Movimientos relevantes:

- CRM-042B — escritura segura de proveedores y clientes en CORE.
- CRM-042C — servicios de escritura desde Orchestrator.
- CRM-042D — flujo conversacional desde WhatsApp.
- CRM-042H — contactos múltiples y E.164.
- CRM-042I — agregar y editar contactos.
- CRM-042J — variantes naturales de comandos.

## 2. Contrato Orchestrator → CORE

El adapter deriva el endpoint de contactos reemplazando `/api/crm` por `/api/crm-contact`.

### Acciones verificadas

| Acción | Entrada mínima | Salida esperada |
|---|---|---|
| `find_supplier` | `name` | `supplier` o error de búsqueda |
| `list_contacts` | `identityId` | arreglo `contacts` |
| `add_contact` | `identityId`, `whatsapp` | contacto creado |
| `update_contact` | `identityId`, `contactId`, campo(s) | contacto actualizado |

Autorización: `Bearer` aceptado contra `KAVTORE_SESSION_TOKEN` o `CRM_INTERNAL_TOKEN`.

## 3. Persistencia verificada

La migración `supabase/migrations/20260712_crm_042h_multi_contact.sql` crea `public.crm_contacts` con:

- `id` UUID;
- `identity_id` FK a `crm_identities`;
- nombre y cargo/área;
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

## 4. Causa técnica del incidente Vargas Centro

### Hechos verificados

1. `findSupplier()` consulta `crm_identities` y puede encontrar una identidad de tipo proveedor.
2. `listContacts(identityId)` consulta exclusivamente `crm_contacts`.
3. `crmConversationService` lanza `CRM_SUPPLIER_HAS_NO_CONTACTS` cuando la respuesta contiene cero contactos.
4. La migración que crea `crm_contacts` no contiene backfill ni copia desde tablas anteriores.

### Conclusión

La existencia del proveedor en `crm_identities` no implica la existencia de un registro en `crm_contacts`. El error no demuestra que nunca existió información de contacto; demuestra únicamente que la tabla nueva no devuelve contactos activos asociados al `identity_id` consultado.

### Hipótesis todavía pendientes de datos vivos

- El contacto histórico está en `crm_supplier_profiles`.
- El contacto histórico está en `crm_supplier_contacts`.
- El contacto se guardó como columnas del perfil o identidad.
- El contacto existe con otro `identity_id`.
- La migración se ejecutó sin backfill.
- El contacto nuevo fue creado pero quedó inactivo o con relación incorrecta.

## 5. Riesgos del contrato actual

### Búsqueda de proveedor

`findSupplier` descarga hasta 500 proveedores activos y filtra coincidencias parciales en memoria. Riesgos:

- ambigüedad por nombres similares;
- límite fijo de 500;
- costo creciente;
- coincidencia parcial no indexada.

### Listado de contactos

Solo devuelve contactos con `status=active`. Un contacto histórico inactivo no aparece en el editor.

### Auditoría

Agregar y editar contacto intenta insertar un evento en `crm_audit_events`. Si la auditoría falla, la operación puede responder error después de escribir el contacto, dependiendo del orden y comportamiento de Supabase.

### Consistencia E.164

Existe normalización tanto en Orchestrator como en CORE. Debe mantenerse un contrato único para evitar divergencias futuras.

## 6. Criterio real de cierre CRM-042

El bloque solo está cerrado cuando se verifica de extremo a extremo:

1. crear proveedor;
2. crear cliente;
3. crear contacto principal;
4. agregar segundo contacto;
5. listar contactos;
6. editar cada campo permitido;
7. conservar datos tras reinicio;
8. operar desde WhatsApp;
9. registrar auditoría;
10. manejar contacto heredado sin pérdida ni duplicación.

## 7. Prohibiciones hasta cerrar la auditoría de datos

- No crear otra integración de WhatsApp.
- No crear otro CRM.
- No crear identidades duplicadas.
- No modificar el editor para ocultar el error.
- No insertar contactos manuales sin identificar primero la fuente histórica.
- No ejecutar backfill sin consulta previa, respaldo y regla de deduplicación.