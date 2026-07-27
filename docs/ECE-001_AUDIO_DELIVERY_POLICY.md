# ECE-001 — Política de Entrega de Audio y Texto

## Estado

Este documento forma parte del contrato oficial de ECE v2 y complementa `docs/ECE-001_CONVERSATION_RULEBOOK.md`.

Cuando exista conflicto con reglas anteriores, esta política prevalece para cualquier respuesta por WhatsApp que pueda entregarse como texto o voz.

No modificar producción, hacer merge, desplegar ni reiniciar servicios sin validación y autorización explícita.

---

## 1. Objetivo

Evitar que ELAN IA envíe una nota de voz y, a continuación, el mismo contenido como mensaje de texto.

Cada respuesta lógica debe tener una sola entrega principal:

```text
VOICE XOR TEXT
```

Nunca:

```text
VOICE + TEXT DUPLICADO
```

---

## 2. Regla maestra R-017 — Entrega exclusiva por canal

Por cada respuesta lógica, el sistema debe elegir exactamente un canal principal:

```text
VOICE
```

ó

```text
TEXT
```

No se permite entregar el mismo contenido por ambos canales cuando la primera entrega fue aceptada correctamente por WAHA.

### 2.1 Audio correcto

Cuando la síntesis y el envío de voz finalicen correctamente:

```text
sendVoice = 1
sendText = 0
```

El flujo debe terminar después de confirmar la aceptación del audio.

### 2.2 Fallback a texto

El texto solo puede enviarse como fallback cuando:

- la síntesis TTS falla antes del envío;
- la generación del archivo de audio falla;
- WAHA rechaza explícitamente el envío de voz;
- la entrega de voz devuelve un error concluyente.

Resultado esperado:

```text
sendVoice = 0 o FAILED
sendText = 1
fallbackUsed = true
```

### 2.3 Confirmación incierta

Si WAHA devuelve un resultado ambiguo, timeout o estado no concluyente:

- no enviar texto inmediatamente;
- registrar la entrega como `UNKNOWN`;
- consultar o reconciliar el estado antes de un fallback;
- evitar que un timeout produzca audio entregado más texto duplicado.

### 2.4 Reintentos

Un reintento del webhook no debe:

- volver a sintetizar la misma respuesta;
- reenviar el mismo audio;
- cambiar una entrega de voz aceptada por una entrega textual;
- crear dos respuestas para el mismo mensaje entrante.

La decisión de entrega debe estar protegida por idempotencia y correlación estable.

---

## 3. Separación de responsabilidades

### Speech Formatter

El `Speech Formatter` únicamente prepara una versión natural para TTS.

Responsabilidades:

- eliminar Markdown no audible;
- transformar listas en frases naturales;
- evitar leer URLs completas;
- adaptar monedas y medidas a pronunciación natural;
- expandir abreviaturas cuando sea necesario;
- preservar nombres de marca;
- limitar la duración;
- seleccionar idioma y reglas de pronunciación.

No debe decidir:

- si se envía texto;
- si se envía audio;
- si se envían ambos;
- cuándo ejecutar fallback.

### Delivery Router

El componente de entrega debe decidir un único modo:

```json
{
  "deliveryMode": "VOICE",
  "allowTextFallback": true,
  "allowDualDelivery": false
}
```

La propiedad `allowDualDelivery` debe permanecer en `false` para respuestas equivalentes.

---

## 4. Bienvenida inicial

La bienvenida de un cliente nuevo se entrega únicamente por audio.

No se permite:

```text
Audio: Hola, soy ELAN IA...
Texto: Hola, soy ELAN IA...
```

La intención original del cliente debe continuar después de la bienvenida.

Ejemplo válido:

```text
Cliente: Necesito un banner exterior.

Audio de bienvenida:
Hola, soy ELAN IA...

Respuesta comercial posterior:
Perfecto. ¿Qué medida necesitás?
```

