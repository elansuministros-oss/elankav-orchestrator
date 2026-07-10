# ELANKAV — PROTOCOLO OBLIGATORIO DE OPERADORES

## OBJETIVO

Garantizar cambios pequeños, validados y documentados en todo el ecosistema ELANKAV.

## PRINCIPIOS

1. Producción tiene prioridad.
2. No romper funcionalidades existentes.
3. Un movimiento = un objetivo.
4. Un operador = una responsabilidad.
5. Auditar antes de modificar.
6. No ejecutar cambios masivos.
7. Todo cambio debe ser reversible.
8. Supabase es la fuente oficial de datos compartidos.
9. No usar localStorage como almacenamiento principal.
10. La UI no se conecta directamente a la base de datos cuando exista Adapter o Servicio.

## ARQUITECTURA OBLIGATORIA

EMC
Adapters
Servicios
Módulos
UI
PDF
Producción

## LECTURA OBLIGATORIA

Antes de trabajar, leer:

1. 00_MASTER_INDEX.md
2. 02_CURRENT_STATE.md
3. Archivo del módulo asignado
4. Últimas entradas de 08_CHANGELOG_MASTER.md
5. 07_DECISIONS_LOG.md cuando corresponda

## AUDITORÍA TOTAL

Solo se realiza:

- al crear la línea base;
- después de una crisis grave;
- antes de una versión mayor;
- cuando la documentación sea insuficiente o contradictoria.

## AUDITORÍA DELTA

Para trabajos normales revisar únicamente:

- cambios desde el último estado;
- archivos relacionados;
- dependencias directas;
- errores nuevos;
- diferencias entre documentación y código.

## FLUJO DE TRABAJO

1. Identificar proyecto y módulo.
2. Confirmar estado documentado.
3. Identificar dependencias.
4. Evaluar impacto.
5. Proponer un movimiento pequeño.
6. Ejecutar solo el objetivo autorizado.
7. Ejecutar Build.
8. Revisar errores.
9. Ejecutar QA funcional.
10. Revisar Git diff.
11. Crear commit solo si el movimiento está completo.
12. Actualizar la Memoria Maestra.
13. Entregar informe final.

## VALIDACIONES MÍNIMAS

npm run build
git diff --check
git status --short

No declarar un movimiento completado si Build o QA fallan.

## PROHIBICIONES

- No modificar módulos ajenos al objetivo.
- No eliminar módulos aprobados sin autorización.
- No cambiar autenticación en tareas no relacionadas.
- No modificar secretos.
- No escribir claves en código o documentación.
- No hacer deploy automático sin autorización.
- No actualizar dependencias sin autorización.
- No mezclar problemas distintos.
- No asumir información no comprobada.
- No declarar éxito sin evidencia.

## INFORME FINAL OBLIGATORIO

MOVIMIENTO:
Proyecto:
Módulo:
Objetivo:
Archivos modificados:
Archivos nuevos:
Archivos eliminados:
Tablas afectadas:
Funciones creadas:
Funciones modificadas:
Funciones eliminadas:
Dependencias:
Build:
QA:
Git diff:
Commit:
Deploy:
Riesgos:
Pendientes:
Documentación actualizada:
Estado final:

## CIERRE

El movimiento queda cerrado únicamente cuando:

- el objetivo fue cumplido;
- Build fue validado;
- QA fue ejecutado;
- la documentación fue actualizada;
- el informe final está completo.
