# ELAN-AI-INT-001 — Runtime Integration Foundation

## Alcance

Este movimiento establece el contrato interno entre:

```text
Orchestrator
    ↓
ELAN IA Runtime
```

No sustituye todavía el flujo productivo de `messageService`. No modifica
WAHA, Supabase ni la entrega de respuestas al cliente.

## Contrato

Versión:

```text
ELAN-AI-INT-001
```

Endpoint del runtime:

```text
POST /v1/runtime/messages
```

Autenticación:

```text
X-ELAN-AI-Token
```

Variables del Orchestrator:

```text
ELAN_AI_RUNTIME_MODE=off|shadow
ELAN_AI_RUNTIME_URL=http://127.0.0.1:4200
ELAN_AI_INTERNAL_TOKEN=<secreto compartido>
```

El estado predeterminado es `off`.

## Shadow Mode

En `shadow`:

- el Orchestrator envía mensaje, canal, plataforma e identidad resuelta;
- Owner Mode se conserva como dato explícito del contrato;
- ELAN IA procesa intención, operador y reglas;
- las herramientas quedan deshabilitadas;
- la salida nunca se marca como entregable;
- WAHA continúa recibiendo exclusivamente la respuesta del flujo actual;
- un timeout o error del runtime no interrumpe `messageService`.

## Fallback

Mientras este movimiento no sea activado:

```text
WAHA
  ↓
Orchestrator messageService
  ↓
flujo actual
```

Con `shadow` activado:

```text
                    ┌─→ ELAN IA Runtime (observación)
WAHA → Orchestrator ┤
                    └─→ flujo actual → respuesta WAHA
```

## Activación futura

La transición a `active` requiere un movimiento posterior con:

- comparación de respuestas;
- herramientas CONNECT autorizadas;
- permisos por acción;
- idempotencia;
- auditoría persistente;
- prueba end-to-end controlada;
- rollback documentado.

`ELAN-AI-INT-001` no habilita el modo activo en el Orchestrator.
