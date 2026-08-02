# VOICE PIPELINE V2 — Implementación controlada

## Control

| Campo | Valor |
|---|---|
| Repositorio | `elansuministros-oss/elankav-orchestrator` |
| Rama base | `feature/ORCH-AI-PLATFORM-KNOWLEDGE-01` |
| Commit base | `525d953c2c3bd0f6a29d7860db5a606e4bd9ee01` |
| Rama de implementación y producción auditada | `agent/voice-pipeline-v2` |
| Commit desplegado auditado | `d910ca8845f6dfe8d752064639303d566ae01746` |
| Fecha de validación viva | `2026-08-01` |
| Estado | **OPERATIVO EN PRODUCCIÓN / VALIDADO E2E** |
| Evidencia | VPS, systemd, logs Orchestrator, logs WAHA, respuesta recibida en WhatsApp |

## Inicio obligatorio para futuras auditorías

Antes de modificar voz, WAHA, STT, TTS o el webhook de WhatsApp:

1. leer este documento completo;
2. verificar el proceso real ejecutado por systemd;
3. verificar la bandera `VOICE_PIPELINE_V2_ENABLED` dentro del proceso;
4. comparar el commit desplegado contra la rama activa;
5. realizar auditoría diferencial, no reconstruir el incidente desde memoria conversacional.

## Arquitectura operativa

```text
WAHA/GOWS
  → server.voice-pipeline-v2.js
  → VOICE_PIPELINE_V2_ENABLED
      false → api/wahaWebhookApi.js (flujo anterior)
      true  → api/wahaWebhookApiV2.js
  → normalización GOWS
  → recuperación por ID cuando falta media.url
  → descarga y normalización MIME
  → transcripción mediante CONNECT
  → processMessage
  → síntesis mediante CONNECT
  → adapters/wahaDeliveryAdapter.js
  → POST /api/sendVoice
  → respuesta de voz recibida en WhatsApp
  → fallback de texto ante fallo de síntesis o entrega
```

## Componentes

| Archivo | Responsabilidad |
|---|---|
| `server.voice-pipeline-v2.js` | Bootstrap reversible; selecciona handler mediante bandera |
| `api/wahaWebhookApiV2.js` | Handler completo para voz V2 y texto preservado |
| `modules/voicePipelineV2/wahaVoiceEvent.js` | Normalización GOWS, `@lid`, MIME, ID y media |
| `adapters/wahaVoiceMediaAdapterV2.js` | Recuperación del mensaje con `downloadMedia=true` |
| `services/voicePipelineV2Service.js` | Idempotencia, STT, IA, TTS, entrega y fallback |
| `services/connectVoiceService.js` | Consumo de transcripción y síntesis mediante CONNECT |
| `adapters/wahaDeliveryAdapter.js` | Entrega de texto, imagen, archivo y voz mediante WAHA |
| `test/voicePipelineV2.test.js` | Pruebas unitarias del pipeline |
| `test/wahaWebhookApiV2.test.js` | Pruebas de integración del webhook |
| `tests/wahaDeliveryAdapter.test.js` | Contrato de entrega WAHA, incluido `@lid` y voz |

## Reglas operativas

- Los mensajes de texto no entran al procesamiento de voz.
- Los mensajes de voz se reconocen por `type`, `audioMessage` o MIME real `audio/*`.
- `audio/ogg; codecs=opus` se normaliza a `audio/ogg` para el contrato de WAHA.
- Si falta `media.url`, se consulta WAHA por el último segmento del ID GOWS.
- La descarga pública puede devolver `502`; el pipeline usa fallback local `127.0.0.1:3000` y continúa si recibe `200`.
- La idempotencia dura diez minutos.
- Un fallo libera la clave para permitir un reintento real.
- Un fallo de síntesis o envío de voz utiliza la respuesta aprobada como texto.
- No se registran transcripciones, tokens, números completos ni URLs completas en operación normal.
- Los logs temporales de diagnóstico deben retirarse después de validar.

# Incidente resuelto — 2026-08-01

## Síntoma

ELAN IA recibía notas de voz, transcribía, generaba respuesta y registraba `VOICE_REPLY_SENT`, pero el usuario no recibía la respuesta de audio en WhatsApp.

## Causa raíz 1 — Bootstrap V2 no ejecutado

El servicio `elankav-orchestrator.service` ejecutaba directamente:

```text
/usr/bin/node /opt/elankav/orchestrator/server.js
```

Aunque existía:

```text
VOICE_PIPELINE_V2_ENABLED=true
```

la bandera no activaba el flujo V2 porque `server.js` cargaba directamente:

```text
api/wahaWebhookApi.js
```

La configuración correcta de systemd es:

```text
ExecStart=/usr/bin/node /opt/elankav/orchestrator/server.voice-pipeline-v2.js
```

El bootstrap confirmado debe registrar:

```text
[VOICE_PIPELINE_V2] { stage: 'BOOTSTRAP_ENABLED', handler: 'api/wahaWebhookApiV2.js' }
```

## Causa raíz 2 — Entrega de voz sin conversión WAHA

El adaptador enviaba la voz de esta forma:

```js
file: {
  mimetype: normalizedMimeType,
  data: String(data).trim()
},
convert: false
```

WAHA aceptaba la solicitud con HTTP `201` y generaba un `messageId`, pero la nota de voz no llegaba al teléfono.

La configuración funcional validada es:

```js
file: {
  mimetype: 'audio/ogg',
  filename: 'voice.ogg',
  data: String(data).trim()
},
convert: true
```

