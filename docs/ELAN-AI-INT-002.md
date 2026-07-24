# ELAN-AI-INT-002 — CONNECT Tool Gateway

## Alcance

Este movimiento conecta herramientas comerciales mediante el límite oficial:

```text
ELAN IA Runtime
      ↓
Orchestrator Tool Gateway
      ↓
ELANKAV CONNECT
```

No modifica WAHA, Supabase ni el flujo productivo de `messageService`. Tampoco
activa herramientas desde conversaciones: crea y valida la base controlada que
usará el modo activo en un movimiento posterior.

## Endpoint interno

```text
POST /api/tools/connect
X-ELAN-AI-Token: <secreto compartido>
```

El gateway acepta únicamente operaciones registradas. No recibe URLs ni rutas
arbitrarias.

## Variables

Orchestrator:

```text
ELAN_AI_INTERNAL_TOKEN=<secreto compartido>
ELANKAV_CONNECT_URL=http://127.0.0.1:4300
ELANKAV_CONNECT_INTERNAL_TOKEN=<opcional hasta que CONNECT autentique>
```

ELAN IA:

```text
ORCHESTRATOR_BASE_URL=http://172.19.0.1:4100
ELAN_AI_INTERNAL_TOKEN=<secreto compartido>
```

## Capacidades registradas

- clientes y proveedores: listar y crear;
- leads: listar, consultar y crear;
- oportunidades: listar, consultar, crear y actualizar;
- cotizaciones: listar, consultar, crear, actualizar y cambiar estado;
- órdenes: listar, consultar, crear desde cotización y cambiar estado.

Cada operación exige un permiso específico `connect:<dominio>:read|write`.
`connect:*` queda reservado para actores internos con autorización total.

## Controles

- autenticación interna con comparación segura;
- lista cerrada de métodos y rutas;
- validación UUID antes de construir rutas;
- filtros de consulta permitidos por operación;
- bloqueo completo cuando `mode` no es `active`;
- timeout y errores normalizados;
- CONNECT permanece como dueño de las reglas del dominio.

## Estado de activación

La herramienta queda registrada pero no es invocada automáticamente por
conversaciones. `ELAN_AI_RUNTIME_MODE=shadow` continúa sin ejecutar
herramientas. La activación conversacional requiere:

- resolución explícita de intención a operación;
- política de permisos por identidad;
- confirmación para mutaciones críticas;
- auditoría persistente;
- prueba end-to-end contra un CONNECT controlado;
- plan de rollback.
