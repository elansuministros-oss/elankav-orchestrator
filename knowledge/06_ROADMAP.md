# Roadmap

## Estado actual

- GitHub integrado;
- Docker integrado;
- WAHA integrado;
- Dashboard integrado;
- Health integrado;
- Owner Mode activo para `50588388940`;
- IAM inicial;
- Knowledge Base en evolución;
- VS Code Web planificado.

## IAM

- catálogo versionado de roles y permisos;
- Authorization Service;
- denegación por defecto;
- auditoría central;
- pruebas positivas y negativas por rol.

## Knowledge Base

- documento maestro único por tema;
- índice sincronizado;
- relaciones entre módulos;
- trazabilidad a código, pruebas y commits;
- consulta mediante Servicio Autorizado de Documentación.

## Servicios Autorizados

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación.

## VSC-001

- auditar VPS, proxy, recursos y puertos;
- integrar VS Code Web como servicio aislado;
- autenticar mediante IAM/Owner Mode;
- limitar workspaces;
- registrar health en Orchestrator;
- bloquear acceso directo a GitHub, Docker, Supabase, WAHA y Producción;
- validar acceso autorizado, denegado y rollback.

## VSC-002

- permisos granulares por workspace;
- sesiones, expiración y revocación;
- auditoría detallada;
- pruebas de escalamiento de privilegios.

## VSC-003

- GitHub mediante Orchestrator;
- build y QA mediante Jobs;
- ramas temporales;
- Pull Request;
- aprobación;
- operaciones de producción separadas y autorizadas.

## Regla de avance

No continuar al siguiente movimiento sin build, revisión de errores, validación funcional y actualización documental del movimiento concluido.
