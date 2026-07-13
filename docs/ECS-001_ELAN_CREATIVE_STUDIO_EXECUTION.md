# ECS-001 — ELAN Creative Studio: auditoría de ejecución y plan maestro

## 1. Estado del documento

| Campo | Valor |
|---|---|
| Movimiento | `ECS-001` |
| Fecha | 13 de julio de 2026 |
| Estado | APROBADO PARA INICIAR `DESIGN-001A` |
| Repositorio documental | `elansuministros-oss/elankav-orchestrator` |
| Plataforma de entrada | ELAN IA |
| Implementación objetivo | Repositorio independiente `elankav-design-engine` |
| Producción | Sin cambios durante esta fase documental |

## 2. Decisión maestra

**ELAN IA siempre es la entrada única del ecosistema.**

Ningún motor de diseño, proveedor de imagen, video, voz, Canva, Codex, Meta, almacenamiento o servicio externo conversa directamente con el cliente.

```text
Cliente / Owner / Operador autorizado
                ↓
             ELAN IA
                ↓
       ELANKAV Orchestrator
                ↓
       Departamento especializado
                ↓
       Resultado estructurado + QA
                ↓
             ELAN IA
                ↓
              Usuario
```

Los departamentos ejecutan. ELAN IA conserva conversación, identidad, permisos, memoria y entrega final.

## 3. Objetivo del sistema

Crear una base creativa profesional capaz de convertir una solicitud en una experiencia completa y fabricable:

1. analizar la necesidad real;
2. estudiar la marca;
3. crear o auditar el logotipo;
4. clasificar el proyecto;
5. evaluar arquitectura y espacio físico;
6. seleccionar solución técnica;
7. diseñar con medidas exactas y escala real;
8. generar render comercial;
9. generar presentación y video narrado;
10. mostrar construcción, armado o instalación cuando aplique;
11. validar identidad, fabricación y calidad;
12. aplicar marca de agua y datos de la plataforma correcta;
13. entregar por ELAN IA;
14. reutilizar el proyecto como material de marketing.

El sistema no se define como generador de imágenes. Se define como **departamento creativo, arquitectónico y audiovisual orquestado por ELAN IA**.

## 4. Alcances creativos clasificados

### 4.1 Marca e identidad

- estudio básico del negocio;
- clasificación de sector y público;
- análisis de competencia cuando exista fuente autorizada;
- creación de logotipo cuando el cliente no tenga uno;
- rediseño o corrección de logo existente;
- paleta cromática;
- tipografía;
- línea gráfica;
- aplicaciones básicas;
- validación de legibilidad para exterior, impresión, corte y volumen.

### 4.2 Rotulación y señalización

- rótulo estilo botón;
- acrílico con separadores;
- caja de luz;
- caja troquelada;
- letras volumétricas 3D;
- letras con luz frontal;
- letras con luz de rebote;
- rótulo doble cara;
- rótulo de cajuela;
- directorios;
- tótems;
- señalización interior y exterior;
- vinil de corte e impresión;
- rotulación vehicular;
- exhibidores y material POP.

### 4.3 Arquitectura comercial

- análisis de fachada existente;
- propuesta ACM;
- revestimiento parcial o completo;
- recepción;
- interiores comerciales;
- circulación y accesos;
- jerarquía visual;
- integración de marca, iluminación, mobiliario y señalización;
- lectura diurna y nocturna;
- evaluación de obstáculos, estructura y montaje;
- espacios instagrammeables;
- experiencia de entrada y puntos fotográficos.

### 4.4 Experiencias instagrammeables

- muro de marca;
- rincón fotográfico;
- espejo de identidad;
- arco o marco arquitectónico;
- frase iluminada;
- escultura de marca;
- fondo texturizado;
- punto selfie;
- producto sobredimensionado;
- iluminación para fotografía y video;
- composición vertical, horizontal y de escala humana.

