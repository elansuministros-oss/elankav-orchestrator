# CONNECT AI Runtime Authority Lock

## Regla de arquitectura

Para ELANVISUAL, ELANHOME y ELANPET, el Orchestrator NO es autoridad de identidad, conversación ni encendido/apagado.

La única autoridad administrativa es:

https://connect.elankav.com/console/ai-platforms

El Orchestrator es ejecutor. Antes de responder a un cliente externo debe consultar el runtime de CONNECT:

GET /console/api/ai-platforms/runtime/:platformId

El runtime válido debe declarar:

- authority = CONNECT_AI_PLATFORMS
- authorityLocked = true
- execution.shouldRespond
- platform.initialMessage
- platform.instructions
- platform.responseRules
- platform.continuity
- platform.catalogAccess

## Fail closed

Si CONNECT no está disponible, el token interno no coincide, la autoridad no coincide o execution.shouldRespond no es true:

- el mensaje puede recibirse/persistirse;
- NO se genera una personalidad alternativa;
- NO se responde automáticamente al cliente.

Las órdenes Owner internas siguen separadas de este control comercial.

## Prohibido

No agregar un CUSTOMER_INSTRUCTIONS, prompt JSON, variable de entorno, archivo local o segunda base que sustituya la configuración publicada por CONNECT.

No reactivar un enlace de diseño hardcodeado. El enlace y su activación salen de responseRules.designRequest en CONNECT.

No permitir que el parámetro instructions de una llamada externa sustituya las instrucciones publicadas para clientes.

Cambiar esta regla requiere un cambio de arquitectura explícito y actualizar las pruebas de bloqueo.
