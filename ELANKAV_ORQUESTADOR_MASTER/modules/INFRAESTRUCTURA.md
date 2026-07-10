# MÓDULO — INFRAESTRUCTURA

Última actualización: 2026-07-10

## VPS

Sistema:
Ubuntu 26.04 LTS

Node.js:
v22.22.1

## DOCKER ACTIVO

- waha
- nginx-proxy-manager
- portainer

## ORCHESTRATOR

Ruta:
/opt/elankav/orchestrator

Servicio systemd:
elankav-orchestrator.service

Dirección interna:
http://172.19.0.1:4100

Dominio público:
https://orchestrator.elankav.com

Proxy:
Nginx Proxy Manager

DNS:
Cloudflare

SSL:
Let's Encrypt

## ESTADO

- Servicio habilitado al iniciar el VPS.
- Reinicio automático habilitado.
- Acceso desde celular validado.
- WAHA, Portainer y Nginx permanecen operativos.

## PRÓXIMO MOVIMIENTO AUTORIZADO

ORCH-003:
Lectura dinámica y segura del estado de Docker.

No agregar todavía:
- Deploy remoto.
- Escritura en Git.
- Ejecución libre de comandos.
- Secretos.

## ORCH-003 — DOCKER EN TIEMPO REAL

Endpoint:
- /api/docker

Adapter:
- adapters/dockerAdapter.js

Datos expuestos:
- nombre
- estado
- tiempo activo
- CPU
- memoria
- procesos

Datos internos no expuestos:
- container ID
- imagen
- puertos
- network I/O
- block I/O

Estado validado:
- waha: running
- nginx-proxy-manager: running
- portainer: running
