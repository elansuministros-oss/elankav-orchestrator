# CRM-042 — Plan maestro de integración operativa desde WhatsApp

## Estado

EN DESARROLLO

Fecha de inicio: 2026-07-11

Esta fase permanecerá abierta hasta validar la creación real de proveedores y clientes desde WhatsApp, con persistencia confirmada en Supabase y consulta posterior desde ELAN IA.

## Objetivo

Extender CRM-041, actualmente operativo en modo de consulta, para permitir escritura controlada desde Owner Mode mediante ELAN IA.

La primera validación funcional será:

1. Crear un proveedor desde WhatsApp.
2. Crear un cliente desde WhatsApp.
3. Confirmar ambos registros en CRM Core y Supabase.
4. Consultarlos posteriormente desde ELAN IA.

## Arquitectura obligatoria

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
Command Service
↓
CRM Service
↓
CRM Adapter
↓
API protegida `/api/crm`
↓
Supabase CRM Core

Está prohibido conectar WhatsApp, OpenAI, la UI o una plataforma directamente con Supabase si existe una capa Adapter o Service.

## Modelo maestro aprobado

### Identidades globales

El núcleo manejará una identidad maestra reutilizable. Una misma persona o empresa puede tener uno o varios roles sin duplicarse.

Roles previstos:

- proveedor;
- cliente;
- trabajador;
- vendedor;
- administrador;
- roles operativos futuros.

### Proveedores

Los proveedores son globales y se registran una sola vez para todo ELANKAV.

Tipos iniciales:

- proveedor de materia prima;
- proveedor de servicios;
- proveedor mixto.

Ejemplos de materia prima:

- lonas;
- viniles;
- laminados;
- acrílicos;
- PVC;
- ACM;
- perfiles;
- láminas;
- ferretería;
- iluminación;
- adhesivos;
- pintura.

Ejemplos de servicios:

- impresión;
- instalación;
- corte CNC;
- corte láser;
- soldadura;
- transporte;
- mensajería;
- diseño;
- mantenimiento.

La identidad del proveedor es global, pero cada precio, compra, factura, orden o relación operativa debe conservar la plataforma de origen cuando corresponda.

### Trabajadores

Los trabajadores se registran una sola vez en el núcleo general.

Más adelante podrán recibir roles como:

- producción;
- instalador;
- mensajero;
- contador;
- cartera y cobro;
- compras;
- diseñador;
- supervisor;
- bodega.

Los accesos futuros serán restringidos según rol, plataforma, alcance y permisos.

Funciones previstas:

- asistencia con fecha, hora y ubicación;
- horas extras sujetas a validación;
- salario;
- viáticos;
- anticipos;
- compras asignadas;
- envío de comprobantes;
- reembolsos;
- tareas y evidencias.

Ningún comprobante afectará gastos, pagos, nómina o saldos sin validación.

### Vendedores

Los vendedores se registran una sola vez como identidad y usuario, pero se clasifican mediante membresías por plataforma.

Un vendedor podrá tener acceso a una, varias o todas las plataformas autorizadas.

Cada plataforma definirá su propia operación comercial, cotizaciones, comisiones, pedidos y seguimiento.

### Clientes

Los clientes se vinculan a una plataforma y a un responsable comercial.

Reglas:

1. Todo cliente debe pertenecer a una plataforma.
2. Todo cliente debe tener responsable comercial.
3. Si no se especifica vendedor, el responsable será el administrador.
4. La identidad puede reutilizarse en varias plataformas sin duplicarse.
5. Cada relación comercial conserva plataforma, responsable, historial y operaciones propias.
6. Cada plataforma define sus propias reglas de comisiones y operación.

## Usuarios, roles y plataformas

El modelo de autorización será:

Usuario autenticado
↓
Identidad
↓
Rol funcional
↓
Membresía por plataforma
↓
Permisos
↓
Alcance de datos

El administrador tendrá acceso total mediante permiso explícito y con auditoría de acciones críticas.

Ejemplos de roles futuros:

- administrador: acceso global;
- contador: finanzas, cuentas por pagar, cuentas por cobrar, nómina y cierres;
- cartera y cobro: entregas, facturación, saldos, cobros y comprobantes;
- compras: proveedores, solicitudes, órdenes de compra, recepción y facturas;
- vendedor: clientes y operaciones de sus plataformas;
- producción: órdenes y ejecución;
- trabajador operativo: información y tareas propias.

Cada plataforma consumirá los permisos del núcleo, pero gobernará su propia operación.

## IA transversal

ELAN IA podrá consultar y ejecutar acciones en todo el ecosistema cuando el usuario tenga autorización suficiente.

La IA deberá:

1. identificar al usuario;
2. determinar Owner Mode o rol autorizado;
3. identificar la plataforma;
4. consultar las reglas de la plataforma correspondiente;
5. ejecutar mediante Services y Adapters;
6. devolver únicamente resultados confirmados.

La IA no impondrá una lógica comercial única a todas las plataformas.

## Data autoalimentada

Cada interacción útil podrá generar datos estructurados con trazabilidad.

Ejemplo futuro para proveedor:

Proveedor identificado
↓
Mensaje, foto, PDF o lista recibido
↓
Extracción preliminar
↓
Registro pendiente de validación
↓
Aprobación
↓
EMC oficial

Los precios, productos y documentos recibidos no entrarán directamente al catálogo oficial. Existirá una bandeja de validación antes de afectar EMC, inventario, finanzas o producción.

## Alcance funcional de CRM-042

