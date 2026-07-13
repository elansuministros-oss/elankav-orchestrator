# 00 — Índice maestro ELANKAV

## Objetivo

Establecer una fuente documental única, auditable y separada del código funcional. La documentación oficial forma parte del ecosistema y constituye la **Base Oficial de Conocimiento**.

## Índice

| Documento | Propósito | Estado |
|---|---|---|
| `README.md` | Entrada oficial del repositorio | VERIFICADO |
| `01_AUDITORIA_MAESTRA.md` | Inventario, evidencia y calidad documental | VERIFICADO |
| `02_ARQUITECTURA_Y_ACCESOS.md` | Centro de Control, componentes, Servicios Autorizados, VS Code Web y límites de acceso | ACTUALIZADO |
| `03_CRM_CONTACTOS.md` | Contrato CRM-042 y causa técnica del incidente | VERIFICADO |
| `04_RIESGOS_Y_QA.md` | Riesgos, pruebas, seguridad y operación | VERIFICADO/PROPUESTA |
| `05_ROADMAP_PROPUESTO.md` | Orden recomendado, VSC-001, IAM, Knowledge Base y movimientos de voz | ACTUALIZADO |
| `06_LINEA_BASE_ECOSISTEMA.md` | Estado consolidado para evitar repetir auditorías | VERIFICADO/EVOLUCIÓN |
| `07_IAM_ROLES_Y_PERMISOS.md` | Identidad, roles, permisos, Owner Mode y delegación | DOCUMENTADO/IAM INICIAL |
| `VOICE-001.md` | Identidad oficial, arquitectura, diccionario y selección futura de voz de ELAN IA | APROBADO/CERRADO |
| `ECS-001_ELAN_CREATIVE_STUDIO_EXECUTION.md` | Alcance, arquitectura, sistemas, costos y ejecución de ELAN Creative Studio | APROBADO PARA DESIGN-001A |

## Documento obligatorio de inicio

Todo operador, chat o auditoría nueva debe comenzar por:

```text
docs/06_LINEA_BASE_ECOSISTEMA.md
```

Para conocer la gobernanza documental y localizar documentos vigentes debe leerse también:

```text
docs/00_MASTER_INDEX.md
```

Para usuarios, permisos, Owner Mode o delegación debe leerse también:

```text
docs/07_IAM_ROLES_Y_PERMISOS.md
```

Para infraestructura, contexto operativo, Servicios Autorizados o VS Code Web debe leerse:

```text
docs/02_ARQUITECTURA_Y_ACCESOS.md
```

Para identidad de voz, pronunciación o selección futura de proveedor STT/TTS debe leerse:

```text
docs/VOICE-001.md
```

Para diseño, arquitectura comercial, renders, video, branding corporativo y ELAN IA como entrada única debe leerse:

```text
docs/ECS-001_ELAN_CREATIVE_STUDIO_EXECUTION.md
```

## Jerarquía documental

```text
Reglas maestras
  ↓
Línea base del ecosistema
  ↓
Arquitectura
  ↓
Identidad, roles y permisos
  ↓
Servicios Autorizados
  ↓
Contratos API y datos
  ↓
Operación y QA
  ↓
Estado de proyectos
  ↓
Roadmap
```

## Base Oficial de Conocimiento

La documentación no se administra como archivos Markdown aislados. Es la Base Oficial de Conocimiento del ecosistema.

Todo cambio debe mantener sincronizados:

- documento maestro correspondiente;
- índice maestro;
- estado del módulo;
- relaciones arquitectónicas;
- código y pruebas relacionados;
- línea base y roadmap cuando corresponda.

## Fuentes de evidencia

1. Metadatos y contenido de repositorios GitHub.
2. Ramas, commits y pull requests.
3. Código versionado del Orchestrator y servicios relacionados.
4. Migraciones SQL versionadas.
5. README, contratos y configuración sin secretos.
6. Validaciones vivas ejecutadas mediante el Orchestrator.
7. Contexto conversacional únicamente como fuente declarada, nunca como estado operativo oficial.

## Norma de actualización

Cada cambio documental debe indicar fecha, evidencia, commit o migración, clasificación e impacto.

La línea base debe actualizarse cuando cambie un contrato, servicio, rol, permiso, integración, rama, migración o estado certificado.

## Regla permanente contra duplicación

- Nunca crear documentación duplicada.
- Un tema corresponde a un único documento maestro.
- Siempre evolucionar el documento existente.
- No crear archivos nuevos cuando el tema pueda integrarse en la estructura actual.
- Toda documentación debe permanecer sincronizada con código, pruebas, arquitectura y Orchestrator.
- No debe repetirse una auditoría maestra cuando basta una auditoría diferencial.

## Gobernanza estructural permanente

La estructura documental existente queda reconocida como la gobernanza oficial del repositorio.

Reglas obligatorias:

1. Antes de crear una convención, carpeta, índice, estándar o documento transversal se debe buscar si ya existe un equivalente.
2. Si existe, se actualiza el documento maestro vigente; no se crea una estructura paralela.
3. No se borran, renombran ni mueven documentos oficiales sin auditoría de referencias, evaluación de impacto, rollback y movimiento aprobado.
4. Las carpetas nuevas solo se crean cuando un tema no cabe razonablemente en la estructura vigente y la necesidad queda documentada.
5. La nomenclatura publicada y los identificadores cerrados no se reutilizan.
6. Los nuevos chats deben identificar el estado mediante este índice y la línea base, no mediante memoria conversacional.
7. Una propuesta de reorganización no se considera implementada hasta comprobar que no contradice gobernanza previa.
8. Esta gobernanza no se modifica informalmente. Cualquier cambio material requiere movimiento de arquitectura o documentación, evidencia y actualización trazable.

Esta sección consolida reglas ya presentes en la Base Oficial de Conocimiento; no crea una jerarquía documental paralela.

## Movimientos documentales recientes

| Movimiento | Resultado | Estado |
|---|---|---|
| `KB-001A` | Base Oficial de Conocimiento consolidada | CERRADO |
| `AUD-001A` | Auditoría y Audio Intake documentados y validados | CERRADO |
| `VOICE-001` | Identidad oficial de voz especificada sin implementar STT/TTS | CERRADO |
| `ECS-001` | Auditoría ejecutable de ELAN Creative Studio y fases de diseño/video | CERRADO DOCUMENTALMENTE |
| `DESIGN-001A` | Fundación de `elankav-design-engine` | SIGUIENTE MOVIMIENTO |
| `STT-001A` | Reconocimiento de audio desacoplado | PENDIENTE EN SU LÍNEA |

## Criterio de cierre documental

Un bloque se considera documentado cuando registra objetivo, dependencias, flujo, contratos, errores, pruebas, riesgos, estado de producción, rollback o límite de cambio y evidencia trazable.