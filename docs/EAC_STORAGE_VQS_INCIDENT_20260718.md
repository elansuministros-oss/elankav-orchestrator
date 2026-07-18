# EAC — Incidente de Storage y VQS del 18 de julio de 2026

## Estado

```text
DOCUMENTADO
NO IMPLICA MERGE
NO IMPLICA DESPLIEGUE
NO CERTIFICA EL FLUJO COMPLETO DE ELANVISUAL
```

## Propósito

Registrar de forma trazable:

- la auditoría y el contexto que ya existían;
- los hechos comprobados en producción;
- las decisiones incorrectas tomadas durante la intervención;
- el tiempo perdido por no consultar primero la Base Oficial de Conocimiento y el entorno vivo;
- el procedimiento obligatorio para que ningún operador repita este incidente;
- el estado real del Asset Core y del flujo de imágenes de VQS.

Este documento debe leerse antes de modificar Storage, VQS, Document Delivery, imágenes de cotizaciones o variables relacionadas con activos.

---

# 1. Contexto previo que ya estaba documentado

La orden `ERP-DATA-01` ya exigía una auditoría integral y de solo lectura sobre:

- Orchestrator;
- Core;
- ELANVISUAL;
- Supabase;
- Storage;
- EMC;
- VQS;
- ELAN AI;
- WAHA;
- inventario;
- OT;
- OC;
- pagos;
- recibos;
- comprobantes;
- gastos.

La misma orden exigía, para Storage:

- identificar buckets reales;
- indicar si eran públicos o privados;
- identificar rutas utilizadas;
- identificar servicios consumidores;
- revisar `publicUrl` y `signedUrl`;
- confirmar persistencia de `bucket + objectPath`;
- no cambiar buckets ni políticas durante la auditoría.

También existía una regla documental previa:

```text
Antes de auditar, corregir o proponer cambios:
1. leer docs/00_MASTER_INDEX.md;
2. leer docs/06_LINEA_BASE_ECOSISTEMA.md;
3. comparar únicamente diferencias posteriores;
4. actualizar la línea base cuando un pendiente obtenga evidencia nueva.
```

Esta regla no fue seguida correctamente durante la intervención descrita abajo.

---

# 2. Objetivo funcional solicitado por el propietario

El objetivo no era únicamente corregir una imagen puntual de cotización.

El objetivo transversal solicitado era un depósito central de activos para:

```text
Facturas de compra
Comprobantes
Imágenes cargadas desde cualquier módulo
Fotos de catálogo de producto
Diseños
Cotizaciones
PDF
Documentos
Medios de WhatsApp
        ↓
Asset Core
        ↓
Storage
        +
Asset Registry
```

El sistema esperado debe clasificar cada activo y conservar, como mínimo:

```text
assetId
tipo
categoría
plataforma
módulo
bucket
objectPath
mimeType
sizeBytes
origen
projectId
quotationId
productId
supplierId
createdAt
```

## Estado real confirmado

A la fecha de este incidente:

### Existe

- Adapter técnico para subir objetos a Supabase Storage.
- Endpoint de carga VQS operativo en el Orchestrator.
- Generación de `bucket + objectPath`.
- Generación de URL firmada para entrega temporal.
- Ruta lógica para activos de cotización.

### No quedó demostrado como sistema completo

- Asset Registry transversal.
- Clasificación unificada de facturas, comprobantes, productos, diseños y documentos.
- Integración de todos los módulos con un único Asset Service.
- Migración de activos históricos.
- Biblioteca administrativa de activos.
- Búsqueda y reutilización centralizada.
- Flujo E2E de ELANVISUAL confirmado desde selección de imagen hasta cotización pública.

Por tanto:

```text
Endpoint técnico de upload operativo
≠
Asset Core transversal terminado
≠
Flujo frontend E2E certificado
```

---

# 3. Incidente observado

El endpoint de carga respondía:

```json
{
  "success": false,
  "code": "STORAGE_UPLOAD_FAILED",
  "error": "Bucket not found"
}
```

Las pruebas unitarias del bloque ejecutado reportaron:

```text
pass 5
fail 0
```

El servicio systemd reportaba:

```text
active
```

Esto demostró que:

- la suite aprobada no cubría la existencia real del bucket configurado en producción;
- servicio activo no significaba integración funcional;
- la validación técnica estaba incompleta sin prueba contra Storage vivo.

---

# 4. Procedimientos incorrectos ejecutados

