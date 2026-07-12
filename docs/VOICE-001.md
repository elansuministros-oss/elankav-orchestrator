# VOICE-001 — Identidad oficial de voz de ELAN IA

## Metadatos de control

| Campo | Valor |
|---|---|
| Documento | `VOICE-001` |
| Título | Identidad oficial de voz de ELAN IA |
| Estado | **APROBADO / CERRADO** |
| Clasificación | Diseño funcional y arquitectura; sin implementación STT/TTS |
| Propietario | ELANKAV Orchestrator |
| Fecha de aprobación | 12 de julio de 2026 |
| Versión | 1.0.0 |
| Dependencias | `AUD-001A`, `KB-001A`, Audio Intake Adapter, Audio Intake Service |
| Movimiento siguiente | `STT-001A` |
| Sustituye | Ninguno |
| Sustituido por | Ninguno |

## 1. Propósito

Definir la identidad oficial, persistente y reconocible de la voz de ELAN IA antes de implementar descarga de audio, transcripción, síntesis, generación o envío de voz.

VOICE-001 funciona como contrato de negocio y arquitectura para todos los proveedores STT/TTS futuros. La identidad pertenece a ELANKAV y no al proveedor tecnológico.

## 2. Alcance

VOICE-001 define:

- identidad vocal oficial;
- personalidad conversacional;
- criterios de idioma, acento, ritmo, tono y pausas;
- criterios objetivos de selección de proveedor;
- pruebas A/B;
- diccionario extensible de pronunciación;
- contrato conceptual de configuración persistente;
- límites arquitectónicos para futuros adapters y services.

VOICE-001 no implementa:

- descarga de archivos de audio;
- transcripción Speech-to-Text;
- OpenAI Speech ni otro proveedor STT;
- síntesis Text-to-Speech;
- clonación de voz;
- generación o envío de notas de voz;
- almacenamiento multimedia;
- cambios al webhook WAHA;
- cambios al Audio Intake Adapter o Audio Intake Service.

## 3. Estado previo validado

Al cierre de `AUD-001A` se encuentra documentado:

```text
WAHA
  ↓
api/whatsapp-v2
  ↓
Audio Intake Adapter
  ↓
Audio Intake Service
  ↓
Resultado normalizado
```

VOICE-001 no altera ese flujo. Introduce únicamente el contrato de identidad que deberá consumir la capa de negocio cuando exista una implementación TTS autorizada.

## 4. Principios obligatorios

1. **Identidad independiente del proveedor.** Cambiar OpenAI, ElevenLabs, Azure, Google u otro motor no debe cambiar la personalidad oficial.
2. **Arquitectura desacoplada.** Todo proveedor futuro se integra mediante Adapter y Service; la capa Business consume contratos neutrales.
3. **Configuración persistente.** La voz activa y su versión no dependen de valores dispersos en código o prompts aislados.
4. **Pronunciación extensible.** Agregar términos no requiere modificar el motor ni el adapter del proveedor.
5. **Consistencia multilingüe.** Español, inglés y mandarín deben conservar la misma identidad percibida.
6. **Trazabilidad.** Toda modificación del perfil, proveedor o diccionario debe registrar versión, fecha, motivo y evidencia.
7. **Sin degradación silenciosa.** Si un proveedor no cumple el perfil mínimo, el sistema debe declararlo y no presentar una voz distinta como oficial.

## 5. Arquitectura de referencia

```text
Canal / Mensaje
  ↓
Adapter de canal
  ↓
Service de canal
  ↓
Business / Respuesta aprobada
  ↓
Voice Profile Service
  ├── Perfil oficial versionado
  ├── Diccionario de pronunciación
  └── Configuración persistente
  ↓
TTS Service futuro
  ↓
TTS Provider Adapter futuro
  ↓
Proveedor de síntesis futuro
```

Reglas:

- la interfaz o webhook no selecciona directamente una voz del proveedor;
- Business solicita una identidad lógica, no un `voice_id` propietario;
- el Service resuelve la configuración activa;
- el Adapter traduce el contrato neutral al proveedor;
- ningún proveedor se convierte en fuente oficial del perfil.

## 6. Perfil oficial

