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
services/connectAiRuntimeService.js
```

Este servicio debe:

- consultar el runtime publicado de CONNECT;
- validar `ELANKAV_AI_RUNTIME_V1`;
- usar `platform.instructions`, `responseRules`, `continuity` y `catalogAccess` como única autoridad de comportamiento público;
- fallar cerrado si CONNECT no publica instrucciones válidas.

No debe contener reglas comerciales hardcodeadas.

### Generación de respuesta

```text
services/messageService.js
```

Para clientes debe obtener el runtime con:

```text
getPublishedRuntime(...)
```

y enviar al modelo únicamente las instrucciones construidas desde la publicación de CONNECT.

Las instrucciones internas del propietario/operador pueden permanecer en Orchestrator porque pertenecen al control técnico interno, no al comportamiento comercial público de ELAN IA.

### Conocimiento aprobado

```text
services/connectPlatformKnowledgeService.js
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
4. Revisar `services/connectAiRuntimeService.js`.
5. Confirmar endpoint `/console/api/ai-platforms/runtime/:platformId` consultado.
6. Confirmar `runtime.version` y `publishedAt` usados.
7. Confirmar que las instrucciones enviadas al modelo salen de `runtime.platform.instructions` y campos publicados por CONNECT.
8. Buscar y denunciar cualquier prompt comercial hardcodeado en Orchestrator.
9. Confirmar llamada de conocimiento a CONNECT mediante `connectPlatformKnowledgeService.js`.
10. Confirmar productos/precios/documentos realmente usados.
11. Confirmar historial conversacional entregado al modelo.
12. Confirmar modelo utilizado.
13. Confirmar salida Orchestrator → WAHA → WhatsApp.

Una auditoría no se considera cerrada si solamente revisa la interfaz de CONNECT. Debe demostrar la cadena completa hasta la llamada al modelo.

---

## 7. Prohibiciones explícitas

No volver a crear dentro de Orchestrator:

```text
CUSTOMER_INSTRUCTIONS comerciales
reglas de venta hardcodeadas
catálogo comercial paralelo
precios hardcodeados para producción
identidad paralela por plataforma
reglas de conversación duplicadas
biblioteca comercial paralela
runtime comercial alternativo
```

La existencia de cualquiera de esos elementos debe tratarse como **deuda arquitectónica / duplicación de autoridad**.