## Error 1 — Inferir nombres de bucket sin evidencia

Se asumió primero:

```text
official-documents
```

Luego se asumió:

```text
quotation-assets
```

Ambos nombres eran incorrectos como buckets físicos de producción.

`quotation-assets` terminó siendo una carpeta lógica dentro de otro bucket, no un bucket real.

### Impacto

- cambios y validaciones innecesarias;
- reinicios evitables;
- pruebas repetidas;
- pérdida de tiempo del propietario;
- falsa sensación de avance;
- desviación del objetivo transversal de Asset Core.

## Error 2 — No consultar primero la documentación oficial

No se comenzó por:

```text
docs/00_MASTER_INDEX.md
docs/06_LINEA_BASE_ECOSISTEMA.md
```

Esto contradijo la gobernanza vigente y permitió reconstruir información desde el chat en lugar de partir de la fuente versionada.

## Error 3 — No consultar de inmediato el entorno vivo

Antes de recomendar un bucket debía comprobarse:

- archivo EnvironmentFile de systemd;
- nombres de variables cargadas;
- lista real de buckets de Supabase;
- endpoint real que consumía la variable;
- diferencia entre bucket físico y carpeta lógica.

## Error 4 — Confundir una prueba aislada con despliegue funcional completo

La prueba directa del endpoint confirmó únicamente:

```text
Orchestrator → Supabase Storage
```

No confirmó:

```text
ELANVISUAL → endpoint de upload → persistencia VQS → visor público
```

Afirmar que el cambio estaba listo para el usuario final antes de la prueba E2E fue incorrecto.

## Error 5 — No registrar inmediatamente los hallazgos en GitHub

La lista real de buckets, la variable correcta y la limitación del flujo quedaron primero en la conversación.

Esto contradice la regla de que el chat es fuente declarada, no estado operativo oficial.

## Error 6 — Reducir un requerimiento transversal a un hotfix puntual

El requerimiento original era un depósito central para múltiples tipos de activos.

La intervención se concentró en la imagen de cotización sin dejar claramente separado:

- hotfix VQS;
- Storage Adapter;
- Document Delivery;
- Asset Core transversal;
- integración del frontend.

---

# 5. Evidencia viva obtenida

## 5.1 Buckets reales de Supabase Storage

Consulta REST de solo lectura realizada con las credenciales del proceso, sin exponer secretos.

Resultado:

| Bucket | Público | Estado observado |
|---|---:|---|
| `elanvisual` | Sí | Existente y operativo para la prueba VQS |
| `archivos-ai` | Sí | Existente; uso específico no certificado en este incidente |
| `emc-importaciones` | Sí | Existente; relacionado nominalmente con EMC |
| `design-request-assets` | No | Existente; privado |

No existían como buckets físicos:

```text
official-documents
quotation-assets
```

## 5.2 Configuración systemd y entorno

Servicio:

```text
elankav-orchestrator.service
```

Ruta de despliegue observada:

```text
/opt/elankav/orchestrator
```

EnvironmentFile:

```text
/etc/elankav-orchestrator.env
```

Inicialmente no existía una variable explícita:

```text
VQS_ASSET_BUCKET
```

El runtime utilizaba por tanto el valor por defecto del código, que apuntaba a un bucket inexistente.

## 5.3 Respaldo realizado

Antes de modificar el entorno se creó:

```text
/etc/elankav-orchestrator.env.backup-20260718T231039Z
```

## 5.4 Configuración aplicada

Se añadió:

```text
VQS_ASSET_BUCKET=elanvisual
```

Después del reinicio controlado se verificó:

```text
Estado del servicio: active
Variable cargada: VQS_ASSET_BUCKET=elanvisual
```

## 5.5 Prueba real de carga

La prueba respondió:

```json
{
  "success": true,
  "data": {
    "kind": "existing-product-photo",
    "bucket": "elanvisual",
    "path": "ELANVISUAL/quotation-assets/2026/07/test-upload/<uuid>.png",
    "objectPath": "ELANVISUAL/quotation-assets/2026/07/test-upload/<uuid>.png",
    "mimeType": "image/png",
    "sizeBytes": 8
  }
}
```

Los tokens y la URL firmada completa se excluyen deliberadamente de la documentación.

## Conclusión comprobada

```text
Bucket físico:
elanvisual

Carpeta lógica:
ELANVISUAL/quotation-assets/
```

El error:

```text
STORAGE_UPLOAD_FAILED: Bucket not found
```

