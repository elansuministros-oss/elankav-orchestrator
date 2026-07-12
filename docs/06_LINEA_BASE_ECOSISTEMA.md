# 06 — Línea base oficial del ecosistema ELANKAV

## Propósito

Este documento conserva el resultado consolidado de la auditoría documental realizada en julio de 2026. Su función es evitar que cada operador, chat o movimiento tenga que reconstruir desde cero qué existe, cómo se conecta y qué permanece pendiente de verificación.

No sustituye auditorías futuras. Define el punto de partida oficial que debe actualizarse por diferencias.

## Identificación de la línea base

| Campo | Valor |
|---|---|
| Fecha de consolidación | 12 de julio de 2026 |
| Repositorio documental | `elansuministros-oss/elankav-orchestrator` |
| Rama documental | `docs/auditoria-maestra-2026-07` |
| Rama operativa auditada | `orchestrator-next` |
| Commit operativo base | `c9f9dc4b0f594cd52bf97f9ba2aae22cc126136e` |
| Alcance | GitHub, código versionado, PR, commits, migraciones y contratos encontrados |
| Exclusiones | Datos vivos de Supabase, entorno VPS, sesión WAHA y estado vivo de servicios |

## Regla de uso

Antes de iniciar una nueva auditoría:

1. leer este documento;
2. identificar el commit o fecha actual;
3. comparar únicamente cambios posteriores a la línea base;
4. no repetir hallazgos ya clasificados como VERIFICADOS;
5. actualizar esta línea base cuando una hipótesis sea confirmada o descartada.

## Clasificación de evidencia

- **VERIFICADO:** respaldado por código, Git, migración o contrato versionado.
- **DECLARADO:** registrado en PR, commit o configuración, sin validación directa del entorno vivo.
- **PENDIENTE:** requiere consulta adicional.
- **PROPUESTA:** medida recomendada, todavía no implementada.

# 1. Inventario de repositorios accesibles

| Repositorio | Visibilidad | Rama predeterminada | Función observada | Estado documental |
|---|---|---|---|---|
| `elankav-orchestrator` | Pública | `orchestrator-next` | Plano de control, monitoreo, mensajes, jobs y decisiones Git | Documentación maestra creada |
| `elankav-core` | Pública | `main` | APIs internas, dominio CRM y acceso servidor a Supabase | README de plantilla; contratos reconstruidos parcialmente |
| `elan-ai` | Pública | `main` | Motor de inteligencia operacional | README mínimo e incompleto |
| `elanvisual-platform` | Pública | `elanvisual-desde-elanpet` | Plataforma ELANVISUAL | README heredado de ELANPET, incorrecto para el producto |
| `elanpet-platform` | Pública | `main` | Plataforma ELANPET | README funcional básico V7 |
| `elankav-platform` | Pública | `main` | Plataforma general ELANKAV | README genérico de Vite |
| `elankav-os` | Privada | `main` | Arquitectura o sistema operativo ELANKAV | Sin punto de entrada documental localizado |

## Regla de separación de productos

Los repositorios representan productos distintos. Pueden compartir infraestructura, estándares y contratos, pero no deben documentarse como un único producto mezclado.

# 2. Arquitectura confirmada

## 2.1 Flujo CRM y WhatsApp

```text
WhatsApp
  ↓
WAHA
  ↓
ELANKAV Orchestrator
  ↓
messageService
  ↓
crmConversationService
  ↓
contactService / supplierService / clientService
  ↓
crmWriteAdapter
  ↓
ELANKAV CORE API
  ↓
Supabase REST
```

### Límites arquitectónicos

- El Orchestrator no consulta directamente Supabase para el CRM.
- El Orchestrator consume APIs del CORE mediante adapter.
- El CORE utiliza credenciales de servidor para acceder a Supabase.
- La interfaz no debe conectarse directamente a la base cuando exista Adapter o Servicio.

## 2.2 Plano de control Orchestrator

El Orchestrator carga y coordina:

- `dockerAdapter`;
- `ecosystemAdapter`;
- `githubAdapter`;
- `dashboardAdapter`;
- `messageApi`;
- `jobApi`;
- `pullRequestDecisionApi`.

Endpoints observados:

```text
GET /health
GET /api/health
GET /api/dashboard
GET /api/ecosystem
GET /api/github
GET /api/docker
GET /api/projects
```

También existen handlers de mensajes, jobs y decisiones de PR cuyo contrato específico debe mantenerse en sus documentos correspondientes.

## 2.3 Observación de Docker

El adapter Docker ejecuta únicamente consultas observadas:

```text
docker ps --all
docker stats --no-stream
```

Datos obtenidos:

- nombre del contenedor;
- estado;
- condición running;
- CPU;
- memoria;
- procesos.

No se observaron en ese adapter acciones para iniciar, detener, eliminar o modificar contenedores.

