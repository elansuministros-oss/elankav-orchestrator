# Roadmap

## Estado actual

- GitHub integrado;
- Docker integrado;
- WAHA integrado;
- Dashboard integrado;
- Health integrado;
- Owner Mode activo para `50588388940`;
- IAM inicial;
- Service Registry protegido en lectura;
- VS Code Web operativo y protegido por Orchestrator;
- acceso SSH persistente desde VS Code Web;
- Knowledge Base en evolución.

## IAM

- catálogo versionado de roles y permisos;
- Authorization Service;
- denegación por defecto;
- auditoría central;
- pruebas positivas y negativas por rol.

## Knowledge Base

- documento maestro único por tema;
- índice sincronizado;
- relaciones entre módulos;
- trazabilidad a código, pruebas y commits;
- consulta mediante Servicio Autorizado de Documentación;
- registro de impacto documental por Job o movimiento;
- estado documental obligatorio: `NO_REQUIERE_CAMBIO`, `PENDIENTE` o `ACTUALIZADO`.

## KB-001A — Lectura e impacto documental — COMPLETADO

Estado validado: PR #16 fusionado en `orchestrator-next` mediante merge commit `794f691`; suite completa 36/36 y escritura documental automática deshabilitada.

- listar documentos Markdown oficiales dentro de `docs/` y `knowledge/`;
- leer documentos autorizados sin permitir traversal;
- no leer archivos fuera de las raíces oficiales;
- registrar documentos afectados por Job o movimiento;
- consultar pendientes documentales;
- no editar documentos automáticamente.

## KB-001B — API protegida

- exponer lectura del Knowledge Engine mediante Orchestrator;
- aplicar IAM y Owner Mode;
- permitir consulta por ELAN IA y Jobs autorizados;
- auditar actor, documento, acción y resultado.

## KB-002 — Escritura controlada

- actualizar únicamente documentos maestros existentes;
- impedir duplicación documental;
- exigir aprobación Owner;
- validar contenido y relaciones;
- generar commit documental;
- cerrar el impacto como `ACTUALIZADO`.

## KB-003 — Auditoría de integridad

- detectar código o módulos sin documentación sincronizada;
- calcular integridad documental;
- identificar roadmap, arquitectura y línea base pendientes;
- bloquear cierre cuando exista impacto obligatorio no registrado.

## MM-001 — ELAN IA Multimodal

Objetivo: permitir que ELAN IA reciba, comprenda y genere medios sin crear un segundo cerebro conversacional ni conectar canales directamente con proveedores externos.

### Orden obligatorio

Cada fase debe ejecutarse como movimiento independiente:

1. actualizar documentación existente;
2. guardar la documentación en GitHub;
3. auditar dependencias y contratos actuales;
4. ejecutar un cambio técnico pequeño;
5. agregar pruebas positivas, negativas y de límites;
6. ejecutar suite completa;
7. validar seguridad, costos, auditoría y regresión;
8. commit y push;
9. Pull Request y merge;
10. actualizar Línea Base y cerrar el movimiento.

### Fase 0 — Contratos y seguridad

#### MM-001A — Ruta multimodal — DOCUMENTADO

- arquitectura única para texto, audio, imagen, video y voz;
- límites de tipo MIME, tamaño, duración y origen;
- política de retención temporal y eliminación;
- trazabilidad entre archivo, transcripción, respuesta y Job;
- separación Adapter → Service → Business Engine;
- prohibición de medidas de fabricación basadas únicamente en estimaciones visuales.

#### MED-001A — Contrato de medios

- definir evento normalizado de medios;
- identificar plataforma, canal, remitente, mensaje y archivo;
- registrar MIME, tamaño, duración, checksum y estado;
- impedir rutas, URLs o descargas no autorizadas;
- no persistir secretos ni contenido binario en logs.

### Fase 1 — Escuchar notas de voz

#### AUD-001A — Ingreso seguro de audio — COMPLETADO

Estado validado: PR #8 fusionado en `main` mediante merge commit `e5c7404`; commit documental `4169605`; commit técnico `dd5a54a`; suite completa `25/25 PASS`; build correcto y preview de Vercel en estado Ready.

Capacidad entregada:

- detección y validación segura de notas de voz;
- Adapter y Service desacoplados;
- integración mínima en el webhook;
- regresión del flujo textual cubierta por pruebas;
- sin descarga, transcripción, OpenAI ni respuesta de voz.

Próximo movimiento autorizado: `STT-001A — Transcripción`.

- detectar mensajes de audio de WAHA;
- descargar mediante Adapter autorizado;
- validar MIME, tamaño y duración;
- almacenar temporalmente fuera del repositorio;
- registrar auditoría sin transcribir todavía;
- rechazar contenido inválido sin romper el canal de texto.

