# 08 — Auditoría diferencial del ecosistema ELANKAV

## Identificación

| Campo | Valor |
|---|---|
| Movimiento | `DOC-AUD-2026-07-22` |
| Fecha | 22 de julio de 2026 |
| Repositorio documental | `elansuministros-oss/elankav-orchestrator` |
| Rama de trabajo | `docs/DOC-AUD-2026-07-22` |
| Línea base comparada | `docs/06_LINEA_BASE_ECOSISTEMA.md` |
| Commit base histórico | `c9f9dc4b0f594cd52bf97f9ba2aae22cc126136e` |
| Alcance | Diferencias documentales y arquitectónicas posteriores al 12 de julio de 2026 |
| Restricciones | Sin cambios funcionales, sin Supabase, sin merge y sin despliegue |

## Objetivo

Actualizar la Base Oficial de Conocimiento por diferencias, sin repetir la auditoría maestra y sin convertir conversaciones en evidencia operativa.

## 1. Ruta real WhatsApp → ELANKAV

### Evidencia verificada en código

El punto de entrada productivo documentado y observado está en:

```text
elankav-core/api/whatsapp-v2.js
```

El archivo define como destino predeterminado:

```text
https://orchestrator.elankav.com/api/messages
```

El flujo confirmado es:

```text
WhatsApp
  ↓
WAHA
  ↓
ELANKAV Core /api/whatsapp
  ↓
rewrite /api/whatsapp-v2
  ↓
normalización de evento, identidad y medios
  ↓
POST Orchestrator /api/messages
  ↓
Business Engine / servicios autorizados
  ↓
respuesta textual o de voz
  ↓
ELANKAV Core
  ↓
WAHA sendText / sendVoice
  ↓
WhatsApp
```

### Clasificación

```text
VERIFICADO EN CÓDIGO
```

### Corrección conceptual

La representación abreviada:

```text
WhatsApp → WAHA → Orchestrator → Core
```

no describe correctamente el punto de entrada vigente.

La arquitectura oficial debe distinguir:

- **Core como Channel Bridge:** recibe el webhook, normaliza identidad y medios y entrega la respuesta al canal;
- **Orchestrator como centro operativo:** decide, coordina y ejecuta el flujo de negocio mediante adapters, services y módulos autorizados;
- **Supabase como fuente oficial de datos:** accedida mediante APIs, adapters o services autorizados.

## 2. Repositorios incorporados después de la línea base

La línea base del 12 de julio de 2026 no contiene todavía los siguientes repositorios:

### `elansuministros-oss/elankav-crm`

Función observada:

```text
Frontend CRM independiente y migración controlada desde el Core.
```

Estado documental:

```text
NUEVO / PENDIENTE DE CONTRATO MAESTRO
```

### `elansuministros-oss/elanhome-platform`

Función observada:

```text
Storefront comercial de productos, catálogo, carrito y futura integración multiproveedor.
```

Estado documental:

```text
NUEVO / FUNDACIÓN IMPLEMENTADA / ARQUITECTURA COMERCIAL EN EVOLUCIÓN
```

### `elansuministros-oss/elankav-design-engine`

Función observada:

```text
Motor desacoplado para diseño, renders y capacidades de ELAN Creative Studio.
```

Estado documental:

```text
FUNDACIÓN DESIGN-001A CERRADA / EVOLUCIÓN PENDIENTE
```

## 3. Movimientos operativos posteriores al 12 de julio

Se identificaron cambios posteriores a la línea base que deben consolidarse en documentos maestros específicos:

- recibos y pagos simplificados;
- impresión de recibo 5 × 10;
- crédito autorizado para continuar OT y OC;
- recuperación de OT existente ante fallos posteriores de persistencia documental;
- RPC para órdenes operativas;
- integración pública de ELANHOME en el portal institucional;
- creación y migración inicial del CRM independiente.

Clasificación:

```text
DECLARADO POR COMMITS / REQUIERE CONSOLIDACIÓN FUNCIONAL POR MÓDULO
```

Esta auditoría no sustituye la validación viva de Preview, Vercel, VPS, Supabase o WAHA.

## 4. Deuda documental confirmada

### ELANVISUAL

El README heredado todavía identifica el producto como `ELANPET.COM V7` y describe usuarios, catálogo y flujo veterinario que no representan ELANVISUAL.

Estado:

```text
CRÍTICO DOCUMENTAL
```

Acción requerida:

- reemplazar el README heredado;
- documentar módulos actuales;
- separar storefront, CRM, cotizaciones, ERP, producción, inventario y administración;
- no modificar código funcional dentro del movimiento documental.

### ELANKAV Core

El README mezcla:

- arquitectura vigente;
- contratos;
- movimientos futuros;
- historial operativo;
- hotfixes productivos;
- bloques duplicados.

Estado:

```text
DEUDA DE GOBERNANZA DOCUMENTAL
```

Acción requerida:

- conservar un README de entrada breve;
- mover especificaciones extensas a documentos maestros;
- clasificar cada bloque como implementado, pendiente, histórico o propuesto;
- conservar trazabilidad de commits sin duplicaciones.

### Línea base oficial

`docs/06_LINEA_BASE_ECOSISTEMA.md` continúa siendo la base histórica válida, pero no representa completamente el estado posterior al 12 de julio de 2026.

Estado:

```text
VÁLIDA COMO BASE HISTÓRICA / DESACTUALIZADA COMO ESTADO ACTUAL
```

## 5. Jerarquía arquitectónica consolidada

```text
Canales externos
  ↓
Channel Bridges
  ↓
ELANKAV Orchestrator
  ↓
Adapters / Services / Business Engine
  ↓
CORE APIs y servicios de dominio
  ↓
Supabase y proveedores autorizados
  ↓
Plataformas ELANKAV
```

Para WhatsApp específicamente:

```text
WhatsApp
  ↓
WAHA
  ↓
ELANKAV Core WhatsApp Identity Bridge
  ↓
ELANKAV Orchestrator
  ↓
Business Engine
  ↓
servicios autorizados
  ↓
ELANKAV Core
  ↓
WAHA
```

## 6. Orden de actualización recomendado

1. Actualizar el índice maestro para registrar esta auditoría diferencial.
2. Integrar las diferencias verificadas en `06_LINEA_BASE_ECOSISTEMA.md`.
3. Corregir la arquitectura de canales en `02_ARQUITECTURA_Y_ACCESOS.md`.
4. Incorporar CRM standalone, ELANHOME y Design Engine al inventario oficial.
5. Crear o actualizar contratos maestros de ERP, recibos, crédito, OT y OC dentro de la estructura existente.
6. Corregir el README de ELANVISUAL mediante movimiento separado.
7. Normalizar el README de Core mediante movimiento separado.
8. Validar enlaces, referencias y commits.
9. Abrir PR documental para revisión.
10. No hacer merge ni desplegar sin validación expresa.

## 7. Dictamen

La gobernanza documental existente continúa siendo válida.

No se autoriza crear una segunda base de conocimiento, arquitectura paralela o carpeta documental duplicada.

El estado queda clasificado como:

```text
BASE OFICIAL BIEN ESTRUCTURADA
+
ACTUALIZACIÓN DIFERENCIAL NECESARIA
+
CONTRADICCIÓN DE RUTA WHATSAPP RESUELTA EN CÓDIGO
```

## Estado del movimiento

```text
DOCUMENTADO EN RAMA
PENDIENTE DE REVISIÓN
SIN MERGE
SIN DESPLIEGUE
```
