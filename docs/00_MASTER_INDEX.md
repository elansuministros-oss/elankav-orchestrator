# 00 — Índice maestro ELANKAV

## Objetivo

Establecer una fuente documental única, auditable y separada del código funcional.

## Índice

| Documento | Propósito | Estado |
|---|---|---|
| `README.md` | Entrada oficial del repositorio | VERIFICADO |
| `01_AUDITORIA_MAESTRA.md` | Inventario, evidencia y calidad documental | VERIFICADO |
| `02_ARQUITECTURA_Y_ACCESOS.md` | Componentes, rutas y límites de acceso | VERIFICADO/PENDIENTE |
| `03_CRM_CONTACTOS.md` | Contrato CRM-042 y causa técnica del incidente | VERIFICADO |
| `04_RIESGOS_Y_QA.md` | Riesgos, pruebas, seguridad y operación | VERIFICADO/PROPUESTA |
| `05_ROADMAP_PROPUESTO.md` | Orden recomendado para continuar | PROPUESTA |
| `06_LINEA_BASE_ECOSISTEMA.md` | Estado consolidado para evitar repetir la auditoría maestra | VERIFICADO/PENDIENTE |

## Documento obligatorio de inicio

Todo operador, chat o auditoría nueva debe comenzar por:

```text
docs/06_LINEA_BASE_ECOSISTEMA.md
```

Ese documento registra el inventario conocido, arquitectura, funciones, contratos, riesgos, límites y pendientes. Las auditorías futuras deben ser diferenciales respecto a esa línea base.

## Jerarquía documental

```text
Reglas maestras
  ↓
Línea base del ecosistema
  ↓
Arquitectura
  ↓
Contratos API y datos
  ↓
Operación y QA
  ↓
Estado de proyectos
  ↓
Roadmap propuesto
```

## Fuentes de evidencia utilizadas

1. Metadatos de los repositorios GitHub accesibles.
2. Rama principal y commits actuales.
3. Pull requests y descripciones de alcance.
4. Código versionado del Orchestrator y CORE.
5. Migraciones SQL versionadas.
6. README y package.json existentes.
7. Contexto conversacional, solo como fuente DECLARADA.

## Fuentes todavía no verificadas directamente

- Estado vivo del servicio systemd.
- Contenedores Docker en ejecución.
- Datos reales de Supabase.
- Variables de entorno del VPS.
- Sesión viva de WAHA.
- Configuración DNS, TLS y proxy.
- Commit exacto desplegado en cada servicio.

## Norma de actualización

Cada cambio documental futuro debe indicar:

- fecha;
- fuente de evidencia;
- commit o migración relacionados;
- clasificación VERIFICADO, DECLARADO, PENDIENTE o PROPUESTA;
- impacto en otros documentos.

La línea base debe actualizarse cuando:

- se confirma o descarta una hipótesis;
- cambia un contrato API;
- se agrega una migración;
- cambia una rama operativa;
- se certifica un dato vivo de producción;
- se incorpora un nuevo repositorio o servicio.

## Criterio de cierre documental

Un bloque se considera documentado cuando contiene:

1. objetivo;
2. dependencias;
3. flujo;
4. contrato de entrada y salida;
5. errores conocidos;
6. pruebas disponibles;
7. riesgos;
8. estado de producción;
9. rollback o límite de cambio;
10. evidencia trazable.

## Regla contra repetición

No debe repetirse la auditoría maestra completa si el alcance ya está cubierto por la línea base y no existen cambios posteriores. Se debe comparar el estado actual contra el último commit documentado y auditar solo las diferencias.