### 6.1 Identidad

La voz oficial debe percibirse como:

- masculina;
- natural;
- agradable;
- confiable;
- cercana;
- empática;
- ligeramente pícara cuando el contexto lo permita;
- profesional;
- elegante;
- segura;
- no robótica.

### 6.2 Edad vocal percibida

Rango objetivo: adulto de aproximadamente 30 a 40 años.

Debe evitar:

- tono adolescente;
- tono excesivamente juvenil;
- voz envejecida o fatigada;
- locución radial exagerada;
- actuación teatral.

### 6.3 Conducta emocional

La voz debe transmitir:

- dominio del tema sin arrogancia;
- paciencia sin lentitud;
- calidez sin exceso de confianza;
- seguridad sin agresividad;
- simpatía sin perder precisión comercial.

La picardía será leve y contextual. Nunca se utilizará en reclamos, cobros delicados, errores, seguridad, contratos, datos personales o situaciones sensibles.

### 6.4 Comportamientos prohibidos

La voz oficial no debe sonar:

- robótica;
- monótona;
- autoritaria;
- condescendiente;
- infantil;
- excesivamente seductora;
- teatral;
- eufórica sin motivo;
- apurada;
- insegura al comunicar precios, medidas, fechas o instrucciones.

## 7. Idiomas y acento

### 7.1 Idioma principal

Español latino natural, claro y entendible en Nicaragua.

Referencia de acento:

- neutral latinoamericano;
- calidez centroamericana ligera;
- sin regionalismos que dificulten comprensión internacional.

Debe evitar acentos fuertemente marcados que cambien la identidad percibida o reduzcan claridad.

### 7.2 Idiomas adicionales

- inglés;
- chino mandarín.

Requisito: la voz debe conservar edad percibida, confianza, elegancia, cercanía y ritmo equivalentes en los tres idiomas.

No se aprobará una solución en la que cada idioma parezca una persona distinta, salvo que una limitación técnica sea documentada y aceptada mediante un movimiento posterior.

## 8. Parámetros vocales funcionales

Los valores exactos dependerán del proveedor, pero el contrato neutral debe poder representar:

| Parámetro | Objetivo funcional |
|---|---|
| Velocidad | Conversacional media; clara, sin prisa |
| Pitch | Masculino natural, sin profundidad artificial |
| Entonación | Variación moderada |
| Energía | Media y controlada |
| Pausas | Cortas y semánticas |
| Expresividad | Moderada |
| Estabilidad | Alta entre mensajes y sesiones |
| Volumen percibido | Uniforme |

Pausas recomendadas después de:

- precios;
- medidas;
- fechas;
- números de teléfono;
- instrucciones críticas;
- condiciones de pago;
- cambios de tema.

## 9. Diccionario oficial de pronunciación

### 9.1 Reglas

- El diccionario es una fuente de negocio independiente del proveedor.
- Debe ser versionado y persistente.
- Debe admitir idioma, contexto, prioridad, estado y fecha de actualización.
- Una entrada puede tener variantes por idioma o contexto.
- El Adapter traduce las reglas al formato compatible del proveedor.
- El motor no se modifica para agregar un término.

### 9.2 Diccionario inicial obligatorio

| Entrada | Pronunciación oficial en español |
|---|---|
| PVC | pevece |
| ACM | a ce eme |
| LED | led |
| RGB | erre ge be |
| CNC | ce ene ce |
| QR | cu erre |
| USB | u ese be |
| IVA | i va |
| USD | dólares |
| NIO | córdobas |
| m² | metros cuadrados |
| mm | milímetros |
| cm | centímetros |
| m | metros |
| kg | kilogramos |
| lb | libras |
| ERP | e erre pe |
| CRM | ce erre eme |
| API | a pe i |
| PDF | pe de efe |
| IA | i a |
| AI | ei ai en inglés; inteligencia artificial cuando el contexto requiera expansión |
| ELAN IA | Elan i a |
| ELANKAV | Elankav |
| WAHA | guaja, sujeto a prueba A/B de marca y claridad |

La pronunciación de marcas, nombres propios y términos internacionales debe validarse antes de incorporarse como regla definitiva.

