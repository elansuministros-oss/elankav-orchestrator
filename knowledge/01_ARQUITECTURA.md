# Arquitectura

## Núcleo actual

- VPS Ubuntu;
- Node.js;
- systemd;
- Docker;
- GitHub;
- WAHA;
- OpenAI Responses API;
- Dashboard ejecutivo;
- Health;
- ELANKAV Orchestrator como Centro de Control.

## Responsabilidad del Orchestrator

El Orchestrator coordina descubrimiento, contexto operativo, GitHub, Docker, WAHA, Dashboard, Health, documentación, IAM, auditoría y acceso futuro a VS Code Web.

## Flujo operativo

```text
Usuario / ELAN IA / UI
→ Identity Resolver
→ IAM / Authorization Service
→ ELANKAV Orchestrator
→ Servicios Autorizados
→ Adapters
→ Recursos externos
→ Auditoría
```

## VS Code Web — planificado

```text
Usuario autorizado
→ VS Code Web
→ Workspace VPS autorizado
→ ELANKAV Orchestrator
→ Servicios Autorizados
```

VS Code Web nunca accederá directamente a GitHub, Docker, Supabase, WAHA ni Producción. VSC-001 deberá limitarse a servicio aislado, autenticación, workspace permitido, health y auditoría.

## Flujo de desarrollo autorizado

```text
Usuario autorizado
→ Orchestrator
→ Job
→ Rama temporal
→ Build y QA
→ Pull Request
→ Aprobación
→ Producción
```

La identidad determina permisos; el canal de entrada no concede privilegios.
