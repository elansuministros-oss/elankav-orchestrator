# VOICE PIPELINE V2 — Implementación controlada

## Control

| Campo | Valor |
|---|---|
| Repositorio | `elansuministros-oss/elankav-orchestrator` |
| Rama base | `feature/ORCH-AI-PLATFORM-KNOWLEDGE-01` |
| Commit base | `525d953c2c3bd0f6a29d7860db5a606e4bd9ee01` |
| Rama de implementación | `agent/voice-pipeline-v2` |
| Estado | Implementado en rama; pendiente suite completa y prueba real |
| Producción | Sin modificar |

## Arquitectura

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
  → respuesta de voz
  → fallback de texto
```

## Componentes

| Archivo | Responsabilidad |
|---|---|
| `server.voice-pipeline-v2.js` | Bootstrap reversible; selecciona handler mediante bandera |
| `api/wahaWebhookApiV2.js` | Handler completo para voz V2 y texto preservado |
| `modules/voicePipelineV2/wahaVoiceEvent.js` | Normalización GOWS, `@lid`, MIME, ID y media |
| `adapters/wahaVoiceMediaAdapterV2.js` | Recuperación del mensaje con `downloadMedia=true` |
| `services/voicePipelineV2Service.js` | Idempotencia, STT, IA, TTS, entrega y fallback |
| `test/voicePipelineV2.test.js` | Pruebas unitarias del pipeline |
| `test/wahaWebhookApiV2.test.js` | Pruebas de integración del webhook |

## Reglas

- Los mensajes de texto no entran al procesamiento de voz.
- Los mensajes de voz se reconocen por `type`, `audioMessage` o MIME real `audio/*`.
- `audio/ogg; codecs=opus` se normaliza a `audio/ogg`.
- Si falta `media.url`, se consulta WAHA por el último segmento del ID GOWS.
- La idempotencia dura diez minutos.
- Un fallo libera la clave para permitir un reintento real.
- Un fallo de síntesis o envío de voz utiliza la respuesta aprobada como texto.
- No se registran transcripciones, tokens, números completos ni URLs completas.

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
6. Respuesta de voz recibida.
7. Fallback de texto recibido al forzar fallo TTS.
8. Duplicado rechazado sin segundo envío.
9. Reintento permitido después de fallo.
10. Reversión validada con la bandera desactivada.

## Activación controlada

La primera puesta en marcha requiere que el servicio ejecute:

```text
/opt/elankav/orchestrator/server.voice-pipeline-v2.js
```

Con la bandera en falso, el bootstrap utiliza el handler anterior:

```text
VOICE_PIPELINE_V2_ENABLED=false
```

Después de validar el arranque sin cambios funcionales, la activación se realiza con:

```text
VOICE_PIPELINE_V2_ENABLED=true
```

Solo debe reiniciarse `elankav-orchestrator.service`.

## Reversión

Establecer:

```text
VOICE_PIPELINE_V2_ENABLED=false
```

Y reiniciar únicamente `elankav-orchestrator.service`. El bootstrap vuelve a cargar `api/wahaWebhookApi.js`. No es necesario revertir WAHA, CONNECT, Supabase ni el código desplegado.

## Prohibiciones

- No fusionar antes de aprobar la suite completa.
- No activar directamente en producción sin validar primero la bandera en `false`.
- No eliminar el flujo anterior hasta completar prueba real y reversión.
- No modificar WAHA, CONNECT ni Supabase como parte de este cambio.