### 9.3 Contrato conceptual de una entrada

```text
id
term
language
spoken_form
context
priority
case_sensitive
active
version
created_at
updated_at
updated_by
notes
```

## 10. Configuración persistente

La fuente oficial deberá residir en Supabase o en el mecanismo de configuración central autorizado por la arquitectura vigente. No se utilizará `localStorage` como fuente principal.

Contrato conceptual mínimo:

```text
profile_key
profile_version
status
primary_language
supported_languages
provider_key
provider_voice_id
fallback_provider_key
fallback_voice_id
speed
pitch
style
stability
similarity
pronunciation_dictionary_version
created_at
updated_at
approved_by
```

Reglas:

- `profile_key` identifica a ELAN IA sin depender del proveedor;
- `provider_voice_id` es una implementación reemplazable;
- la configuración activa debe tener una sola versión oficial;
- versiones anteriores permanecen auditables;
- cambios requieren validación A/B antes de activarse;
- secretos y credenciales no forman parte del perfil.

## 11. Proveedores compatibles a evaluar

VOICE-001 no aprueba todavía un proveedor único. Los candidatos deben evaluarse por capacidad contractual y resultados medibles.

### 11.1 OpenAI Speech

Evaluar:

- naturalidad;
- soporte multilingüe;
- latencia;
- consistencia de identidad;
- control de pronunciación;
- estabilidad del modelo y API;
- costos operativos.

### 11.2 ElevenLabs

Evaluar:

- identidad consistente;
- expresividad;
- soporte multilingüe;
- diccionarios o reglas de pronunciación;
- estabilidad de voz;
- licencias y derechos de uso;
- costos.

### 11.3 Azure AI Speech

Evaluar:

- soporte SSML;
- voces multilingües;
- control empresarial;
- disponibilidad regional;
- pronunciación técnica;
- costos y SLA.

### 11.4 Google Cloud Text-to-Speech

Evaluar:

- cobertura de idiomas;
- naturalidad;
- control de pronunciación;
- consistencia entre idiomas;
- latencia y costos.

### 11.5 Regla de proveedor

Ningún proveedor será declarado oficial solo por reputación o demostración comercial. Debe superar las pruebas definidas en este documento usando guiones de ELANKAV.

## 12. Plan de pruebas A/B

### 12.1 Muestras mínimas

Cada voz candidata debe generar los mismos guiones en:

- español;
- inglés;
- mandarín;
- respuesta comercial breve;
- explicación técnica;
- precio y condición de pago;
- medidas y materiales;
- saludo y despedida;
- manejo de una corrección;
- pronunciación del diccionario obligatorio.

### 12.2 Evaluadores

- propietario de ELANKAV;
- equipo interno designado;
- muestra controlada de oyentes nicaragüenses;
- evaluación técnica automatizable cuando exista.

### 12.3 Matriz de evaluación

Calificación sugerida: 1 a 5 por criterio.

| Criterio | Peso |
|---|---:|
| Naturalidad | 20% |
| Claridad en Nicaragua | 15% |
| Identidad y personalidad | 15% |
| Consistencia entre idiomas | 15% |
| Pronunciación técnica | 10% |
| Estabilidad entre muestras | 10% |
| Latencia | 5% |
| Costo operativo | 5% |
| Disponibilidad y continuidad | 5% |

Umbral propuesto de aprobación: 80/100, sin puntuación inferior a 3/5 en naturalidad, claridad, consistencia multilingüe o pronunciación técnica.

### 12.4 Condiciones de rechazo

Una voz se rechaza cuando:

- cambia perceptiblemente de identidad entre idiomas;
- pronuncia incorrectamente términos críticos sin mecanismo de corrección;
- suena robótica en conversaciones normales;
- presenta variaciones fuertes entre mensajes;
- requiere incrustar reglas de negocio dentro del Adapter;
- no permite uso comercial compatible con ELANKAV;
- su costo o disponibilidad impide operación sostenible.

## 13. Guiones base de evaluación

### Español

```text
Hola, soy ELAN IA. Te ayudo a cotizar, revisar medidas y organizar tu proyecto. Para este rótulo necesitamos PVC de seis milímetros, iluminación LED y una estructura calculada para exterior.
```

