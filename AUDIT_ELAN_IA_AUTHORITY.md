# ELAN IA — AUTORIDAD OFICIAL Y RUTA DE AUDITORÍA

**Estado:** decisión arquitectónica obligatoria.

## Regla principal

> **CONNECT decide. ORCHESTRATOR ejecuta.**

No se permite crear una segunda fuente de identidad, personalidad, reglas comerciales, productos, precios, biblioteca, documentos o comportamiento conversacional dentro de Orchestrator.

---

## 1. Responsabilidad de CONNECT

CONNECT es la **única autoridad administrativa, comercial y de conocimiento de ELAN IA**.

CONNECT es dueño de:

- identidad por plataforma;
- instrucciones de conversación;
- reglas de respuesta;
- continuidad;
- acceso a catálogo;
- productos;
- precios autorizados;
- biblioteca;
- documentos;
- publicación/versionado del runtime;
- historial y operación CRM/conversacional persistente.

La configuración efectiva para una plataforma debe salir del runtime publicado de CONNECT.

Endpoint interno de autoridad:

```text
GET /console/api/ai-platforms/runtime/:platformId
```

Contrato esperado:

```text
ELANKAV_AI_RUNTIME_V1
```

Tablas de autoridad en CONNECT:

```text
elankav_ai_runtime_settings
elankav_ai_runtime_platforms
elankav_ai_runtime_publications
elankav_ai_platform_catalogs
elankav_ai_platform_knowledge
```

---

## 2. Responsabilidad de Orchestrator

Orchestrator es **coordinador técnico y ejecutor**, no un segundo cerebro.

Puede:

- recibir eventos de WAHA/WhatsApp;
- identificar plataforma/canal/remitente;
- consultar CONNECT;
- armar la ejecución técnica;
- llamar al modelo;
- enrutar voz/diseño/CRM;
- manejar timeouts, errores, trazas, idempotencia y reintentos;
- devolver la respuesta a WAHA.

No puede ser autoridad de:

- personalidad del cliente;
- tono comercial;
- reglas de venta;
- catálogo;
- precios;
- identidad de ELANVISUAL/ELANHOME/ELANPET;
- biblioteca o documentos comerciales.

---

## 3. Archivos que se deben auditar primero

### Runtime publicado de CONNECT

```text
services/connectRuntimeConfigService.js
```

Debe consultar CONNECT y entregar las instrucciones publicadas. Si CONNECT no entrega runtime válido, la atención automática al cliente debe fallar cerrado; no debe inventar ni usar un prompt comercial local alternativo.

### Generación de respuesta

```text
services/messageService.js
```

Para clientes debe usar:

```text
runtime.instructions
```

proveniente de CONNECT.

No debe existir un bloque `CUSTOMER_INSTRUCTIONS` hardcodeado como autoridad comercial.

Las instrucciones internas del propietario/operador pueden permanecer en Orchestrator porque pertenecen al control técnico interno, no al comportamiento comercial público de ELAN IA.

### Conocimiento aprobado

```text
services/connectPlatformKnowledgeService.js
services/commercialContextService.js
```

El conocimiento comercial debe provenir de CONNECT.

---

## 4. Ruta oficial de ejecución

```text
WhatsApp
  ↓
WAHA
  ↓
Orchestrator
  ↓
CONNECT runtime publicado
  ├─ identidad / instrucciones / reglas / continuidad
  └─ conocimiento / productos / precios / documentos
  ↓
Orchestrator arma la ejecución
  ↓
Modelo IA
  ↓
Orchestrator
  ↓
WAHA
  ↓
WhatsApp
```

---

## 5. Regla para cambios futuros

Antes de agregar una variable, tabla, archivo, prompt o módulo preguntarse:

### ¿Define QUÉ sabe ELAN IA o CÓMO debe responder comercialmente?

**Sí → CONNECT.**

### ¿Coordina técnicamente CÓMO se ejecuta o transporta una solicitud?

**Sí → ORCHESTRATOR.**

Si una modificación crea una copia de información ya administrada en CONNECT, **se rechaza por duplicación de autoridad**.

---

## 6. Checklist obligatorio para una auditoría de ELAN IA

1. Confirmar endpoint que recibe WhatsApp.
2. Confirmar ruta WAHA → Orchestrator.
3. Confirmar plataforma resuelta.
4. Confirmar llamada a `services/connectRuntimeConfigService.js`.
5. Confirmar `runtime.version` y `publishedAt` usados en la solicitud.
6. Confirmar que las instrucciones enviadas al modelo corresponden a `runtime.instructions` de CONNECT.
7. Buscar y denunciar cualquier prompt comercial hardcodeado en Orchestrator.
8. Confirmar llamada de conocimiento a CONNECT mediante `connectPlatformKnowledgeService.js`.
9. Confirmar productos/precios/documentos realmente usados.
10. Confirmar historial conversacional entregado al modelo.
11. Confirmar modelo utilizado.
12. Confirmar salida Orchestrator → WAHA → WhatsApp.

Una auditoría no se considera cerrada si solamente revisa la interfaz de CONNECT. Debe demostrar la cadena completa hasta la llamada al modelo.

---

## 7. Prohibiciones explícitas

No volver a crear dentro de Orchestrator:

```text
CUSTOMER_INSTRUCTIONS comerciales
catálogo comercial paralelo
precios hardcodeados para producción
identidad paralela por plataforma
reglas de conversación duplicadas
biblioteca comercial paralela
runtime comercial alternativo
```

La existencia de cualquiera de esos elementos debe tratarse como **deuda arquitectónica / duplicación de autoridad**.