## 2.4 Monitoreo del ecosistema

Servicios registrados en `config/ecosystem.json`:

- ELANVISUAL;
- ELANPET;
- ELANKAV CORE;
- ELANKAV PLATFORM;
- WAHA;
- ORCHESTRATOR.

El monitor actual considera `online` un servicio cuando recibe cualquier estado HTTP. Por tanto:

```text
online = alcanzable por HTTP
```

no necesariamente significa:

```text
healthy = funcional y respondiendo correctamente
```

Este comportamiento está documentado como deuda de observabilidad, no como cambio autorizado.

# 3. Estado del bloque CRM-042

## 3.1 Movimientos confirmados

| Movimiento | Resultado versionado |
|---|---|
| CRM-042B | Escritura segura de proveedores y clientes en CORE |
| CRM-042C | Servicios de escritura preparados en Orchestrator; PR original permanece abierto contra `main` |
| CRM-042D | Flujo conversacional para crear proveedor y cliente desde WhatsApp |
| CRM-042H | Tabla `crm_contacts`, múltiples contactos y normalización E.164 |
| CRM-042I | Búsqueda, listado, agregar y editar contactos mediante endpoint dedicado |
| CRM-042J | Variantes naturales de comandos `editar/edita/editá` y `agregar/agrega/agregá` |

## 3.2 Contrato Orchestrator → CORE

Endpoint derivado:

```text
POST /api/crm-contact
Authorization: Bearer <token interno>
Content-Type: application/json
```

Acciones observadas:

```text
find_supplier
list_contacts
add_contact
update_contact
```

Autorización aceptada por CORE:

- `KAVTORE_SESSION_TOKEN`;
- `CRM_INTERNAL_TOKEN`.

