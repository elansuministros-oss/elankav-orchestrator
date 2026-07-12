# Reglas maestras

## Prioridad

La estabilidad de producción tiene prioridad sobre velocidad o nuevas funciones.

## Flujo obligatorio

```text
EMC / Config
→ Adapters
→ Services
→ Modules
→ API
→ UI
→ PDF
→ Production
```

La interfaz nunca debe acceder directamente a infraestructura o base de datos cuando exista Adapter o Service.

## Desarrollo

- Auditar dependencias.
- Evaluar impacto.
- Proponer un movimiento pequeño.
- Implementar.
- Validar.
- Commit únicamente al completar el movimiento.

## Git

- La rama operativa representa el estado integrable.
- Desarrollo activo en ramas separadas.
- No usar `push --force`.
- No hacer merge sin validación.

## Documentación

- Nunca crear documentación duplicada.
- Siempre evolucionar el documento existente.
- Un tema corresponde a un documento maestro.
- Todo cambio debe sincronizar documentación, índice, módulo, relaciones, código y pruebas.
- Las funciones planificadas deben marcarse como PLANIFICADAS.
- Las funciones implementadas requieren evidencia trazable.

## Contexto operativo

El Orchestrator es la fuente oficial del estado operativo. Ningún agente debe asumir estados de GitHub, Docker, WAHA, Dashboard, Health, repositorios, servicios o contenedores usando únicamente memoria conversacional.

## Autorización

La identidad determina permisos, no el canal. Todos los Servicios Autorizados deben validar IAM, denegar por defecto y registrar auditoría.
