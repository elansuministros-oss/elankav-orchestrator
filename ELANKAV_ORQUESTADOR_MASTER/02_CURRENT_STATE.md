# ELANKAV — ESTADO ACTUAL CONFIRMADO

Última actualización: 2026-07-10

## ORCHESTRATOR

Estado: Producción activa

Dominio:
https://orchestrator.elankav.com

Servidor:
VPS Ubuntu

Rama:
main

Versión:
0.3.0

Servicio:
elankav-orchestrator.service

Estado del servicio:
Activo y habilitado con systemd

Puerto interno:
172.19.0.1:4100

Proxy:
Nginx Proxy Manager

SSL:
Let's Encrypt

DNS:
Cloudflare

Acceso móvil:
Validado

## FUNCIONES DISPONIBLES

- Monitor Docker en tiempo real.
- Frontend desacoplado en carpeta public.
- Actualización automática cada 15 segundos.

- Dashboard responsive.
- Vista inicial del ecosistema.
- Endpoint de salud.
- Registro inicial de seis servicios.
- Métricas básicas del proceso y memoria del VPS.

## ENDPOINTS

- /
- /health
- /api/health
- /api/projects
- /api/docker

## SERVICIOS REGISTRADOS

- ELANVISUAL
- ELANKAV CORE
- ELANKAV PLATFORM
- ELANPET
- WAHA
- ORCHESTRATOR

## LIMITACIONES ACTUALES

- Los estados de proyectos todavía son registros iniciales, no verificaciones en vivo.
- No existe autenticación interna.
- No existen acciones remotas de build, deploy o Git.
- No hay conexión directa con GitHub, Vercel, Supabase ni WAHA.
