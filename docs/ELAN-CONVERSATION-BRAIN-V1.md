# ELAN Conversation Brain V1

## Objetivo

Mejorar la comprensión y la calidad de respuesta de ELAN sin crear una arquitectura paralela ni mover la autoridad de datos fuera de CONNECT/Orchestrator.

## Contratos recuperados

### OPERADOR_AI-001 — motor comercial

Reglas preservadas:

- ELAN se comporta como vendedor experto.
- Responde primero con lo que ya sabe.
- Máximo una pregunta por respuesta y solo cuando sea indispensable.
- No inicia cuestionarios largos.
- No inventa precios.
- No altera precios, medidas o materiales ya verificados.
- Reutiliza contexto y mantiene un Estado Comercial Persistente.
- No crea módulos duplicados.

Estado comercial de referencia:

```json
{
  "platform": "ELANVISUAL",
  "category": "ROTULACION",
  "product": "JALA_VISTA",
  "width": 60,
  "height": 40,
  "quantity": 1,
  "finish": "LUZ",
  "status": "COTIZANDO"
}
```

### VOICE-001 — identidad oficial

VOICE-001 continúa siendo el contrato oficial de identidad vocal.

Perfil lógico preservado por Orchestrator:

```text
profile_key = elan-ia-official-v1
language    = es-419
provider    = openai
model       = gpt-4o-mini-tts
voice       = cedar
output      = opus/WAHA voice pipeline
```

Identidad:

- masculina;
- natural;
- agradable;
- confiable;
- cercana;
- empática;
- profesional;
- elegante;
- segura;
- no robótica;
- adulto percibido 30–40;
- español latino neutral con calidez centroamericana ligera.

La identidad vocal permanece desacoplada de Langflow. Langflow nunca sintetiza ni entrega audio.

## Arquitectura V1

```text
WhatsApp / Voz / CONNECT
        ↓
Orchestrator
  identidad + permisos
        ↓
Unified Memory (CONNECT)
  historial + working_state
        ↓
Langflow localhost
  ELAN Conversation Brain
  ├─ task=plan
  └─ task=compose
        ↓
Orchestrator valida
        ↓
elanUnifiedToolRegistry
        ↓
CONNECT / VQS / capacidades autorizadas
        ↓
respuesta aprobada
        ↓
Langflow task=compose (solo lecturas)
        ↓
Orchestrator
        ├─ texto → WAHA/CONNECT
        └─ audio → CONNECT Voice → WAHA
```

## Límites de seguridad

Langflow:

- no recibe VQS_API_TOKEN;
- no ejecuta HTTP arbitrario;
- no ejecuta mutations;
- no envía mensajes;
- no despliega;
- no paga;
- no elimina;
- no sintetiza voz;
- no sustituye CONNECT como memoria o fuente de verdad.

Orchestrator:

- conserva identidad y permisos;
- filtra herramientas autorizadas;
- valida nuevamente el nombre de herramienta;
- ejecuta la acción real;
- conserva operaciones sensibles en gates deterministas;
- persiste el estado comercial en Unified Memory.

## Task plan

Entrada:

- mensaje natural;
- actor/rol;
- plataforma/canal;
- historial reciente;
- estado comercial persistente;
- manifiesto de herramientas de lectura.

Salida:

```json
{
  "tool": "buscar_cliente",
  "arguments": {"query": "COMEX"},
  "confidence": 0.91,
  "reason": "consulta de cliente",
  "state_patch": {
    "customerReference": "COMEX"
  }
}
```

El `state_patch` solo acepta campos comerciales aprobados. El Orchestrator lo valida antes de persistir.

## Task compose

Recibe únicamente la respuesta ya autorizada por el runtime, no el resultado crudo completo.

Ejemplo:

```text
approved_reply:
No encontré registros que coincidan.
```

Puede convertirlo en:

```text
No encontré ese proveedor por ese nombre. ¿Querés que lo busque por teléfono?
```

Sin inventar registros, cambiar precios, alterar medidas ni convertir un fallo en éxito.

## Voz

No se modifica Voice Pipeline V2 en este movimiento.

El flujo certificado permanece:

```text
AUDIO inbound
→ WAHA
→ Orchestrator
→ CONNECT STT
→ ELAN Conversation/Business
→ respuesta final aprobada
→ CONNECT TTS
→ WAHA sendVoice convert=true
→ WhatsApp
```

La mejora de conversación afecta el texto aprobado antes de TTS; la identidad vocal sigue bajo VOICE-001/CONNECT Voice.