Toda experiencia debe funcionar físicamente, reforzar la marca y ser fotografiable. No se aprueba decoración que estorbe el uso real del negocio.

### 4.5 Contenido visual y audiovisual

- render comercial;
- render hiperrealista;
- vista diurna;
- vista nocturna;
- antes/después;
- recorrido interior;
- giro o acercamiento del producto;
- secuencia de armado;
- simulación de instalación;
- video explicativo narrado por la voz oficial de ELAN IA;
- reel vertical;
- historia;
- video horizontal;
- ficha técnica visual;
- imágenes de catálogo y campaña.

## 5. Flujo obligatorio por solicitud

### 5.1 Entrada

ELAN IA recibe texto, audio, imagen, video o documento y normaliza la solicitud.

### 5.2 Clasificación

Debe identificar una intención principal:

```text
BRAND_REQUEST
LOGO_REQUEST
SIGNAGE_REQUEST
FACADE_REQUEST
INTERIOR_REQUEST
INSTAGRAMMABLE_REQUEST
VEHICLE_REQUEST
RENDER_REQUEST
VIDEO_REQUEST
CAMPAIGN_ASSET_REQUEST
CUSTOM_DESIGN_REQUEST
```

### 5.3 Auditoría de marca

```text
¿Existe logo?
├── NO → Brand Studio antes del render
└── SÍ → auditar calidad, formato, legibilidad y uso
```

No se debe diseñar una fachada o rótulo definitivo con una identidad inexistente o ilegible sin informar la limitación.

### 5.4 Auditoría física

Antes de diseñar se validan, según el proyecto:

- medidas confirmadas;
- foto o levantamiento;
- interior/exterior;
- material existente;
- estructura disponible;
- ubicación y visibilidad;
- iluminación;
- clima y exposición;
- instalación;
- presupuesto o nivel de solución.

Las medidas inferidas de una foto son estimadas y nunca sustituyen medidas de fabricación.

### 5.5 Selección de solución

El sistema debe decidir técnicamente entre alternativas reales. Ejemplos:

- vinil impreso;
- vinil de corte;
- PVC plano;
- acrílico;
- letras volumétricas;
- caja de luz;
- ACM;
- estructura metálica;
- solución mixta.

No debe recomendar ACM o letras 3D únicamente por apariencia; debe justificar función, costo, estructura, lectura y durabilidad.

### 5.6 Diseño

El diseño se construye desde un perfil técnico versionado, no desde un prompt improvisado.

Cada perfil debe definir:

- categoría;
- dimensiones base;
- rango permitido;
- materiales;
- espesores;
- fijaciones;
- iluminación;
- uso interior/exterior;
- reglas de composición;
- restricciones;
- salidas permitidas;
- QA obligatorio.

### 5.7 Generación

```text
Perfil técnico
+ identidad aprobada
+ medidas
+ contexto físico
+ instrucciones del cliente
+ estándar de plataforma
        ↓
Prompt Builder
        ↓
Image / Render Adapter
        ↓
Resultado temporal
```

### 5.8 QA

Antes de entregar debe comprobarse:

- producto correcto;
- logo correcto;
- texto correcto;
- proporción y medidas preservadas;
- materiales fabricables;
- forma correcta;
- iluminación correcta;
- fijaciones coherentes;
- contexto físico respetado;
- ausencia de elementos inventados;
- identidad de plataforma correcta;
- marca de agua aplicada;
- salida apta para cliente.

### 5.9 Presentación

ELAN IA entrega el resultado, explica la propuesta y registra la versión consumida.

## 6. Política de propuestas

Cada usuario o proyecto incluye **hasta tres propuestas o iteraciones conceptuales**.

Se registra:

- `proposal_1`;
- `proposal_2`;
- `proposal_3`.

Una cuarta propuesta queda bloqueada con respuesta comercial:

> Las tres propuestas incluidas ya fueron utilizadas. Para continuar con una nueva propuesta es necesario autorizar el presupuesto o recibir una autorización administrativa adicional.

