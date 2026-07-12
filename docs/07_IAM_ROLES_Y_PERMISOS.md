# 07 — IAM, roles, permisos y delegación

## Estado

**DOCUMENTADO / PROPUESTA DE IMPLEMENTACIÓN**

Este documento define la arquitectura oficial de identidad, autorización y delegación para ELAN IA. No representa todavía una implementación completa del IAM operativo.

## Principio central

ELAN IA puede tener capacidad técnica amplia sobre el ecosistema, pero ninguna respuesta ni acción se autoriza por la capacidad del agente. Se autoriza por la identidad, rol y permisos del remitente.

```text
Capacidad técnica de ELAN IA
≠
Permiso del usuario que solicita
```

## Identidades telefónicas confirmadas

| Número | Función | Privilegio |
|---|---|---|
| `50578828089` | Número receptor operativo de ELAN IA y canal de entrada de clientes | No activa Owner Mode por sí mismo |
| `50588388940` | Número personal de Erick Cano | OWNER con acceso total |

### Regla obligatoria

Owner Mode se determina por el número del **remitente**. El número receptor de ELAN IA nunca debe usarse para conceder privilegios.

```text
Cliente → 50578828089 → modo cliente
50588388940 → 50578828089 → Owner Mode
```

## Flujo de autorización

```text
Mensaje entrante
  ↓
Resolver identidad canónica del remitente
  ↓
Resolver tipo de identidad
  ↓
Resolver rol
  ↓
Resolver permisos efectivos
  ↓
Autorizar o denegar consulta/acción
  ↓
Consultar servicios y adapters
  ↓
Filtrar datos de salida
  ↓
Registrar auditoría
  ↓
Responder o ejecutar
```

## Componentes requeridos

La arquitectura objetivo debe respetar:

```text
Identity Resolver
  ↓
Role Resolver
  ↓
Permission Registry
  ↓
Authorization Service
  ↓
Servicios / Adapters
  ↓
Audit Log
```

La interfaz conversacional no debe acceder directamente a Supabase ni decidir permisos por prompt.

## Roles iniciales

### OWNER

Propietario del ecosistema.

Permisos esperados:

- acceso total a información operativa y administrativa;
- gestión de usuarios, roles y permisos;
- aprobación de acciones críticas;
- acceso a GitHub, Docker, WAHA, CRM, inventario, producción, finanzas, documentos y configuración;
- capacidad de suspender, delegar y revocar accesos.

Identidad inicial:

```text
50588388940
```

### ADMIN

Administrador delegado.

Permisos esperados:

- administrar módulos autorizados;
- crear y mantener usuarios según política;
- revisar auditorías;
- ejecutar acciones administrativas no reservadas exclusivamente al OWNER.

No debe poder elevar sus propios permisos ni modificar al OWNER.

### EXECUTIVE

Ejecutivo comercial.

Permisos esperados:

- CRM;
- clientes y leads;
- cotizaciones;
- seguimientos;
- oportunidades;
- tareas comerciales.

No debe acceder por defecto a infraestructura, secretos, costos internos completos ni finanzas globales.

### WORKER

Trabajador operativo.

Permisos dependen del área asignada, por ejemplo:

- producción;
- instalación;
- inventario;
- despacho;
- soporte.

Debe aplicar mínimo privilegio y acceso solo al trabajo asignado.

### SUPPLIER

Proveedor externo.

Permisos esperados:

- su propia ficha;
- solicitudes u órdenes relacionadas;
- documentos autorizados;
- comunicaciones y estados que le correspondan.

No es un usuario interno por defecto.

### CUSTOMER

Cliente externo.

Permisos esperados:

- su propia información;
- sus cotizaciones;
- sus pedidos;
- sus pagos y documentos permitidos;
- estado de producción o entrega cuando aplique.

Nunca puede ver datos de otros clientes ni información interna.

## Creación por órdenes conversacionales

Solo una identidad autorizada debe poder ordenar la creación o delegación de usuarios.

Ejemplos futuros:

