# Reglas maestras

## Prioridad

La estabilidad de producción tiene prioridad sobre velocidad o nuevas funciones.

## Flujo obligatorio

Config
→ Adapters
→ Services
→ Modules
→ API
→ UI
→ PDF
→ Production

## Desarrollo

- Auditar dependencias.
- Evaluar impacto.
- Proponer un movimiento pequeño.
- Implementar.
- Validar.
- Commit únicamente al completar el movimiento.

## Git

- `main` representa producción.
- Desarrollo activo en ramas separadas.
- No usar `push --force`.
- No hacer merge sin validación.
