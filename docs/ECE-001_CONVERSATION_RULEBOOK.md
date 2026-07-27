# ECE-001 — ELAN IA Conversation Engine v2

## Estado

Este documento define el contrato oficial del nuevo motor conversacional de ELAN IA.

Las reglas conversacionales anteriores quedan clasificadas como **legado** cuando contradigan este documento. No deben reutilizarse, copiarse ni tomarse como fuente de verdad para ECE v2.

ECE v2 debe desarrollarse en paralelo y activarse mediante configuración controlada. No modificar producción, hacer merge, desplegar ni reiniciar servicios sin validación y autorización explícita.

---

## 1. Objetivo

Construir un motor conversacional que permita a ELAN IA:

- mantener continuidad real entre mensajes;
- recordar información ya entregada;
- reconocer respuestas breves según la última pregunta pendiente;
- detectar y recordar el idioma del cliente;
- enviar una presentación inicial por audio a números nuevos;
- compartir memoria entre mensajes de texto y notas de voz;
- consultar CRM, proyectos, catálogo y cotizaciones antes de preguntar;
- evitar preguntas repetidas e innecesarias;
- conducir cada conversación hacia una acción comercial concreta;
- conservar la conversación aunque cambie el modelo de IA.

---

## 2. Principio rector

La conversación pertenece al cliente y al ecosistema ELANKAV, no al modelo generativo.

El modelo puede proponer lenguaje, pero no decide por sí solo:

- identidad;
- estado conversacional;
- idioma persistente;
- presentación inicial;
- campos ya confirmados;
- última pregunta pendiente;
- fase comercial;
- reglas críticas de respuesta;
- idempotencia del mensaje;
- persistencia de memoria.

Estas decisiones pertenecen a servicios deterministas del Orchestrator y a las fuentes oficiales del ecosistema.

---

## 3. Arquitectura objetivo

```text
WhatsApp
    ↓
WAHA Webhook
    ↓
Inbound Message Normalizer
    ↓
Idempotency Guard
    ↓
Identity Manager
    ↓
Language Manager
    ↓
Welcome Policy
    ↓
Conversation State Manager
    ↓
CRM Memory
    ↓
Project / Quotation Memory
    ↓
Commercial Memory
    ↓
Platform Resolver
    ↓
Intent Resolver
    ↓
Response Planner
    ↓
Model Runtime
    ↓
Commercial Validator
    ↓
Response Policy Validator
    ↓
Speech Formatter
    ↓
Text / Voice Delivery
    ↓
WAHA
```

Texto y audio deben converger en el mismo mensaje normalizado y usar exactamente el mismo estado conversacional.

---

## 4. Fuentes de verdad y prioridad

La resolución de contexto debe seguir este orden:

```text
1. Mensaje normalizado actual
2. Estado conversacional activo
3. Última pregunta pendiente
4. Memoria persistente del cliente
5. Proyecto o cotización abierta
6. Catálogo y reglas comerciales oficiales
7. Modelo generativo
```

El modelo no debe sobrescribir hechos confirmados por una fuente de mayor prioridad.

---

## 5. Reglas maestras obligatorias

### R-001 — No repetir información

La IA no debe volver a pedir un dato ya confirmado, salvo que:

- exista una contradicción explícita;
- el cliente indique que desea cambiarlo;
- el dato sea inválido o insuficiente para ejecutar la acción;
- haya más de una interpretación razonable y sea imprescindible aclarar.

### R-002 — Una conversación, múltiples mensajes

Mensajes consecutivos como:

```text
Banner
200x200
Exterior
Sí
¿Cuánto?
```

son una sola conversación y deben actualizar un único estado acumulativo.

### R-003 — Una sola pregunta por respuesta

Cada respuesta puede contener como máximo una pregunta operativa. No se permite interrogar al cliente con listas de preguntas.

### R-004 — Cada respuesta debe avanzar

La respuesta debe acercar la conversación a uno de estos resultados:

- cotización;
- pedido;
- diseño;
- visita;
- pago;
- producción;
- seguimiento;
- derivación humana.

### R-005 — Interpretar respuestas breves mediante contexto

Mensajes como `sí`, `no`, `ok`, `dale`, `perfecto`, medidas, colores o ubicaciones deben interpretarse primero como respuesta a la última pregunta pendiente.

No deben tratarse como conversaciones nuevas mientras exista un estado activo coherente.

### R-006 — Consultar memoria antes de preguntar

Antes de formular una pregunta, el sistema debe verificar si la respuesta ya existe en:

