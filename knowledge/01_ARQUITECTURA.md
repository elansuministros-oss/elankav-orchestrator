# Arquitectura

## Núcleo actual

- VPS Ubuntu;
- Node.js;
- systemd;
- Docker;
- GitHub;
- WAHA;
- OpenAI Responses API;
- Dashboard ejecutivo;
- Health;
- ELANKAV Orchestrator como Centro de Control.

## Responsabilidad del Orchestrator

El Orchestrator coordina descubrimiento, contexto operativo, GitHub, Docker, WAHA, Dashboard, Health, documentación, IAM, auditoría y acceso futuro a VS Code Web.

## Flujo operativo

```text
Usuario / ELAN IA / UI
→ Identity Resolver
→ IAM / Authorization Service
→ ELANKAV Orchestrator
→ Servicios Autorizados
→ Adapters
→ Recursos externos
→ Auditoría
```

## VS Code Web — planificado

```text
Usuario autorizado
→ VS Code Web
→ Workspace VPS autorizado
→ ELANKAV Orchestrator
→ Servicios Autorizados
```

VS Code Web nunca accederá directamente a GitHub, Docker, Supabase, WAHA ni Producción. VSC-001 deberá limitarse a servicio aislado, autenticación, workspace permitido, health y auditoría.

## Flujo de desarrollo autorizado

```text
Usuario autorizado
→ Orchestrator
→ Job
→ Rama temporal
→ Build y QA
→ Pull Request
→ Aprobación
→ Producción
```

La identidad determina permisos; el canal de entrada no concede privilegios.

## ELAN IA Multimodal — arquitectura objetivo

ELAN IA Multimodal no sustituye el núcleo conversacional ni conecta canales directamente con proveedores externos. Cada capacidad se integra como Adapter y Service desacoplado, reutilizando identidad, autorización, auditoría, Business Engine y servicios oficiales.

```text
WhatsApp / Web / App / llamada autorizada
→ Channel Adapter
→ Media Intake Service
→ validación de tipo, tamaño, origen y permisos
→ servicio multimodal autorizado
→ normalización a evento ELAN IA
→ Business Engine
→ Knowledge / CRM / EMC / AI-23 / ERP
→ respuesta textual o multimedia autorizada
→ auditoría
```

### Módulos previstos

```text
AUD-001  Audio Intake y descarga segura
STT-001  Speech-to-Text
TTS-001  Text-to-Speech
VIS-001  análisis de imágenes
VID-001  análisis de video por muestreo controlado
RTC-001  conversación de voz en tiempo real
```

### Reglas arquitectónicas

- WAHA recibe el mensaje, pero no ejecuta razonamiento ni llama directamente al proveedor de IA;
- los archivos se descargan mediante Adapter, se validan y se procesan con límites explícitos;
- audio, imagen y video deben convertirse en un evento normalizado antes de llegar al Business Engine;
- la transcripción no reemplaza el archivo original en auditoría;
- ninguna medida inferida desde fotografía o video se considera medida de fabricación confirmada;
- toda respuesta de voz debe originarse en una respuesta textual aprobada por el mismo Business Engine;
- la voz no concede permisos adicionales ni altera Owner Mode;
- no se habilita cámara, micrófono o llamada en tiempo real sin consentimiento y control de sesión;
- costos, duración, tamaño y retención de medios deben ser configurables;
- producción permanece aislada hasta que cada módulo complete pruebas, PR, merge y cierre documental.

### Flujo inicial autorizado: notas de voz de WhatsApp

```text
WAHA
→ Audio Adapter
→ validación MIME, tamaño y duración
→ almacenamiento temporal controlado
→ Speech-to-Text Service
→ texto normalizado + metadatos del audio
→ Channel Engine
→ Business Engine
→ respuesta normal de ELAN IA
→ eliminación o retención según política
→ auditoría
```

La primera implementación técnica será `AUD-001A`: recepción y validación segura de notas de voz, sin transcripción todavía. `STT-001A` se implementará únicamente después de validar ese ingreso.

## Estado implementado AUD-001A — 12 de julio de 2026

AUD-001A quedó integrado en `elankav-core` como la primera capacidad técnica de ELAN IA Multimodal.

Flujo implementado:

```text
WAHA
→ api/whatsapp-v2.js
→ Audio Intake Adapter
→ Audio Intake Service
→ resultado normalizado
```

Responsabilidades incorporadas:

- detección de mensajes de audio y notas de voz;
- normalización de metadatos provenientes de WAHA;
- validación de identificador de mensaje y chat;
- validación de tipo MIME;
- validación configurable de tamaño y duración;
- validación de referencia multimedia;
- degradación controlada ante payloads incompletos;
- preservación del flujo textual existente.

AUD-001A no incorpora:

- descarga del archivo;
- almacenamiento binario;
- transcripción;
- llamadas a OpenAI;
- generación de voz;
- respuesta automática ante el audio.

La siguiente capacidad técnica autorizada es `STT-001A`, que deberá reutilizar el Adapter y el Service existentes sin trasladar lógica multimedia al webhook.