### Excepción administrativa

Un administrador autorizado puede conceder una propuesta extra mediante una acción trazable.

Debe registrar:

- proyecto;
- cliente;
- administrador;
- teléfono o identidad administrativa autorizada;
- motivo;
- cantidad adicional;
- fecha;
- auditoría.

La autorización no se deriva de un texto libre de cualquier número. Debe pasar por IAM y Owner/Admin Mode.

## 7. Identidad corporativa por plataforma

Cada proyecto tiene una plataforma propietaria obligatoria:

- ELANVISUAL;
- ELANCENTER;
- ELANHOME;
- ELANPET;
- ELAN IA;
- otra plataforma registrada.

La plataforma determina automáticamente:

- logo oficial;
- marca de agua;
- datos comerciales;
- WhatsApp;
- sitio web;
- paleta;
- tipografía;
- intro y cierre audiovisual;
- firma técnica;
- plantillas de entrega.

Nunca se mezclan marcas.

Los archivos visuales oficiales deben estar en almacenamiento autorizado. GitHub conserva manifiestos, rutas lógicas, reglas y versiones; no distribuye fuentes ni renders finales.

## 8. Video y experiencia audiovisual

### 8.1 Tipos de video

1. presentación de diseño;
2. recorrido arquitectónico;
3. antes/después;
4. movimiento de cámara sobre render;
5. explicación narrada;
6. secuencia de armado;
7. simulación de instalación;
8. fabricación conceptual;
9. reel de campaña;
10. video de catálogo.

### 8.2 Niveles técnicos

#### Nivel V1 — Edición determinista de bajo costo

- imágenes y renders existentes;
- zoom, paneo, cortes, títulos y transiciones;
- voz oficial;
- música licenciada;
- marca de agua;
- FFmpeg o motor equivalente.

Este debe ser el nivel predeterminado porque es económico, reproducible y controlable.

#### Nivel V2 — Animación asistida

- profundidad simulada;
- movimiento de cámara;
- encendido de luz;
- transiciones antes/después;
- composición por capas.

#### Nivel V3 — Video generativo

- transformación del espacio;
- armado o instalación simulada;
- personas o escenas generativas;
- movimiento complejo.

Se usa solo cuando aporta valor y el costo está autorizado.

### 8.3 Narración

Toda narración debe generarse desde un guion aprobado por ELAN IA y usar la voz oficial registrada.

Ejemplo estructural:

```text
Presentación del proyecto
→ problema identificado
→ solución propuesta
→ materiales y medidas
→ recorrido o instalación
→ resultado final
→ datos comerciales de la plataforma
```

## 9. Sistemas que deben integrarse

### 9.1 Obligatorios para el MVP

- **ELAN IA:** entrada única y conversación;
- **ELANKAV Orchestrator:** coordinación, IAM, Jobs, auditoría y entrega;
- **OpenAI:** razonamiento, visión, generación de imágenes y voz, mediante adapters;
- **Supabase:** fuente oficial de solicitudes, versiones, permisos, estados y auditoría;
- **Supabase Storage:** logos, referencias, renders, videos y entregables;
- **FFmpeg:** composición económica de videos, narración, títulos, marca de agua y formatos;
- **GitHub:** código, perfiles técnicos, schemas, pruebas y documentación.

### 9.2 Integraciones evaluables, no obligatorias inicialmente

- Canva API para plantillas o edición colaborativa;
- modelos especializados de imagen;
- modelos especializados de video;
- herramientas 3D o BIM;
- publicación Meta;
- bibliotecas musicales licenciadas;
- servicios de eliminación de fondo o vectorización.

### 9.3 Regla de costos

El sistema selecciona el nivel más económico que cumpla el objetivo:

```text
Plantilla / composición determinista
        ↓ si no basta
Generación de imagen
        ↓ si no basta
Animación asistida
        ↓ si está autorizado
Video generativo
```