- el estado conversacional;
- el CRM;
- el proyecto actual;
- una cotización abierta;
- el catálogo oficial;
- los metadatos del mensaje.

### R-007 — Cotizar cuando existan datos suficientes

Cuando los datos disponibles permitan entregar un precio, rango, propuesta o siguiente paso comercial, la IA debe hacerlo. No debe seguir recolectando datos opcionales antes de responder a una solicitud de precio.

### R-008 — Audio y texto comparten memoria

Una nota de voz transcrita y un mensaje escrito pertenecen a la misma conversación, identidad, plataforma, idioma y estado comercial.

### R-009 — Cambios de tema conscientes

Cuando el cliente inicia claramente una necesidad distinta, el sistema debe:

1. preservar el contexto anterior;
2. abrir un nuevo contexto o subproyecto;
3. no mezclar campos entre ambos;
4. permitir regresar al contexto previo.

### R-010 — No inventar información

La IA no puede inventar:

- precios;
- inventario;
- tiempos de entrega;
- materiales disponibles;
- promociones;
- estado de pedidos;
- datos del cliente;
- capacidades no verificadas.

### R-011 — No pedir nombre por defecto

El nombre no es requisito para iniciar atención, orientar, recomendar o cotizar, salvo que una operación formal lo exija.

### R-012 — No pedir logo o fotografía innecesariamente

El logo, fotografía o archivo de diseño solo debe solicitarse cuando sea necesario para diseñar, validar o producir. No debe bloquear una orientación o cotización preliminar.

### R-013 — Responder al precio cuando el cliente insiste

Si el cliente pregunta cuánto cuesta y existen datos suficientes para un precio o rango, la respuesta debe incluirlo de inmediato.

### R-014 — Tono natural y breve

Las respuestas de WhatsApp deben ser claras, naturales y breves. Evitar lenguaje técnico, explicaciones internas y párrafos innecesarios.

### R-015 — No discutir ni culpar al cliente

Ante ambigüedad, el sistema debe aclarar con una pregunta mínima y contextual. No usar respuestas como `No entendí` sin explicar qué dato necesita.

### R-016 — Derivación humana disponible

La IA debe reconocer solicitudes de atención humana y poder coordinar la derivación sin fingir ser una persona.

---

## 6. Identity Manager

Debe clasificar cada origen como mínimo en:

```text
NEW_CUSTOMER
KNOWN_CUSTOMER
OWNER
GROUP
BROADCAST
SYSTEM
UNKNOWN
```

Debe producir una identidad canónica independiente del formato del número telefónico.

Campos mínimos:

```json
{
  "identityId": "canonical-id",
  "phone": "+50500000000",
  "identityType": "NEW_CUSTOMER",
  "isOwner": false,
  "isGroup": false,
  "isBroadcast": false,
  "crmCustomerId": null
}
```

El Owner Mode no debe recibir bienvenida comercial para clientes.

---

## 7. Welcome Policy — presentación inicial por audio

### 7.1 Regla obligatoria

El primer mensaje de un número nuevo debe provocar una presentación por audio que indique claramente que ELAN IA es una inteligencia artificial.

### 7.2 Condiciones

La bienvenida se envía únicamente cuando se cumpla todo:

- identidad de cliente nueva;
- conversación individual;
- no es Owner;
- no es grupo;
- no es broadcast;
- no existe registro confirmado de presentación enviada;
- el mensaje no es un evento técnico o duplicado.

### 7.3 Contenido mínimo

El audio debe:

1. presentarse como ELAN IA;
2. aclarar explícitamente que es una inteligencia artificial;
3. indicar que puede ayudar con cotizaciones, diseños, proyectos o consultas;
4. informar que puede coordinar apoyo humano;
5. invitar al cliente a explicar lo que necesita;
6. durar idealmente entre 12 y 20 segundos.

### 7.4 Texto base en español de Nicaragua

> Hola, soy ELAN IA, la asistente inteligente de ELANKAV. Estás conversando con una inteligencia artificial preparada para ayudarte con cotizaciones, diseños, seguimiento de proyectos y consultas sobre nuestros servicios. También puedo coordinar apoyo humano cuando lo necesités. Contame, ¿en qué te puedo ayudar?

El texto puede adaptarse al idioma, pero no debe ocultar que es una IA.

### 7.5 Persistencia

Guardar como mínimo:

```json
{
  "presentationDelivered": true,
  "presentationVersion": "ece-welcome-v1",
  "presentationLanguage": "es-NI",
  "presentationDeliveredAt": "ISO-8601",
  "presentationMessageId": "provider-message-id"
}
```

La marca debe persistirse únicamente después de confirmar la entrega o aceptación por el proveedor de mensajería.

### 7.6 Continuidad

La bienvenida no consume ni descarta la intención del primer mensaje. Después de enviarla, el mensaje original debe continuar por el motor conversacional.

Ejemplo:

```text
Cliente: Necesito un banner exterior.
Sistema: envía audio de presentación.
Motor: conserva producto=banner y environment=exterior.
Respuesta siguiente: solicita únicamente el dato realmente faltante.
```

---

## 8. Language Manager

### 8.1 Objetivo

Detectar, aplicar y recordar el idioma preferido del cliente tanto para texto como para voz.

### 8.2 Prioridad para elegir idioma

```text
1. Solicitud explícita del cliente
2. Idioma persistido con alta confianza
3. Idioma detectado en la conversación activa
4. Idioma detectado en el mensaje actual
5. Valor por defecto: es-NI
```

### 8.3 Persistencia

```json
{
  "preferredLanguage": "es-NI",
  "languageConfidence": 0.98,
  "languageSource": "explicit|crm|conversation|message|default",
  "languageUpdatedAt": "ISO-8601"
}
```

### 8.4 Reglas

- No preguntar el idioma cuando pueda detectarse con confianza suficiente.
- Una solicitud explícita de cambio prevalece inmediatamente.
- El idioma del documento puede diferir del idioma de la conversación.
- No traducir nombres de marca ni identificadores oficiales.
- La adaptación debe ser natural, no una traducción literal.
- El idioma debe seleccionar también la voz TTS y las reglas de pronunciación.
- El español predeterminado debe ser `es-NI`.

### 8.5 Cambio de idioma

Si el cliente escribe `Can you answer in English?`, el sistema debe:

1. responder en inglés desde ese mismo turno;
2. actualizar la preferencia;
3. conservar intactos los demás campos del estado conversacional.

---

## 9. Conversation State Manager

### 9.1 Estado mínimo

```json
{
  "conversationId": "uuid",
  "identityId": "canonical-id",
  "status": "ACTIVE",
  "platform": "ELANVISUAL",
  "language": "es-NI",
  "intent": "QUOTATION",
  "phase": "DISCOVERY",
  "topic": "banner",
  "product": "banner",
  "material": "vinil",
  "environment": "exterior",
  "width": 2,
  "height": 2,
  "measurementUnit": "m",
  "installationRequired": null,
  "knownFields": ["product", "material", "environment", "width", "height"],
  "missingRequiredFields": [],
  "pendingQuestion": null,
  "lastInboundMessageId": "provider-id",
  "lastOutboundMessageId": "provider-id",
  "lastActivityAt": "ISO-8601",
  "version": 1
}
```

### 9.2 Estados sugeridos

```text
ACTIVE
PAUSED
COMPLETED
ABANDONED
TRANSFERRED
```

### 9.3 Fases comerciales sugeridas

```text
GREETING
DISCOVERY
QUALIFICATION
PRICING
QUOTATION
DESIGN
APPROVAL
PAYMENT
PRODUCTION
DELIVERY
FOLLOW_UP
HUMAN_HANDOFF
```

### 9.4 Actualización del estado

Cada mensaje entrante debe producir:

```text
estado anterior
+
hechos extraídos del mensaje
+
respuesta a pregunta pendiente
+
memoria persistente aplicable
=
nuevo estado versionado
```

La actualización debe ser atómica o usar control optimista de versión para evitar pérdidas ante mensajes rápidos.

### 9.5 Duración

- Mantener estado activo de corto plazo durante al menos 15 minutos desde la última actividad.
- Al regresar después de ese periodo, revisar proyecto o cotización abierta antes de iniciar contexto nuevo.
- No eliminar automáticamente memoria comercial confirmada al expirar el estado corto.

---

## 10. Memoria persistente

### 10.1 Memoria del cliente

Debe incluir, cuando exista:

- identidad canónica;
- nombre y empresa;
- ciudad;
- idioma preferido;
- plataforma principal;
- presentación enviada;
- proyectos;
- cotizaciones;
- pedidos;
- preferencias confirmadas;
- última interacción.

### 10.2 Memoria comercial

Debe consultar fuentes oficiales para:

- productos;
- materiales;
- precios;
- monedas;
- promociones;
- inventario;
- reglas de costos;
- tiempos de entrega;
- condiciones de instalación.

