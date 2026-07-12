# CRM-042A — Auditoría del modelo CRM actual

## Estado

COMPLETADO.

Fecha: 2026-07-11

Este movimiento fue únicamente de auditoría. No se modificó código de producción.

## Objetivo

Verificar el estado real del CRM Core antes de implementar escritura operativa de proveedores y clientes desde WhatsApp.

## Repositorios auditados

- `elansuministros-oss/elankav-core`
- `elansuministros-oss/elankav-orchestrator`

## Documentación verificada

- `docs/auditorias/CRM-041-CIERRE.md`
- `docs/auditorias/crm/README.md`
- `docs/auditorias/crm/CRM-042-PLAN-MAESTRO.md`

## Arquitectura validada

WhatsApp
↓
WAHA
↓
Identity Bridge
↓
Owner Mode
↓
ELAN IA / Orchestrator
↓
CRM Context Service
↓
API protegida `/api/crm`
↓
Supabase CRM Core

CRM-041 permanece operativo en modo de lectura.

## Esquema existente confirmado

Migración oficial:

`supabase/migrations/20260711_crm_core_001.sql`

### `crm_identities`

Identidad maestra reutilizable.

Campos principales:

- `id`
- `canonical_id`
- `display_name`
- `entity_type`
- `status`
- `metadata`
- fechas de creación y actualización

Conclusión:

La tabla puede reutilizarse como núcleo común para proveedores, clientes, trabajadores, vendedores y administradores. No debe crearse una tabla maestra duplicada por tipo de persona o empresa.

### `crm_identity_aliases`

Permite vincular una identidad con identificadores externos por canal.

Usos previstos:

- WhatsApp
- correo
- identificadores externos futuros

Conclusión:

Debe reutilizarse para reconocer al remitente y prevenir duplicados por teléfono o canal.

### `crm_roles`

Campos principales:

- `identity_id`
- `role`
- `platform`
- `active`

Existe una restricción única por identidad, rol y plataforma.

Conclusión:

La estructura ya permite:

- roles globales con `platform` vacío;
- roles específicos por plataforma;
- múltiples roles para una misma identidad.

Debe reutilizarse para:

- proveedor global;
- trabajador global;
- vendedor por plataforma;
- administrador global;
- otros roles futuros.

### `crm_organizations`

Permite registrar empresas u organizaciones separadas de las personas.

### `crm_identity_organizations`

Permite vincular identidades con organizaciones mediante un tipo de relación.

Conclusión:

Esta relación puede ser útil para contactos de empresas, trabajadores, responsables y representantes, pero no sustituye la relación cliente-plataforma.

### `crm_conversations`

Ya contiene:

- identidad;
- canal;
- plataforma;
- etapa;
- estado;
- responsable asignado;
- metadata.

Conclusión:

La conversación puede conservar correctamente la plataforma y el responsable operativo.

### `crm_messages`

Ya conserva:

- conversación;
- dirección;
- remitente;
- contenido;
- tipo de mensaje;
- payload original;
- metadata.

Conclusión:

La estructura admite futuras fotos, PDFs, comprobantes, listas de precios y documentos sin rediseñar el núcleo.

## Seguridad confirmada

Las tablas CRM tienen RLS habilitado.

Los roles `anon` y `authenticated` no tienen acceso directo.

Las operaciones se realizan mediante `/api/crm` usando `service_role` únicamente en Core.

La API acepta:

- `KAVTORE_SESSION_TOKEN`;
- `CRM_INTERNAL_TOKEN`.

Conclusión:

No se debe modificar la arquitectura de seguridad para CRM-042.

## API actual

Ruta:

`api/crm.js`

Operaciones actuales:

- `GET`: dashboard de identidades, conversaciones y mensajes.
- `POST`: únicamente `create_identity`.

La acción `create_identity` actual registra:

- `canonical_id`;
- `display_name`;
- `entity_type`;
- metadata fija de validación UI.

## Brechas detectadas

La estructura existente no cubre todavía de forma explícita:

1. Perfil operativo de proveedor global.
2. Tipo de proveedor: materiales, servicios o mixto.
3. Datos comerciales estructurados del proveedor.
4. Relación cliente-plataforma.
5. Responsable comercial del cliente.
6. Asignación automática del administrador cuando no existe vendedor.
7. Búsqueda controlada de duplicados.
8. Auditoría específica de acciones de escritura.
9. Contratos de API `create_supplier` y `create_client`.
10. Escritura desde Orchestrator.
11. Flujo conversacional con recopilación y confirmación.

## Decisiones aprobadas

### Identidad

Se reutilizará `crm_identities` como identidad maestra.

### Proveedores

Los proveedores serán globales.

Su rol se representará como rol global, sin plataforma obligatoria.

No se duplicará un proveedor por plataforma.

### Trabajadores

Los trabajadores serán globales y recibirán roles y asignaciones posteriormente.

### Vendedores

Los vendedores se representarán mediante roles o membresías por plataforma.

Una identidad podrá participar en múltiples plataformas.

### Clientes

La identidad del cliente será global, pero su relación comercial será específica por plataforma.

Cada relación deberá conservar:

- plataforma;
- responsable comercial;
- estado;
- fuente;
- fecha de asignación.

Si no se indica vendedor, el administrador será el responsable comercial predeterminado.

### Operación por plataforma

Cada plataforma gobernará:

- cotización;
- comisiones;
- pedidos;
- producción;
- cobros;
- reglas comerciales.

CRM Core conservará identidad, relación, plataforma, responsable y trazabilidad.

## Estructuras que no deben duplicarse

No crear nuevas tablas maestras independientes para:

- proveedores;
- clientes;
- trabajadores;
- vendedores.

Los perfiles específicos deberán depender de `crm_identities`.

## Puntos de extensión futuros

La arquitectura debe dejar contratos para:

- permisos por rol y plataforma;
- usuarios y Supabase Auth;
- asistencia y ubicación;
- nómina, viáticos y horas extras;
- compras y órdenes de compra;
- comprobantes pendientes de validación;
- EMC y precios recibidos de proveedores;
- operación específica por plataforma.

Estos módulos no forman parte del alcance funcional inmediato de CRM-042.

## Próximo movimiento único

### CRM-042B — Contratos mínimos y escritura segura en Core

Implementar exclusivamente:

1. Contrato de creación de proveedor global.
2. Contrato de creación de cliente por plataforma.
3. Relación cliente-plataforma-responsable.
4. Asignación del administrador por defecto.
5. Búsqueda básica de duplicados.
6. Lista blanca y validación de payloads.
7. Respuestas estructuradas de API.
8. Pruebas de autorización y regresión.

No modificar todavía:

- WAHA;
- Identity Bridge;
- Owner Mode;
- flujo conversacional;
- EMC;
- finanzas;
- permisos completos;
- operación de plataformas.

## Criterio de validación de CRM-042B

- API sin token devuelve 401.
- Token interno válido funciona.
- `create_identity` existente continúa funcionando.
- Se puede crear proveedor global mediante API.
- Se puede crear cliente con plataforma y responsable.
- Si no hay vendedor, se asigna administrador.
- No se duplica una identidad existente.
- No se duplica la relación cliente-plataforma.
- Build y tests pasan.
- `git diff --check` pasa.

## Resultado

CRM-042A completado.

La arquitectura existente es reutilizable y no requiere reconstrucción. El siguiente paso debe ampliar el Core mediante contratos mínimos y desacoplados, sin romper CRM-041.