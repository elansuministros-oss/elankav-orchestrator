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
| `05_ROADMAP_PROPUESTO.md` | Orden recomendado, VSC-001, IAM y Knowledge Base | ACTUALIZADO |
| `06_LINEA_BASE_ECOSISTEMA.md` | Estado consolidado para evitar repetir auditorías | VERIFICADO/EVOLUCIÓN |
| `07_IAM_ROLES_Y_PERMISOS.md` | Identidad, roles, permisos, Owner Mode y delegación | DOCUMENTADO/IAM INICIAL |

## Documento obligatorio de inicio

Todo operador, chat o auditoría nueva debe comenzar por:

```text
docs/06_LINEA_BASE_ECOSISTEMA.md
```

Para usuarios, permisos, Owner Mode o delegación debe leerse también:

```text
docs/07_IAM_ROLES_Y_PERMISOS.md
```

Para infraestructura, contexto operativo, Servicios Autorizados o VS Code Web debe leerse:

```text
docs/02_ARQUITECTURA_Y_ACCESOS.md
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

## Criterio de cierre documental

Un bloque se considera documentado cuando registra objetivo, dependencias, flujo, contratos, errores, pruebas, riesgos, estado de producción, rollback o límite de cambio y evidencia trazable.
