# ELANKAV Orchestrator

Centro de control operativo del ecosistema ELANKAV.

> Estado documental: auditoría maestra consolidada el 12 de julio de 2026 sobre la rama `orchestrator-next`, commit base `c9f9dc4`.

## Inicio obligatorio

Antes de auditar, corregir o proponer cambios, leer:

1. [Índice maestro](docs/00_MASTER_INDEX.md)
2. [Línea base oficial del ecosistema](docs/06_LINEA_BASE_ECOSISTEMA.md)

La línea base evita reconstruir el ecosistema desde conversaciones anteriores. Las auditorías futuras deben comparar cambios posteriores al commit documentado y trabajar únicamente sobre diferencias.

## Regla de evidencia

Toda afirmación documental se clasifica como:

- **VERIFICADO:** confirmado en código, Git, migración o contrato versionado.
- **DECLARADO:** registrado en PR, commit o configuración, pero sin validación directa del entorno vivo.
- **PENDIENTE:** requiere acceso o comprobación adicional.
- **PROPUESTA:** recomendación sin implementación.

## Arquitectura base

```text
WhatsApp
  ↓
WAHA
  ↓
ELANKAV Orchestrator
  ↓
Adapters / Services
  ↓
ELANKAV CORE APIs
  ↓
Supabase
```

El Orchestrator no debe conectarse directamente a Supabase cuando existe una API o servicio del CORE.

## Documentación oficial

1. [Índice maestro](docs/00_MASTER_INDEX.md)
2. [Auditoría de evidencia y calidad](docs/01_AUDITORIA_MAESTRA.md)
3. [Arquitectura y mapa de accesos](docs/02_ARQUITECTURA_Y_ACCESOS.md)
4. [Contrato CRM y contactos](docs/03_CRM_CONTACTOS.md)
5. [Riesgos, deuda y controles](docs/04_RIESGOS_Y_QA.md)
6. [Propuesta de avance sin implementación](docs/05_ROADMAP_PROPUESTO.md)
7. [Línea base oficial del ecosistema](docs/06_LINEA_BASE_ECOSISTEMA.md)

## Repositorios accesibles auditados

- `elansuministros-oss/elankav-orchestrator`
- `elansuministros-oss/elankav-core`
- `elansuministros-oss/elan-ai`
- `elansuministros-oss/elanvisual-platform`
- `elansuministros-oss/elanpet-platform`
- `elansuministros-oss/elankav-platform`
- `elansuministros-oss/elankav-os` (privado; documentación raíz no localizada)

## Restricciones de esta auditoría

- No se modifica código funcional.
- No se modifican endpoints, servicios, adapters ni migraciones.
- No se ejecutan cambios sobre Supabase, Docker, VPS o WAHA.
- La documentación no convierte una declaración en hecho verificado.
- Las propuestas de mejora permanecen separadas de la arquitectura actual.

## Regla contra auditorías repetidas

No repetir la auditoría maestra cuando:

- el repositorio y commit ya están incluidos en la línea base;
- no existen cambios posteriores;
- el pendiente ya está identificado y requiere una fuente viva específica.

Realizar auditoría diferencial cuando cambien commits, contratos, migraciones, infraestructura o fuentes de evidencia.

## Estado general

El ecosistema dispone de componentes operativos y trazabilidad Git útil, pero la documentación previa estaba dispersa entre código, commits, PR y conversaciones. Esta rama consolida una fuente documental inicial sin alterar producción.