El CORE usa:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SERVICE_KEY`.

Los valores secretos no forman parte de esta documentación.

## 3.3 Modelo nuevo de contactos

La migración `20260712_crm_042h_multi_contact.sql` crea `public.crm_contacts` con:

- `id`;
- `identity_id`;
- `contact_name`;
- `role_or_area`;
- `whatsapp` obligatorio;
- `phone`;
- `email`;
- ubicación y dirección;
- notas;
- `is_primary`;
- `status`;
- `metadata`;
- timestamps.

Controles encontrados:

- relación con `crm_identities`;
- eliminación en cascada;
- restricción mínima de WhatsApp;
- unicidad de WhatsApp activo por identidad;
- índices de identidad y WhatsApp;
- RLS habilitado;
- acceso revocado a `anon` y `authenticated`;
- acceso otorgado a `service_role`.

## 3.4 Incidente Vargas Centro

### Hechos verificados

1. `find_supplier` busca en `crm_identities`.
2. `list_contacts` consulta exclusivamente `crm_contacts`.
3. El Orchestrator lanza `CRM_SUPPLIER_HAS_NO_CONTACTS` cuando la lista está vacía.
4. La migración CRM-042H crea la tabla nueva.
5. La migración no contiene backfill de contactos históricos.

### Conclusión técnica

La existencia de Vargas Centro como proveedor no garantiza que exista un registro relacionado en `crm_contacts`.

El editor nuevo puede encontrar la identidad y no encontrar contactos porque no consulta estructuras heredadas.

### Pendiente de comprobar

- tabla exacta donde reside el contacto histórico;
- columnas históricas en perfiles de proveedor;
- existencia de `crm_supplier_contacts` u otra tabla;
- identity ID real de Vargas Centro;
- necesidad de backfill;
- reglas de deduplicación y contacto principal.

### Prohibición operativa vigente

No modificar `crmConversationService`, el endpoint ni Supabase hasta localizar y clasificar los datos históricos.

# 4. Estado funcional documentado del ecosistema

## 4.1 Orchestrator

### Confirmado

- servidor Node HTTP;
- versión declarada `0.4.0` en el código auditado;
- escucha interna declarada en `172.19.0.1:4100`;
- carga `/etc/elankav-orchestrator.env`;
- dashboard agregado desde sistema, ecosistema, Docker y GitHub;
- estado conversacional CRM persistido en archivo JSON local;
- integración CRM mediante CORE.

### Pendiente vivo

- versión realmente desplegada;
- commit ejecutándose;
- estado systemd;
- mounts y persistencia del estado;
- endpoints públicos vivos;
- configuración proxy y TLS.

## 4.2 CORE

### Confirmado

- contiene API dedicada `api/crm-contact.js`;
- autentica con token interno;
- usa Supabase REST con service role;
- registra auditoría de altas y cambios de contactos;
- consulta `crm_identities`, `crm_contacts` y `crm_audit_events` en el flujo auditado;
- contiene migración versionada para contactos múltiples.

### Pendiente vivo

- esquema actual de producción;
- migraciones realmente aplicadas;
- contenido histórico;
- variables configuradas;
- deployment actual de Vercel.

## 4.3 ELAN AI

### Confirmado documentalmente

Arquitectura nominal declarada:

```text
Channel → Dispatcher → Planner → Memory → Knowledge → Reasoning → Operators → Tools → Business Engine
```

### Pendiente

- contratos de cada capa;
- dependencias reales;
- integración exacta con Orchestrator;
- despliegue;
- pruebas y observabilidad.

## 4.4 ELANVISUAL

### Confirmado

- repositorio independiente;
- rama predeterminada distinta de la rama operativa documentada en conversaciones;
- README actual corresponde a ELANPET, no a ELANVISUAL.

### Pendiente

- reemplazar documentación heredada;
- inventario formal de módulos;
- arquitectura actual del branch operativo;
- estado vivo de producción.

## 4.5 ELANPET

### Confirmado documentalmente

README V7 declara:

- catálogo y carrito;
- pago por transferencia;
- anticipo 60% o total;
- seguimiento;
- panel de producción;
- CMS;
- flujo de prueba.

### Riesgo documental

El README contiene usuarios demo con "cualquier contraseña". Debe verificarse que esto sea únicamente documentación de una versión demo y no una condición vigente en producción.

## 4.6 ELANKAV PLATFORM

- Repositorio accesible.
- README actual es una plantilla genérica de Vite.
- Función y contratos deben documentarse mediante auditoría específica.

## 4.7 ELANKAV OS

- Repositorio privado accesible.
- Rama principal `main`.
- No se localizó documentación raíz estándar.
- Requiere inventario específico antes de afirmar su estructura.

# 5. Calidad, seguridad y operación

## 5.1 Aspectos positivos

- movimientos Git generalmente pequeños;
- adapters y services presentes;
- service role limitado al servidor;
- RLS activado para `crm_contacts`;
- auditoría de cambios de contacto;
- validación E.164;
- separación Orchestrator/CORE;
- endpoints de observación del ecosistema.

## 5.2 Riesgos principales

1. documentación dispersa o incorrecta entre repositorios;
2. ausencia de backfill histórico de contactos;
3. pruebas declaradas en PR sin evidencia CI visible;
4. estado conversacional local no diseñado para varias instancias;
5. monitoreo HTTP que confunde alcanzable con saludable;
6. diferencias entre ramas declaradas, predeterminadas y desplegadas;
7. ausencia de inventario vivo de variables, servicios y commits desplegados;
8. contratos API sin versión formal;
9. documentación de productos contaminada por repositorios de origen.

## 5.3 Estado de CI

En el commit operativo base del Orchestrator no se observaron estados de CI asociados. Las afirmaciones de `5/5` o `10/10` pruebas provienen de PR o ejecución manual declarada.

Hasta incorporar evidencia automática, la clasificación correcta es:

```text
pruebas declaradas como aprobadas
```

no:

```text
certificación CI completa
```

# 6. Fuentes vivas todavía pendientes

Para elevar la línea base a certificación de producción hacen falta consultas de solo lectura a:

## Orchestrator vivo

```text
/api/health
/api/dashboard
/api/ecosystem
/api/docker
/api/github
/api/projects
```

## VPS

- `systemctl status`;
- definición del servicio;
- rutas de despliegue;
- `git rev-parse HEAD`;
- `git status`;
- configuración proxy sin secretos;
- nombres de variables, sin valores.

## Supabase

- tablas y columnas CRM;
- migraciones aplicadas;
- identity de Vargas Centro;
- ubicaciones históricas de contactos;
- conteos y relaciones;
- políticas RLS.

## WAHA

- sesión activa;
- webhook configurado;
- destino;
- estado;
- último evento;
- sin revelar token o credenciales.

# 7. Procedimiento de actualización incremental

Cada nueva auditoría debe registrar únicamente diferencias:

```text
Commit anterior
  ↓
Commit actual
  ↓
Archivos/documentos cambiados
  ↓
Impacto en arquitectura o contrato
  ↓