CRM-042 implementará inicialmente:

1. creación segura de proveedores globales;
2. clasificación del tipo de proveedor;
3. creación segura de clientes;
4. vínculo cliente-plataforma;
5. asignación de responsable comercial;
6. prevención básica de duplicados;
7. recopilación conversacional de datos;
8. confirmación obligatoria antes de guardar;
9. persistencia en Supabase;
10. consulta posterior desde ELAN IA;
11. auditoría y documentación.

No se implementarán todavía:

- nómina;
- asistencia;
- comisiones definitivas;
- órdenes de compra completas;
- EMC automática;
- permisos completos por rol;
- operación interna específica de cada plataforma.

Solo se dejarán contratos y puntos de extensión para estas conexiones futuras.

## Flujo objetivo: proveedor

Administrador:

“Quiero agregar un proveedor.”

ELAN IA solicitará un dato por mensaje, mostrará un resumen y pedirá confirmación.

Solo después de confirmación explícita ejecutará la escritura.

Respuesta de éxito únicamente después de recibir confirmación positiva de la API:

“Proveedor registrado correctamente en el CRM.”

## Flujo objetivo: cliente

Administrador:

“Quiero agregar un cliente.”

ELAN IA deberá solicitar:

- plataforma;
- nombre;
- datos mínimos necesarios;
- responsable comercial, si se especifica.

Si no se indica vendedor, se asignará el administrador como responsable comercial.

Antes de escribir mostrará el resumen y solicitará confirmación.

## Seguridad

- Solo Owner Mode o roles internos autorizados podrán crear registros.
- Mantener Bearer Token.
- Mantener token interno Orchestrator ↔ CRM.
- Mantener RLS.
- Service Role únicamente en Core.
- OpenAI no genera SQL.
- OpenAI no recibe secretos.
- La API usa lista blanca de campos.
- Los payloads desconocidos deben rechazarse.
- No confirmar escrituras fallidas.
- Toda acción debe quedar auditada.

## Duplicados

### Proveedores

Verificar coincidencias por:

- nombre normalizado;
- teléfono o WhatsApp;
- correo.

### Clientes

1. Buscar identidad existente.
2. Verificar relación con la plataforma.
3. Reutilizar identidad si ya existe en otra plataforma.
4. No duplicar la relación dentro de la misma plataforma.

## Movimientos de ejecución

### CRM-042A — Auditoría y contratos

- revisar esquema actual;
- revisar documentación;
- confirmar tablas y relaciones existentes;
- definir contratos mínimos sin duplicar estructuras.

### CRM-042B — Escritura segura en Core

- crear proveedor;
- crear cliente;
- crear relación cliente-plataforma;
- asignar responsable comercial;
- detectar duplicados;
- pruebas y autorización.

### CRM-042C — Adapter y Services en Orchestrator

- CRM Write Adapter;
- Supplier Service;
- Client Service;
- manejo controlado de respuestas y errores.

### CRM-042D — Flujo conversacional de Owner Mode

- detectar intención;
- recopilar datos uno por uno;
- mantener estado conversacional;
- permitir cancelación.

### CRM-042E — Confirmación y escritura

- no guardar sin confirmación explícita;
- ejecutar la API;
- responder según el resultado real.

### CRM-042F — Validación desde WhatsApp

- crear proveedor real;
- consultar proveedor creado;
- crear cliente real;
- consultar cliente creado;
- verificar persistencia tras reinicio;
- comprobar ausencia de duplicados.

### CRM-042G — Documentación y cierre

- actualizar este documento;
- documentar arquitectura final;
- registrar archivos y commits;
- incluir evidencia funcional;
- declarar cierre únicamente al cumplir los criterios.

## Validación obligatoria

### Proveedores

- creación desde WhatsApp;
- datos solicitados uno por uno;
- cancelación sin escritura;
- confirmación con escritura;
- consulta posterior;
- detección de duplicados;
- proveedor de materiales;
- proveedor de servicios;
- proveedor mixto;
- rechazo a usuario externo.

### Clientes

- creación para ELANVISUAL;
- creación para otra plataforma;
- administrador como responsable por defecto;
- vendedor válido como responsable;
- rechazo de plataforma inexistente;
- reutilización de identidad existente;
- no duplicar relación;
- consulta posterior;
- rechazo a usuario no autorizado.

### Técnicas

- build de Core;
- tests de Core;
- build de Orchestrator;
- tests de Orchestrator;
- `git diff --check`;
- 401 sin token;
- token interno válido;
- rechazo de token inválido;
- Supabase no expuesto;
- CRM-041 continúa operativo.

## Criterio oficial de cierre

CRM-042 permanecerá ABIERTO mientras falle cualquiera de estas condiciones:

- no se puede crear proveedor desde WhatsApp;
- no se puede crear cliente desde WhatsApp;
- los registros no persisten en Supabase;
- ELAN IA confirma una escritura no realizada;
- se duplican identidades;
- el cliente no queda clasificado por plataforma;
- el cliente queda sin responsable comercial;
- un usuario externo puede crear registros;
- CRM-041 deja de funcionar;
- falta documentación técnica.

CRM-042 se declarará COMPLETADO únicamente cuando proveedores y clientes puedan crearse, verificarse y consultarse correctamente desde WhatsApp.

## Registro inicial

- CRM-041 validado y documentado.
- CRM-042 iniciado.
- Primer objetivo operativo: proveedor y cliente desde WhatsApp.
- Código de producción todavía sin modificar en este documento de inicio.
