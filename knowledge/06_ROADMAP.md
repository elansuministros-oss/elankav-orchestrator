# Roadmap

## Estado actual

- GitHub integrado;
- Docker integrado;
- WAHA integrado;
- Dashboard integrado;
- Health integrado;
- Owner Mode activo para `50588388940`;
- IAM inicial;
- Service Registry protegido en lectura;
- VS Code Web operativo y protegido por Orchestrator;
- acceso SSH persistente desde VS Code Web;
- Knowledge Base en evolución.

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
- consulta mediante Servicio Autorizado de Documentación;
- registro de impacto documental por Job o movimiento;
- estado documental obligatorio: `NO_REQUIERE_CAMBIO`, `PENDIENTE` o `ACTUALIZADO`.

## KB-001A — Lectura e impacto documental

- listar documentos Markdown oficiales dentro de `docs/` y `knowledge/`;
- leer documentos autorizados sin permitir traversal;
- no leer archivos fuera de las raíces oficiales;
- registrar documentos afectados por Job o movimiento;
- consultar pendientes documentales;
- no editar documentos automáticamente.

## KB-001B — API protegida

- exponer lectura del Knowledge Engine mediante Orchestrator;
- aplicar IAM y Owner Mode;
- permitir consulta por ELAN IA y Jobs autorizados;
- auditar actor, documento, acción y resultado.

## KB-002 — Escritura controlada

- actualizar únicamente documentos maestros existentes;
- impedir duplicación documental;
- exigir aprobación Owner;
- validar contenido y relaciones;
- generar commit documental;
- cerrar el impacto como `ACTUALIZADO`.

## KB-003 — Auditoría de integridad

- detectar código o módulos sin documentación sincronizada;
- calcular integridad documental;
- identificar roadmap, arquitectura y línea base pendientes;
- bloquear cierre cuando exista impacto obligatorio no registrado.

## Servicios Autorizados

- GitHub;
- Docker;
- WAHA;
- Dashboard;
- Health;
- CRM;
- QA;
- Jobs;
- Documentación;
- VS Code Web.

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

No continuar al siguiente movimiento sin documentación previa, guardado en GitHub, build, revisión de errores, validación funcional y cierre documental del movimiento concluido.