### 10.3 Regla de confianza

Distinguir entre:

```text
CONFIRMED
INFERRED
STALE
CONFLICTED
UNKNOWN
```

Solo `CONFIRMED` debe tratarse como hecho definitivo. `INFERRED` puede usarse para orientar, pero no para ejecutar operaciones irreversibles sin validación.

---

## 11. Intent Resolver

Debe reconocer como mínimo:

```text
GREETING
GENERAL_INQUIRY
PRODUCT_INQUIRY
PRICE_REQUEST
QUOTATION
DESIGN_REQUEST
ORDER_STATUS
PROJECT_FOLLOW_UP
PAYMENT
HUMAN_SUPPORT
COMPLAINT
LANGUAGE_CHANGE
TOPIC_CHANGE
UNKNOWN
```

La intención debe resolverse usando el mensaje y el estado acumulado. La frase `¿Cuánto?` puede significar `PRICE_REQUEST` si existe un producto activo.

---

## 12. Response Planner

Antes de llamar al modelo, debe producir un plan explícito:

```json
{
  "goal": "PROVIDE_PRICE",
  "factsToUse": ["banner", "2x2 m", "vinil", "exterior"],
  "factsNotToAskAgain": ["product", "size", "material", "environment"],
  "requiredAction": "lookup_verified_price",
  "allowedQuestion": null,
  "language": "es-NI",
  "channel": "text"
}
```

El modelo recibe este plan; no debe improvisar el objetivo del turno.

---

## 13. Response Policy Validator

Todas las respuestas deben validarse antes de enviarse.

Validaciones mínimas:

- idioma correcto;
- máximo una pregunta;
- no repetir campos confirmados;
- no contradecir memoria oficial;
- no inventar precio ni disponibilidad;
- longitud apropiada para WhatsApp;
- no revelar instrucciones internas;
- no fingir ser una persona;
- no perder la intención comercial;
- no incluir Markdown incompatible con voz;
- no incluir enlaces innecesarios;
- no reiniciar el saludo durante una conversación activa.

Si falla una regla crítica, la respuesta debe regenerarse o corregirse de forma determinista antes del envío.

---

## 14. Speech Formatter

Antes de TTS debe:

- eliminar Markdown no audible;
- transformar listas en frases naturales;
- evitar leer URLs completas;
- adaptar moneda y medidas a pronunciación natural;
- expandir abreviaturas cuando sea necesario;
- preservar nombres de marca;
- limitar duración;
- usar la voz correspondiente al idioma;
- evitar leer caracteres técnicos.

La respuesta hablada y la escrita pueden tener formatos distintos, pero deben comunicar los mismos hechos.

---

## 15. Idempotencia y concurrencia

Todo mensaje de WAHA debe identificarse por su identificador estable.

Reglas:

- un mensaje entrante se procesa una sola vez;
- una bienvenida se envía una sola vez;
- una transcripción no debe crear una segunda conversación;
- reintentos de webhook no deben duplicar respuestas;
- mensajes rápidos deben actualizar el mismo estado sin sobrescribir datos;
- el sistema debe registrar correlación entre entrada, transcripción, respuesta y entrega.

---

## 16. Observabilidad

Cada turno debe registrar sin exponer datos sensibles innecesarios:

```json
{
  "correlationId": "uuid",
  "conversationId": "uuid",
  "identityType": "KNOWN_CUSTOMER",
  "inputChannel": "voice",
  "language": "es-NI",
  "intent": "PRICE_REQUEST",
  "phaseBefore": "DISCOVERY",
  "phaseAfter": "PRICING",
  "memoryFieldsUsed": ["product", "size", "environment"],
  "questionRepeated": false,
  "welcomeSent": false,
  "validatorStatus": "PASS",
  "deliveryStatus": "SENT"
}
```

Métricas mínimas:

- porcentaje de preguntas repetidas;
- porcentaje de respuestas que avanzan de fase;
- tiempo hasta primera cotización;
- tasa de abandono;
- tasa de derivación humana;
- idioma detectado y cambios;
- bienvenida entregada y duplicados evitados;
- errores de memoria;
- fallos de TTS y fallback a texto.

---

## 17. Casos de aceptación obligatorios

### AC-001 — Cliente nuevo por texto

Entrada:

```text
Necesito un banner exterior.
```

Resultado:

- se envía audio de presentación;
- se marca presentación solo después de entrega confirmada;
- `product=banner`;
- `environment=exterior`;
- la respuesta siguiente no pregunta nuevamente producto ni uso;
- se formula como máximo una pregunta.