Canva no será el núcleo del sistema. Puede ser un adapter opcional. Los perfiles, decisiones, QA y trazabilidad pertenecen a ELANKAV.

No se selecciona proveedor definitivo de video en `ECS-001`. Primero se implementa una interfaz `VideoAdapter` y se comparan costo, calidad, duración, resolución, API, derechos de uso y estabilidad.

## 10. Arquitectura del repositorio objetivo

Repositorio propuesto:

```text
elansuministros-oss/elankav-design-engine
```

Estructura inicial:

```text
elankav-design-engine/
├── adapters/
│   ├── image/
│   ├── video/
│   ├── voice/
│   ├── storage/
│   └── delivery/
├── services/
│   ├── designRequestService.js
│   ├── designPlannerService.js
│   ├── brandAuditService.js
│   ├── architectureAnalysisService.js
│   ├── promptBuilderService.js
│   ├── renderService.js
│   ├── videoCompositionService.js
│   ├── visualQaService.js
│   ├── proposalLimitService.js
│   └── platformBrandingService.js
├── profiles/
│   ├── signage/
│   ├── facades/
│   ├── interiors/
│   ├── instagrammable/
│   ├── vehicles/
│   └── branding/
├── schemas/
├── contracts/
├── tests/
├── docs/
├── config/
└── README.md
```

## 11. Contratos mínimos

### DesignRequest

Debe incluir:

- request ID;
- actor;
- cliente;
- plataforma;
- canal;
- tipo de proyecto;
- medidas y estado de confirmación;
- interior/exterior;
- assets de marca;
- referencias;
- instrucciones;
- propuesta consumida;
- nivel de salida;
- autorización de costo.

### DesignResult

Debe devolver:

- design ID;
- estado;
- perfil usado;
- versión;
- assets generados;
- QA;
- costo registrado;
- advertencias;
- plataforma y branding;
- salida preparada para ELAN IA.

### Regla de comunicación

El motor nunca devuelve lenguaje conversacional directo al cliente. Devuelve datos y un resumen estructurado para que ELAN IA componga la respuesta.

## 12. Datos y almacenamiento

Supabase debe contener, como mínimo futuro:

- `design_requests`;
- `design_versions`;
- `design_assets`;
- `design_qa_results`;
- `design_authorizations`;
- `design_cost_events`;
- `platform_brand_profiles`;
- `design_audit_events`.

No usar `localStorage` como fuente oficial. No persistir base64 pesado en tablas. No guardar secretos ni URLs firmadas en logs.

## 13. Fases de ejecución

### DESIGN-001A — Fundación del repositorio

Objetivo único:

- crear `elankav-design-engine`;
- establecer arquitectura;
- agregar schemas y contratos;
- implementar registro básico de perfiles;
- crear stubs de adapters sin llamadas externas;
- agregar pruebas;
- documentar integración futura;
- sin producción y sin consumo de IA.

### DESIGN-001B — Perfil rótulo estilo botón

- migrar cuatro modelos existentes;
- normalizar medida base 60 × 60 cm;
- materiales, iluminación, fijaciones y restricciones;
- eliminar precios del prompt;
- conectar precio por servicio oficial, no como fuente del Design Engine;
- QA de forma, chapetones, logo, proporción y luz.

### DESIGN-001C — Brand Audit

- detectar ausencia de logo;
- evaluar calidad básica;
- bloquear render final cuando falte identidad indispensable;
- generar flujo de logo previo;
- registrar aprobación de identidad.

### DESIGN-001D — Render Adapter

- integrar generación de imagen mediante adapter;
- almacenar temporalmente;
- registrar costo;
- aplicar límites;
- ejecutar QA;
- sin entrega automática a cliente todavía.

### DESIGN-001E — Branding corporativo

- perfiles ELANVISUAL, ELANCENTER y demás plataformas;
- marca de agua;
- datos comerciales;
- firma y metadatos;
- plantillas de entrega.

### DESIGN-001F — Integración ELAN IA