quedó resuelto para la prueba directa del endpoint.

---

# 6. Estado de certificación después de la corrección

## Verificado

- el servicio Orchestrator quedó activo;
- la variable se cargó en el proceso;
- el bucket `elanvisual` existe;
- el Orchestrator pudo subir un objeto;
- se obtuvo `bucket + objectPath`;
- el error `Bucket not found` desapareció en la prueba directa.

## No verificado todavía por esta evidencia

- que ELANVISUAL llame siempre al endpoint de activos;
- que la miniatura se renderice antes de guardar;
- que la respuesta del upload se inserte en el payload VQS;
- que la cotización persista la referencia correcta;
- que el visor público renueve o genere correctamente la URL de lectura;
- que las cotizaciones históricas mantengan compatibilidad;
- que todos los tipos de archivo del ERP usen Asset Core;
- que facturas, comprobantes, catálogos y medios de WhatsApp estén conectados.

## Regla

Nunca declarar “desplegado y funcionando” basándose solamente en:

```text
systemctl active
+
unit tests pass
+
upload aislado pass
```

Para certificar el flujo comercial se requiere E2E real.

---

# 7. Procedimiento obligatorio para futuros operadores

## Fase A — Lectura documental

Antes de cualquier acción:

```text
1. Leer docs/00_MASTER_INDEX.md
2. Leer docs/06_LINEA_BASE_ECOSISTEMA.md
3. Leer este documento
4. Buscar documentación EAC, VQS, Storage y Document Delivery
5. Revisar PR y commits posteriores a la línea base
```

## Fase B — Clasificar el objetivo

Determinar si la solicitud corresponde a:

```text
A. Storage Adapter
B. VQS quotation assets
C. Document Delivery
D. Public quotation resolver
E. Asset Registry
F. Asset Core transversal
G. Frontend ELANVISUAL
H. Migración histórica
```

No mezclar estos alcances.

## Fase C — Evidencia antes de modificar

Comprobar, sin secretos:

```bash
systemctl show elankav-orchestrator.service -p EnvironmentFiles
systemctl show elankav-orchestrator.service -p Environment
systemctl is-active elankav-orchestrator.service
```

Comprobar en el repositorio:

```bash
git status
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
grep -R "VQS_ASSET_BUCKET\|DEFAULT_BUCKET\|uploadObject\|createSignedUrl" -n .
```

Consultar buckets reales mediante mecanismo autorizado de solo lectura.

Nunca inferir un bucket por:

- nombre de carpeta;
- nombre de módulo;
- nombre de PR;
- nombre de endpoint;
- memoria conversacional.

## Fase D — Diferenciar bucket y objectPath

Siempre documentar por separado:

```text
bucket físico
objectPath lógico
```

Ejemplo validado:

```text
bucket: elanvisual
objectPath: ELANVISUAL/quotation-assets/2026/07/...
```

## Fase E — Respaldo y cambio

Antes de cambiar variables:

```bash
cp /etc/elankav-orchestrator.env \
  /etc/elankav-orchestrator.env.backup-$(date -u +%Y%m%dT%H%M%SZ)
```

Registrar:

- archivo respaldado;
- variable agregada o modificada;
- responsable;
- fecha UTC;
- rollback.

## Fase F — Validación por niveles

### Nivel 1 — Configuración

```text
Variable presente y cargada
```

### Nivel 2 — Servicio

```text
Servicio activo y logs sin error de arranque
```

### Nivel 3 — Storage vivo

```text
Upload controlado exitoso
bucket + objectPath correctos
```

### Nivel 4 — Contrato VQS

```text
La cotización persiste la referencia estable
No depende de una signedUrl vencida almacenada
```

### Nivel 5 — E2E ELANVISUAL

```text
Seleccionar imagen
→ ver miniatura
→ guardar cotización
→ confirmar upload
→ abrir cotización
→ abrir vista pública
→ verificar imagen
```

### Nivel 6 — Regresión

```text
Cotización sin imagen
Cotización con imagen nueva
Cotización histórica
PDF oficial
Móvil
PC
```

No avanzar de nivel si el anterior falla.

## Fase G — Actualización documental

Cada evidencia nueva debe registrarse el mismo día en GitHub.

La documentación debe indicar:

- VERIFICADO;
- DECLARADO;
- PENDIENTE;
- PROPUESTA.

No dejar datos operativos críticos únicamente en el chat.

---

# 8. Criterio de diagnóstico cuando la imagen no aparece