No cambiar el contrato probado a `audio/ogg; codecs=opus` en el payload final de WAHA. El codec puede venir en la entrada, pero el adaptador normaliza a `audio/ogg`.

## Evidencia viva verificada

### VPS y proceso

```text
Rama: agent/voice-pipeline-v2
Commit: d910ca8845f6dfe8d752064639303d566ae01746
Proceso: /usr/bin/node /opt/elankav/orchestrator/server.voice-pipeline-v2.js
VOICE_PIPELINE_V2_ENABLED=true
```

### Sesión WAHA

```text
status: WORKING
gRPC client: READY
gRPC stream: READY
GOWS found: true
GOWS connected: true
```

La presencia `offline` no impidió la entrega y no fue la causa raíz.

### Recorrido E2E confirmado

```text
RECEIVED
→ DOWNLOAD_STARTED
→ fallback local de media cuando la URL pública devuelve 502
→ DOWNLOAD_COMPLETED
→ TRANSCRIPTION_STARTED
→ TRANSCRIPTION_COMPLETED
→ AI_STARTED
→ AI_COMPLETED
→ SPEECH_STARTED
→ POST /api/sendVoice = 201
→ messageId real generado por WAHA
→ VOICE_REPLY_SENT
→ COMPLETED
→ audio recibido en el teléfono
```

### Pruebas

Comando ejecutado:

```bash
node --test \
  tests/wahaDeliveryAdapter.test.js \
  test/voicePipelineV2.test.js \
  test/wahaWebhookApiV2.test.js
```

Resultado final:

```text
tests 20
pass 20
fail 0
```

## Diagnóstico correcto si vuelve a fallar

No asumir que `VOICE_REPLY_SENT` significa entrega al teléfono. Validar por etapas:

1. `systemctl status elankav-orchestrator.service`.
2. `systemctl cat elankav-orchestrator.service`.
3. proceso real en `/proc/<pid>/cmdline` o `ps`.
4. `VOICE_PIPELINE_V2_ENABLED` dentro de `/proc/<pid>/environ`.
5. evento `BOOTSTRAP_ENABLED`.
6. `TRANSCRIPTION_COMPLETED`.
7. `AI_COMPLETED`.
8. `SPEECH_STARTED`.
9. respuesta real de `/api/sendVoice`, incluido `messageId`.
10. logs del contenedor WAHA.
11. confirmación física de recepción en WhatsApp.

Un HTTP `201` y un `messageId` prueban creación de la solicitud en WAHA, pero la aceptación final debe incluir una prueba real en el teléfono.

## Validación antes de despliegue

```bash
npm test
```

Debe verificarse además:

1. Suite completa aprobada.
2. Mensaje de texto procesado una sola vez.
3. Nota GOWS con URL procesada.
4. Nota GOWS sin URL recuperada por ID.
5. MIME con codecs normalizado.
6. Respuesta de voz recibida físicamente en WhatsApp.
7. Fallback de texto recibido al forzar fallo TTS o entrega.
8. Duplicado rechazado sin segundo envío.
9. Reintento permitido después de fallo.
10. Reversión validada con la bandera desactivada.
11. `ExecStart` apuntando al bootstrap V2.
12. `sendVoice` usando `filename: 'voice.ogg'` y `convert: true`.

## Activación controlada

La puesta en marcha requiere que el servicio ejecute:

```text
/opt/elankav/orchestrator/server.voice-pipeline-v2.js
```

Con la bandera en falso, el bootstrap utiliza el handler anterior:

```text
VOICE_PIPELINE_V2_ENABLED=false
```

La activación se realiza con:

```text
VOICE_PIPELINE_V2_ENABLED=true
```

Solo debe reiniciarse `elankav-orchestrator.service`. No reiniciar el VPS completo por este cambio.

## Reversión

### Reversión funcional del handler

Establecer:

```text
VOICE_PIPELINE_V2_ENABLED=false
```

Y reiniciar únicamente `elankav-orchestrator.service`. El bootstrap vuelve a cargar `api/wahaWebhookApi.js`.

### Reversión del arranque systemd

Restaurar temporalmente:

```text
ExecStart=/usr/bin/node /opt/elankav/orchestrator/server.js
```

Solo si el bootstrap V2 no puede iniciar. Esta reversión desactiva funcionalmente el flujo V2 aunque la bandera permanezca configurada.

### Reversión de entrega WAHA

Restaurar el adaptador anterior únicamente si `convert: true` provoca una regresión demostrada. No revertir por un `502` de descarga pública cuando el fallback local funciona.

No es necesario revertir WAHA, CONNECT, Supabase ni reiniciar el servidor completo.

## Prohibiciones

- No iniciar producción directamente con `server.js` cuando se espera Voice Pipeline V2.
- No considerar activa la bandera sin comprobar el proceso real.
- No considerar entregada una voz únicamente por `VOICE_REPLY_SENT`.
- No dejar logs de transcripción o respuestas completas en producción.
- No registrar secretos, números completos ni URLs firmadas.
- No eliminar el flujo anterior hasta completar prueba real y reversión.
- No modificar WAHA, CONNECT ni Supabase sin evidencia de que el fallo pertenece a esa capa.

## Estado final

**RESUELTO Y VALIDADO EN PRODUCCIÓN EL 2026-08-01.**

La configuración operativa certificada combina:

```text
server.voice-pipeline-v2.js
VOICE_PIPELINE_V2_ENABLED=true
api/wahaWebhookApiV2.js
mimetype=audio/ogg
filename=voice.ogg
convert=true
```

Cualquier auditoría futura debe comenzar por esta configuración y revisar únicamente diferencias posteriores.