- detectar `DESIGN_REQUEST`;
- recolectar solo información indispensable;
- crear Job;
- consultar estado;
- entregar resultado mediante ELAN IA;
- cancelación e idempotencia.

### DESIGN-001G — Límites y autorizaciones

- tres propuestas;
- bloqueo de cuarta;
- autorización Admin/Owner;
- auditoría;
- cliente recurrente sujeto a permiso explícito.

### VIDEO-001A — Video determinista

- FFmpeg;
- movimiento sobre render;
- narración;
- títulos;
- música autorizada;
- marca de agua;
- formatos 9:16, 1:1 y 16:9.

### VIDEO-001B — Simulación de instalación

- storyboard por producto;
- composición por escenas;
- antes/después;
- secuencia técnica;
- validación de que sea presentación conceptual y no instrucción de obra exacta.

### VIDEO-001C — Proveedor generativo

- benchmark controlado;
- adapter intercambiable;
- presupuesto máximo;
- autorización por Job;
- fallback a VIDEO-001A.

### ARCH-001A — Arquitectura comercial

- perfiles de fachada e interior;
- análisis espacial;
- materiales;
- iluminación;
- escala;
- limitaciones de foto;
- recomendaciones fabricables.

### SOCIAL-001A — Entregables de marketing

- reel;
- historia;
- publicación;
- ficha de proyecto;
- no publicar todavía.

### META-001A — Publicación autorizada

Solo después de IAM, aprobación, trazabilidad y contenido validado.

## 14. Auditoría previa ya cerrada

Para `DESIGN-001A` no se repetirá una auditoría general del ecosistema.

El nuevo operador debe utilizar como fuentes:

1. este documento;
2. `docs/00_MASTER_INDEX.md`;
3. `docs/06_LINEA_BASE_ECOSISTEMA.md`;
4. la arquitectura vigente del Orchestrator;
5. evidencia GitHub del generador de botones en `elanvisual-platform/api/elan-ai.js`;
6. perfiles y pruebas ECL disponibles en `elankav-core`.

Solo se permite una inspección puntual necesaria para crear el nuevo repositorio y verificar nombres de contratos. No se autoriza volver a discutir el concepto ni reiniciar la auditoría estratégica.

## 15. Criterios de aceptación de DESIGN-001A

- repositorio independiente creado;
- rama principal protegida según capacidades disponibles;
- README funcional;
- arquitectura Adapter → Service → Engine;
- schemas de solicitud, perfil y resultado;
- registro de perfiles vacío pero operativo;
- adapters sin proveedor real;
- pruebas positivas y negativas;
- lint o validación sintáctica;
- ninguna credencial;
- ninguna llamada pagada;
- ninguna modificación a producción;
- PR y merge;
- actualización documental en Orchestrator.

## 16. Prohibiciones

- no conectar UI directamente a Supabase;
- no poner precios como verdad dentro de prompts;
- no dejar que proveedores externos hablen con clientes;
- no mezclar plataformas o logos;
- no generar medidas de fabricación desde una fotografía;
- no entregar sin QA;
- no producir una cuarta propuesta sin autorización;
- no guardar renders en Git;
- no depender de Canva como núcleo;
- no conectar varios proveedores antes de definir adapters;
- no hacer merge, despliegue o publicación automática sin autorización;
- no modificar módulos problemáticos de ELANVISUAL para convertirlos en el núcleo nuevo.

## 17. Rollback

`DESIGN-001A` es independiente y no toca producción. El rollback consiste en cerrar la rama o PR sin fusionar, o archivar el repositorio nuevo si no cumple criterios. Ningún servicio actual debe depender del nuevo motor durante esta fase.

## 18. Siguiente movimiento autorizado

```text
DESIGN-001A — Fundación de elankav-design-engine
```

El operador debe iniciar directamente la ejecución, crear el repositorio y estructura base, validar pruebas y cerrar mediante PR. No debe solicitar otra auditoría conceptual.