Esos mensajes tienen propósitos distintos:

1. transparencia de identidad;
2. continuidad comercial.

La presentación no debe repetirse por escrito.

---

## 5. Observabilidad obligatoria

Cada respuesta debe registrar como mínimo:

```json
{
  "correlationId": "uuid",
  "inboundMessageId": "provider-message-id",
  "logicalReplyId": "uuid",
  "deliveryMode": "VOICE",
  "voiceAttempted": true,
  "voiceDelivered": true,
  "textAttempted": false,
  "textDelivered": false,
  "fallbackUsed": false,
  "deliveryStatus": "SENT"
}
```

Estados permitidos:

```text
PENDING
SENT
FAILED
UNKNOWN
FALLBACK_SENT
```

No debe marcarse `SENT` hasta que el proveedor acepte la entrega.

---

## 6. Invariantes

Estas condiciones deben cumplirse siempre:

```text
voiceDelivered = true  => textDelivered = false
textDelivered = true   => voiceDelivered != true
fallbackUsed = true    => voiceDelivered = false
allowDualDelivery      = false
```

La única excepción es cuando audio y texto contienen información diferente y fueron planificados como dos acciones distintas. Esa excepción debe ser explícita y no puede utilizarse para repetir el mismo contenido.

---

## 7. Casos de aceptación

### AC-011 — Voz correcta sin texto duplicado

Dado un mensaje entrante de audio y una respuesta generada:

- TTS funciona;
- WAHA acepta el audio;
- `sendVoice` se invoca una vez;
- `sendText` no se invoca;
- el cliente recibe una sola respuesta;
- `replyType=voice`;
- `fallbackUsed=false`.

### AC-012 — Falla de TTS con fallback

Dado que TTS falla antes de generar el audio:

- `sendVoice` no se ejecuta;
- `sendText` se invoca una vez;
- el texto contiene la respuesta lógica;
- `replyType=text`;
- `fallbackUsed=true`.

### AC-013 — WAHA rechaza audio

Dado que WAHA rechaza explícitamente `sendVoice`:

- el error queda registrado;
- el texto se envía una sola vez;
- no se reintenta el audio en el mismo turno;
- `deliveryStatus=FALLBACK_SENT`.

### AC-014 — Timeout incierto

Dado un timeout después de enviar audio:

- no se envía texto automáticamente;
- el estado queda `UNKNOWN`;
- se ejecuta reconciliación;
- no se duplica la respuesta.

### AC-015 — Webhook duplicado

Dado el mismo identificador de mensaje entrante dos veces:

- la respuesta lógica se genera una vez;
- el audio se sintetiza una vez;
- se realiza una sola entrega;
- no aparece texto duplicado.

### AC-016 — Bienvenida por audio

Dado un cliente nuevo:

- la presentación se envía solo por voz;
- no se envía la transcripción de la presentación;
- el primer mensaje conserva su intención;
- la siguiente respuesta comercial no repite el saludo.

---

## 8. Criterio de bloqueo

ECE v2 no puede pasar a modo `active` si cualquiera de estas pruebas falla:

- audio correcto seguido por texto equivalente;
- timeout que produce doble entrega;
- webhook duplicado que produce una segunda respuesta;
- bienvenida repetida por voz y texto;
- fallback ejecutado después de una entrega de voz confirmada.

---

## 9. Estado del flujo actual auditado

El flujo actual de `api/wahaWebhookApi.js` ya implementa la ruta principal de forma exclusiva:

```text
Audio entrante
    ↓
Generar respuesta
    ↓
Sintetizar voz
    ↓
Enviar voz
    ↓
Finalizar
```

El texto se usa como fallback cuando falla la ruta de voz.

ECE v2 debe conservar ese comportamiento y añadir:

- idempotencia persistente;
- reconciliación de estados inciertos;
- observabilidad por entrega;
- pruebas obligatorias AC-011 a AC-016;
- bloqueo explícito de doble entrega.