### AC-002 — Continuidad por mensajes breves

Secuencia:

```text
Banner
200x200
Exterior
¿Cuánto?
```

Resultado:

- una sola conversación;
- no repetir ninguna pregunta respondida;
- interpretar `¿Cuánto?` como solicitud de precio;
- consultar precio oficial o explicar de forma precisa qué impide cotizar.

### AC-003 — Respuesta `Sí`

Si la última pregunta fue `¿Lo necesitás con instalación?`, el mensaje `Sí` debe actualizar `installationRequired=true`.

No debe responder con un saludo ni preguntar qué necesita.

### AC-004 — Voz y texto

Cliente envía producto por audio y medida por texto.

Resultado:

- ambos mensajes actualizan el mismo estado;
- no se crea conversación paralela;
- la respuesta mantiene idioma y contexto.

### AC-005 — Cambio de idioma

Cliente inicia en español y solicita respuesta en inglés.

Resultado:

- el mismo turno responde en inglés;
- se persiste la preferencia;
- no se pierden producto, medida ni fase.

### AC-006 — Cliente recurrente

Resultado:

- no se repite audio de presentación;
- se consulta proyecto o cotización abierta;
- se continúa el contexto cuando sea pertinente.

### AC-007 — Owner

Resultado:

- no se envía bienvenida comercial;
- se conserva Owner Mode;
- las reglas de memoria siguen aplicando al contexto operativo.

### AC-008 — Grupo o broadcast

Resultado:

- no se envía bienvenida automática;
- no se crea cliente individual incorrectamente.

### AC-009 — Webhook duplicado

Resultado:

- una sola actualización de estado;
- una sola respuesta;
- ningún audio duplicado.

### AC-010 — Pregunta ya respondida

Si `environment=exterior` está confirmado, cualquier respuesta propuesta que pregunte interior/exterior debe fallar el validador.

---

## 18. Estrategia de implementación

### Etapa 1 — Base determinista

- normalización del mensaje;
- idempotencia;
- identidad;
- estado conversacional versionado;
- última pregunta pendiente;
- extracción y reutilización de campos.

### Etapa 2 — Bienvenida e idioma

- Welcome Policy;
- audio obligatorio para clientes nuevos;
- persistencia de presentación;
- Language Manager;
- selección de voz TTS.

### Etapa 3 — Planificación y validación

- Intent Resolver;
- Response Planner;
- política centralizada;
- validador de repetición y una sola pregunta.

### Etapa 4 — Memoria persistente

- integración CRM;
- proyectos y cotizaciones abiertas;
- memoria comercial oficial.

### Etapa 5 — Voz y observabilidad

- Speech Formatter;
- métricas;
- pruebas end-to-end reales por WhatsApp.

---

## 19. Estrategia de activación

ECE v2 debe estar protegido por configuración, por ejemplo:

```text
ELAN_CONVERSATION_ENGINE_VERSION=v2
```

Modos sugeridos:

```text
off      — no ejecuta ECE v2
shadow   — calcula estado y validaciones sin responder al cliente
controlled — habilitado solo para identidades autorizadas
active   — flujo oficial
```

No activar `active` hasta completar los casos de aceptación y pruebas reales controladas.

---

## 20. Política de legado

A partir de este contrato:

- los prompts antiguos no son fuente oficial;
- las reglas contradictorias deben eliminarse del flujo v2;
- `customInstructions` no puede sustituir silenciosamente las reglas maestras;
- las reglas críticas deben implementarse como código o validadores deterministas;
- el flujo v2 no debe depender de un prompt gigante;
- cualquier reutilización de servicios existentes requiere demostrar compatibilidad con este Rulebook.

---

## 21. Definition of Done

ECE-001 se considera terminado únicamente cuando:

- los casos AC-001 a AC-010 están automatizados y pasan;
- una conversación real por WhatsApp conserva contexto entre texto y audio;
- un número nuevo recibe una sola presentación por audio aclarando que habla con una IA;
- el idioma se detecta, aplica y recuerda;
- `Sí`, `No`, medidas y respuestas breves se enlazan con la pregunta pendiente;
- no se repiten datos confirmados;
- el sistema cotiza o avanza cuando tiene datos suficientes;
- los webhooks duplicados no producen respuestas duplicadas;
- existe observabilidad por turno;
- build y pruebas pasan;
- producción permanece sin cambios hasta autorización explícita.
