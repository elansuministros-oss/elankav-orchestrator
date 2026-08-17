# ELANKAV Orchestrator

Centro de control operativo del ecosistema ELANKAV.

> Estado documental: Base Oficial de Conocimiento actualizada el 21 de julio de 2026. La auditoría maestra original fue consolidada el 12 de julio de 2026 sobre la rama `orchestrator-next`.

## Inicio obligatorio

Antes de auditar, corregir o proponer cambios, leer:

1. [Índice maestro](docs/00_MASTER_INDEX.md)
2. [Línea base oficial del ecosistema](docs/06_LINEA_BASE_ECOSISTEMA.md)
3. [CRM, identidad, roles, relaciones y contactos](docs/03_CRM_CONTACTOS.md) cuando el trabajo involucre clientes, proveedores, plataformas o contactos

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
4. [CRM, identidad, roles, relaciones y contactos](docs/03_CRM_CONTACTOS.md)
5. [Riesgos, deuda y controles](docs/04_RIESGOS_Y_QA.md)
6. [Propuesta de avance sin implementación](docs/05_ROADMAP_PROPUESTO.md)
7. [Línea base oficial del ecosistema](docs/06_LINEA_BASE_ECOSISTEMA.md)
8. [IAM, roles y permisos](docs/07_IAM_ROLES_Y_PERMISOS.md)

## Hallazgo CRM vigente

El modelo del CORE ya soporta:

```text
crm_identities
crm_roles
crm_client_relationships
crm_contacts
```

La pertenencia o relación de una identidad con una plataforma debe obtenerse desde `crm_client_relationships`, no reconstruirse únicamente desde `crm_conversations`.

Movimiento propuesto y todavía no implementado:

```text
CRM-101A
```

Consiste en ampliar el contrato de lectura del CRM para devolver `identity`, `roles` y `relationships`. No requiere tablas nuevas ni migraciones en su primer alcance.

## Repositorios accesibles auditados

- `elansuministros-oss/elankav-orchestrator`
- `elansuministros-oss/elankav-core`
- `elansuministros-oss/elan-ai`
- `elansuministros-oss/elanvisual-platform`
- `elansuministros-oss/elanhome-platform`
- `elansuministros-oss/elanpet-platform`
- `elansuministros-oss/elankav-platform`
- `elansuministros-oss/elankav-os` (privado; documentación raíz no localizada en la auditoría original)

## Restricciones documentales y operativas

- No se modifica código funcional dentro de movimientos exclusivamente documentales.
- No se modifican endpoints, servicios, adapters ni migraciones sin movimiento técnico independiente.
- No se ejecutan cambios sobre Supabase, Docker, VPS o WAHA durante una consolidación documental.
- La documentación no convierte una declaración en hecho verificado.
- Las propuestas de mejora permanecen separadas de la arquitectura actual.
- No se hace merge ni despliegue sin validación y autorización.

## Regla contra auditorías repetidas

No repetir una auditoría cuando:

- el repositorio y commit ya están incluidos en la línea base;
- no existen cambios posteriores relevantes;
- el pendiente ya está identificado y requiere una fuente viva específica;
- el contrato y la causa ya están documentados.

Realizar auditoría diferencial cuando cambien commits, contratos, migraciones, infraestructura o fuentes de evidencia.

## Estado general

El ecosistema dispone de componentes operativos y trazabilidad Git útil. La Base Oficial de Conocimiento concentra los hallazgos que antes estaban dispersos entre código, commits, PR y conversaciones. Todo operador o chat nuevo debe comenzar por los documentos oficiales y no por reconstrucciones de memoria conversacional.