```text
Crea un ejecutivo llamado Ana López con WhatsApp +505...
Área ventas.
```

```text
Crea un trabajador llamado Carlos Pérez.
Área producción.
```

```text
Dale a Ana acceso a CRM y cotizaciones, pero no a costos internos.
```

```text
Suspende el acceso de Carlos.
```

## Flujo obligatorio para crear o modificar acceso

1. Verificar identidad del remitente.
2. Verificar permiso para administrar usuarios.
3. Interpretar tipo de identidad, rol y área.
4. Resolver plantilla de permisos predeterminada.
5. Mostrar resumen previo.
6. Solicitar confirmación en acciones sensibles.
7. Crear o actualizar identidad.
8. Asignar rol y permisos.
9. Registrar actor, fecha, canal, cambio y resultado.
10. Confirmar la operación sin mostrar secretos.

## Plantillas de acceso

Cada tipo debe tener una plantilla predeterminada versionada.

Ejemplo conceptual:

```text
EXECUTIVE_SALES
- crm.contacts.read
- crm.contacts.write
- crm.opportunities.read
- crm.opportunities.write
- quotes.read
- quotes.create
- infrastructure.* = DENY
- finance.internal_costs = DENY
```

```text
WORKER_PRODUCTION
- production.orders.read_assigned
- production.orders.update_status
- inventory.materials.read
- finance.* = DENY
- crm.full = DENY
```

## Permisos granulares recomendados

Formato:

```text
módulo.recurso.acción
```

Ejemplos:

- `crm.contacts.read`
- `crm.contacts.write`
- `quotes.create`
- `quotes.approve_discount`
- `production.orders.update_status`
- `inventory.stock.read`
- `finance.payments.approve`
- `github.repositories.read`
- `docker.containers.read`
- `iam.users.create`
- `iam.permissions.assign`

## Reglas de seguridad

1. Denegar por defecto.
2. Mínimo privilegio.
3. El OWNER no se define por nombre visible, sino por identidad canónica verificada.
4. El número receptor de ELAN IA no concede permisos.
5. Los permisos deben validarse en servicios o adapters, no solo en prompts.
6. Toda elevación de privilegios debe auditarse.
7. Ningún usuario puede otorgar permisos superiores a los propios.
8. Las acciones destructivas requieren confirmación reforzada.
9. Las credenciales y secretos nunca se envían al modelo si no son necesarios.
10. Los usuarios no identificados reciben permisos mínimos de CUSTOMER o GUEST.

## Auditoría mínima

Cada operación debe registrar:

- actor canónico;
- número o canal de origen;
- rol efectivo;
- permiso evaluado;
- acción solicitada;
- recurso afectado;
- datos antes/después cuando corresponda;
- resultado;
- fecha y hora;
- identificador de solicitud.

## Estado de implementación

### Verificado

- Existe resolución básica de identidad del remitente.
- Existe Owner Mode.
- `50588388940` es la identidad OWNER autorizada.
- `50578828089` es el número receptor operativo de ELAN IA.
- El contexto vivo del ecosistema ya puede llegar al asistente en Owner Mode.

### Pendiente

- Persistencia central de roles y permisos.
- Catálogo versionado de permisos.
- Authorization Service.
- Comandos de creación de ejecutivos y trabajadores.
- Asignación y revocación por mensaje.
- Auditoría central de cambios IAM.
- Pruebas E2E por rol.

## Criterio de cierre de IAM operativo

IAM se considerará operativo cuando:

1. OWNER sea reconocido de extremo a extremo;
2. exista una fuente oficial de roles y permisos;
3. todos los servicios sensibles validen autorización;
4. se puedan crear, suspender y modificar usuarios por orden autorizada;
5. existan confirmaciones para cambios críticos;
6. exista auditoría completa;
7. existan pruebas negativas y de escalamiento de privilegios;
8. ningún cliente pueda acceder a información interna;
9. el número receptor de ELAN IA no sea tratado como OWNER;
10. la documentación y el esquema estén versionados.