#### STT-001A — Transcripción

- enviar únicamente audio validado al Speech-to-Text Service;
- conservar idioma detectado, confianza y duración;
- normalizar la transcripción como entrada del Channel Engine;
- evitar doble procesamiento del mismo mensaje;
- degradar a respuesta textual de error cuando la transcripción falle.

#### STT-001B — Integración con Business Engine

- procesar la transcripción con las mismas reglas comerciales del texto;
- preservar referencia al audio original;
- aplicar Owner Mode según identidad, no según el medio;
- validar que audio y texto produzcan decisiones comerciales equivalentes.

### Fase 2 — Tener voz

#### TTS-001A — Generación de respuesta de voz

- generar audio únicamente desde texto aprobado por Business Engine;
- configurar voz, idioma, velocidad y formato;
- limitar longitud y costo por respuesta;
- conservar siempre versión textual;
- permitir activar o desactivar voz por canal y usuario.

#### TTS-001B — Respuesta de audio por WAHA

- enviar el archivo generado mediante Channel Adapter;
- confirmar entrega o degradar a texto;
- evitar respuestas de voz duplicadas;
- registrar costo, duración y estado de entrega.

### Fase 3 — Ver imágenes

#### VIS-001A — Ingreso seguro de imágenes

- detectar y descargar imágenes;
- validar formato, dimensiones y tamaño;
- eliminar metadatos innecesarios cuando corresponda;
- bloquear archivos corruptos o no autorizados.

#### VIS-001B — Análisis técnico asistido

- describir fachada, vehículo, local, rótulo o logotipo;
- identificar obstáculos y riesgos visibles;
- generar recomendaciones preliminares;
- marcar toda medida visual como estimada;
- exigir medidas confirmadas para fabricar o cerrar precio definitivo.

### Fase 4 — Ver videos

#### VID-001A — Ingreso y muestreo

- validar formato, tamaño y duración;
- extraer cuadros mediante Adapter controlado;
- limitar cantidad y resolución de cuadros;
- no enviar video completo cuando el muestreo sea suficiente.

#### VID-001B — Análisis de recorrido

- consolidar hallazgos entre cuadros;
- detectar fachada, accesos, obstáculos y superficies;
- producir informe preliminar, no plano de fabricación;
- relacionar hallazgos con fotografías o medidas enviadas.

### Fase 5 — Conversación de voz en tiempo real

#### RTC-001A — Sesión de voz autorizada

- consentimiento explícito;
- sesión temporal con expiración;
- micrófono y audio limitados a la sesión;
- IAM y Owner Mode reutilizados;
- auditoría de inicio, cierre y errores.

#### RTC-001B — Realtime Voice

- escuchar, razonar y responder por voz;
- interrupciones controladas;
- transferencia a texto o humano;
- límites de costo y duración;
- prohibición de acciones críticas sin confirmación explícita.

### Criterios de aceptación globales

- ninguna fase rompe mensajes de texto existentes;
- ningún canal accede directamente a OpenAI;
- todos los medios pasan por Adapter y Service;
- no se almacenan archivos en Git ni `localStorage`;
- no se exponen claves, URLs firmadas ni contenido binario en logs;
- toda acción queda asociada a identidad, canal y mensaje;
- existe degradación segura cuando un proveedor externo falla;
- cada fase incluye pruebas de archivos válidos, inválidos, grandes, duplicados y no autorizados;
- producción solo cambia después de PR, merge, Línea Base y cierre.

### Primer movimiento técnico autorizado

`AUD-001A — Ingreso seguro de notas de voz de WhatsApp`.

No incluye todavía transcripción ni respuesta de voz. Su único objetivo es recibir, validar, almacenar temporalmente y auditar el audio sin afectar el flujo de texto.

## Servicios Autorizados

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación;
- VS Code Web.

## VSC-001

- auditar VPS, proxy, recursos y puertos;
- integrar VS Code Web como servicio aislado;
- autenticar mediante IAM/Owner Mode;
- limitar workspaces;
- registrar health en Orchestrator;
- bloquear acceso directo a GitHub, Docker, Supabase, WAHA y Producción;
- validar acceso autorizado, denegado y rollback.

## VSC-002

- permisos granulares por workspace;
- sesiones, expiración y revocación;
- auditoría detallada;
- pruebas de escalamiento de privilegios.

## VSC-003

- GitHub mediante Orchestrator;
- build y QA mediante Jobs;
- ramas temporales;
- Pull Request;
- aprobación;
- operaciones de producción separadas y autorizadas.

## Regla de avance

No continuar al siguiente movimiento sin documentación previa, guardado en GitHub, build, revisión de errores, validación funcional y cierre documental del movimiento concluido.