```text
El precio es de trescientos cincuenta dólares. El anticipo es del sesenta por ciento y el saldo se paga según la condición aprobada.
```

```text
La medida final es de uno punto diez metros de ancho por sesenta centímetros de alto. Antes de fabricar confirmaremos el diseño y el área real de instalación.
```

### Inglés

```text
Hello, I am ELAN IA. I can help you review measurements, materials, pricing, and production requirements for your project.
```

### Mandarín

El guion mandarín deberá ser traducido y revisado por una fuente competente antes de utilizarse como criterio de aprobación. No se registrará una traducción no verificada como oficial.

## 14. Seguridad, privacidad y derechos

Antes de activar una voz se debe verificar:

- licencia de uso comercial;
- propiedad y límites sobre voces clonadas;
- consentimiento cuando se use una voz basada en una persona;
- tratamiento de datos enviado al proveedor;
- retención de audio y texto;
- región de procesamiento;
- eliminación y auditoría;
- ausencia de secretos en logs o configuración.

VOICE-001 no autoriza clonación de voz de ninguna persona.

## 15. Observabilidad futura

La implementación TTS deberá registrar sin exponer contenido sensible:

- proveedor;
- versión del perfil;
- idioma;
- duración generada;
- latencia;
- éxito o error;
- uso de fallback;
- versión del diccionario;
- identificador de trazabilidad.

No se almacenará audio por defecto hasta que un movimiento multimedia defina retención, acceso, cifrado y eliminación.

## 16. Compatibilidad y fallback

El diseño futuro debe admitir:

```text
Perfil oficial ELAN IA
  ↓
Proveedor primario
  ↓ error o indisponibilidad
Proveedor secundario compatible
  ↓
Misma identidad funcional dentro de tolerancias aprobadas
```

El fallback no puede activar una voz genérica no evaluada y presentarla como ELAN IA. Si no existe una alternativa aprobada, la respuesta debe permanecer en texto o declarar indisponibilidad según el contrato futuro.

## 17. Criterios de aceptación de VOICE-001

VOICE-001 se considera cerrado porque documenta:

- identidad oficial;
- personalidad y restricciones;
- idiomas y acento;
- parámetros funcionales;
- diccionario inicial extensible;
- configuración persistente conceptual;
- proveedores candidatos;
- matriz A/B;
- seguridad y derechos;
- arquitectura desacoplada;
- límites de alcance;
- dependencias y movimiento siguiente.

## 18. Dependencias para STT-001A

`STT-001A` deberá respetar:

- Audio Intake Adapter y Audio Intake Service existentes;
- resultado normalizado de `AUD-001A`;
- separación Adapter → Service → Business;
- tratamiento seguro y temporal del audio;
- proveedor sustituible;
- no mezclar STT con TTS ni identidad vocal.

VOICE-001 define identidad de salida. STT-001A resolverá reconocimiento de entrada como movimiento independiente.

## 19. Prohibiciones de cambio

Después de este cierre:

- no redefinir la personalidad dentro de un Adapter;
- no guardar la voz oficial únicamente en variables dispersas;
- no acoplar Business a un proveedor;
- no agregar pronunciaciones mediante condicionales del motor;
- no implementar STT y TTS en el mismo movimiento;
- no modificar este contrato silenciosamente.

Cualquier cambio material requiere un movimiento documental versionado, evaluación de impacto y actualización del índice maestro.

## 20. Historial

| Versión | Fecha | Cambio | Estado |
|---|---|---|---|
| 0.1 | 12 de julio de 2026 | Registro resumido inicial | Sustituido por 1.0.0 |
| 1.0.0 | 12 de julio de 2026 | Especificación completa, arquitectura, diccionario, pruebas y cierre | APROBADO / CERRADO |

## 21. Cierre oficial

```text
KB-001A       CERRADO
AUD-001A      CERRADO
VOICE-001     CERRADO
STT-001A      SIGUIENTE MOVIMIENTO
```

VOICE-001 queda como contrato oficial de identidad de voz de ELAN IA. No se implementó síntesis, transcripción ni almacenamiento multimedia en este movimiento.