La ausencia de imagen después de guardar no debe atribuirse automáticamente a demora.

El upload no es un proceso que deba tardar minutos.

Diagnóstico obligatorio:

```text
1. ¿ELANVISUAL envió la petición de upload?
2. ¿El endpoint respondió 2xx?
3. ¿La respuesta contiene bucket y objectPath?
4. ¿El payload de cotización incluye la referencia estable?
5. ¿La base persistió esa referencia?
6. ¿La API pública reconstruye una URL válida al consultar?
7. ¿El frontend renderiza la propiedad correcta?
```

Posibles fallos:

- frontend no llama al endpoint;
- upload falla;
- respuesta no se integra al payload;
- guardado ocurre antes de completar el upload;
- se persiste una `signedUrl` temporal;
- visor consulta una propiedad antigua;
- cotización histórica usa contrato anterior.

---

# 9. Regla arquitectónica para Asset Core

La solución final no debe consistir en múltiples cargas independientes.

Flujo objetivo:

```text
Frontend / WhatsApp / EMC / Compras / Diseño
        ↓
Orchestrator
        ↓
Asset Service
        ↓
Storage Adapter
        ↓
Supabase Storage
        +
Asset Registry
```

Reglas:

1. El módulo consumidor no persiste URLs firmadas como identidad del archivo.
2. La identidad estable es `bucket + objectPath` o `assetId`.
3. La URL de acceso se genera al momento de entregar.
4. Cada activo conserva clasificación y relaciones de negocio.
5. No se crean buckets por cada categoría sin decisión arquitectónica.
6. La clasificación preferida puede resolverse mediante prefijos de ruta y metadata.
7. Cualquier módulo nuevo reutiliza el servicio común.
8. Los activos históricos requieren migración controlada, no ruptura.

---

# 10. Riesgos que quedan abiertos

## Crítico

- declarar completo el Asset Core cuando solo existe upload técnico parcial;
- persistir URLs firmadas con vencimiento;
- operar con defaults que apuntan a recursos inexistentes.

## Alto

- frontend y backend usando contratos distintos;
- pruebas unitarias sin integración con Storage vivo;
- variables productivas no inventariadas en documentación versionada;
- múltiples flujos de carga sin registro central.

## Medio

- buckets públicos usados para activos que deberían evaluarse como privados;
- rutas sin política uniforme de naming;
- archivos de prueba no limpiados o no identificados.

## Bajo

- inconsistencia nominal entre `path` y `objectPath` si ambos representan lo mismo pero no están formalizados.

---

# 11. Rollback documentado

Para revertir la variable aplicada:

```bash
cp /etc/elankav-orchestrator.env.backup-20260718T231039Z \
  /etc/elankav-orchestrator.env

systemctl restart elankav-orchestrator.service
systemctl is-active elankav-orchestrator.service
```

El rollback solo debe ejecutarse con autorización y comprobando previamente si el archivo de respaldo sigue siendo el correcto para el estado actual.

---

# 12. Regla de cierre

Este incidente solo puede considerarse completamente cerrado cuando exista evidencia de:

```text
Upload técnico
+
Persistencia estable
+
Vista privada
+
Vista pública
+
Compatibilidad histórica
+
Documentación actualizada
```

La prueba directa realizada el 18 de julio de 2026 cerró únicamente el error de bucket inexistente en el endpoint técnico.

No cerró por sí sola:

- la integración E2E de ELANVISUAL;
- el Asset Registry;
- el Asset Core transversal;
- la conexión de facturas, comprobantes, productos, diseños, documentos y WhatsApp.

---

# 13. Instrucción obligatoria para el próximo chat

```text
NO ADIVINAR BUCKETS.
NO REPETIR LA AUDITORÍA MAESTRA.
NO BASARSE EN MEMORIA DEL CHAT.

LEER PRIMERO:
- docs/00_MASTER_INDEX.md
- docs/06_LINEA_BASE_ECOSISTEMA.md
- docs/EAC_STORAGE_VQS_INCIDENT_20260718.md

BUCKET VQS VALIDADO EN PRODUCCIÓN:
- elanvisual

RUTA LÓGICA VALIDADA:
- ELANVISUAL/quotation-assets/

VARIABLE PRODUCTIVA VALIDADA:
- VQS_ASSET_BUCKET=elanvisual

NO CONFUNDIR:
- upload técnico operativo
- flujo E2E certificado
- Asset Core transversal terminado
```