Actualización de esta línea base
```

Formato mínimo:

| Campo | Contenido |
|---|---|
| Fecha | ISO 8601 |
| Repositorio | `owner/name` |
| Base | commit anterior |
| Head | commit actual |
| Evidencia | archivo, PR, migración o endpoint |
| Clasificación | VERIFICADO / DECLARADO / PENDIENTE / PROPUESTA |
| Documentos afectados | lista |

# 8. Criterio para no repetir auditorías

No debe repetirse la auditoría maestra cuando:

- el repositorio y commit ya están incluidos aquí;
- no existen cambios posteriores;
- la pregunta puede resolverse leyendo los documentos oficiales;
- el punto pendiente ya está identificado y requiere una fuente viva específica.

Debe realizarse auditoría diferencial cuando:

- cambió la rama o el commit;
- apareció una migración;
- se modificó un contrato API;
- cambió la infraestructura;
- se incorporó un repositorio;
- una hipótesis pendiente obtuvo evidencia nueva.

# 9. Estado de cierre de esta línea base

## Cubierto

- inventario GitHub accesible;
- arquitectura Orchestrator/CORE;
- endpoints principales;
- observación Docker y ecosistema;
- bloque CRM-042;
- causa técnica delimitada del incidente Vargas Centro;
- modelo nuevo de contactos;
- vacíos documentales;
- riesgos y propuestas de avance.

## No certificado todavía

- estado vivo de producción;
- datos reales de Supabase;
- aplicación efectiva de migraciones;
- sesión WAHA;
- commit desplegado por servicio;
- infraestructura DNS, TLS y proxy;
- contenido interno completo de todos los repositorios.

## Regla final

Este documento es la referencia inicial oficial. Cualquier operador futuro debe comenzar aquí y ampliar por evidencia, no reconstruir el ecosistema desde conversaciones anteriores.

## Actualización KB-001A — 12 de julio de 2026

### Identificación del movimiento

| Campo | Valor |
|---|---|
| Movimiento | `KB-001A` |
| Rama técnica | `kb-001a-knowledge-read-impact` |
| Pull Request | `#16` |
| Commit técnico final | `27ce7e6` |
| Merge en línea base | `794f691` |
| Rama base | `orchestrator-next` |
| Resultado QA | `36/36 PASS` |
| Estado | `COMPLETADO` |

### Capacidades incorporadas

KB-001A incorporó el Knowledge Engine en modo de lectura interna:

- listado exclusivo de documentos Markdown dentro de `docs/` y `knowledge/`;
- lectura segura con metadatos;
- bloqueo de traversal, rutas absolutas, archivos externos y enlaces simbólicos;
- registro persistente del impacto documental por Job o movimiento;
- estados documentales `NO_REQUIERE_CAMBIO`, `PENDIENTE` y `ACTUALIZADO`;
- consulta de pendientes documentales;
- integración de Documentación en el Service Registry con capacidad de lectura.

### Restricciones vigentes

KB-001A no habilita:

- edición automática de documentos;
- creación de documentos duplicados;
- escritura mediante API;
- acceso directo fuera del Orchestrator;
- capacidad efectiva de `documentation.write`.

La escritura controlada continúa reservada para KB-002. La exposición HTTP protegida del Knowledge Engine corresponde a KB-001B.

### Evidencia de validación

- pruebas específicas del Service Registry: `5/5`;
- suite completa del Orchestrator: `36/36`;
- validación sintáctica: correcta;
- `git diff --check`: correcto;
- Pull Request #16 fusionado correctamente;
- producción no fue modificada durante KB-001A.

## Actualización AUD-001A — 12 de julio de 2026

### Identificación del movimiento

| Campo | Valor |
|---|---|
| Movimiento | `AUD-001A` |
| Repositorio técnico | `elansuministros-oss/elankav-core` |
| Rama técnica | `aud-001a-audio-intake` |
| Pull Request | `#8` |
| Commit documental | `4169605` |
| Commit técnico | `dd5a54a` |
| Merge en `main` | `e5c7404` |
| Resultado QA | `25/25 PASS` |
| Build | `OK` |
| Vercel | `Ready` |
| Estado | `COMPLETADO` |

### Capacidades incorporadas

AUD-001A incorporó el ingreso seguro de notas de voz desde WAHA:

```text
WAHA
→ webhook de ELANKAV Core
→ Audio Intake Adapter
→ Audio Intake Service
→ resultado normalizado
```

La implementación:

- detecta audio y notas de voz;
- extrae metadatos sin inventar valores;
- valida mensaje, chat, MIME, referencia, tamaño y duración;
- rechaza payloads inválidos de forma controlada;
- mantiene intacto el procesamiento de mensajes de texto;
- conserva la separación entre Adapter, Service y webhook.

### Restricciones preservadas

AUD-001A no habilita:

- descarga de archivos de audio;
- persistencia de contenido binario;
- transcripción;
- llamadas a OpenAI;
- generación o envío de voz;
- modificación de Owner Mode;
- procesamiento de grupos, estados o mensajes propios.

### Validación

- pruebas propias de AUD-001A: `13/13 PASS`;
- suite completa de `elankav-core`: `25/25 PASS`;
- build de producción: correcto;
- preview de Vercel: Ready;
- rama `main` sincronizada;
- producción textual preservada.

### Continuidad

El siguiente movimiento autorizado es:

```text
STT-001A — Transcripción
```

STT-001A deberá reutilizar el contrato de audio existente y no duplicar la detección, validación ni normalización ya incorporadas por AUD-001A.
