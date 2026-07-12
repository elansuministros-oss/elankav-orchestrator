# ELANKAV Orchestrator — Knowledge Kernel

Este directorio contiene la **Base Oficial de Conocimiento operativa** del Orchestrator. No es una colección independiente de Markdown ni una documentación paralela.

## Reglas

1. Producción tiene prioridad.
2. No modificar la rama operativa directamente sin el flujo Git aprobado.
3. Todo cambio debe ejecutarse en una rama temporal.
4. Auditar antes de modificar.
5. Un movimiento debe tener un solo objetivo.
6. Validar build, QA y Git antes de cerrar.
7. Supabase es la fuente oficial de datos; Orchestrator es la fuente oficial del contexto operativo.
8. La UI no debe conectarse directamente a la base de datos si existe un Adapter o Service.
9. Ninguna operación destructiva se ejecuta sin autorización y aprobación.
10. Los secretos nunca se almacenan en Git.
11. Nunca crear documentación duplicada.
12. Un tema corresponde a un único documento maestro.
13. Todo cambio debe actualizar documentación, índice, estado del módulo y relaciones.
14. La memoria conversacional no sustituye consultas vivas al Orchestrator.
15. Todo servicio externo debe registrarse como Servicio Autorizado.

## Sincronización obligatoria

La Base Oficial de Conocimiento debe permanecer sincronizada con:

- código;
- pruebas;
- arquitectura;
- IAM;
- Servicios Autorizados;
- línea base;
- roadmap;
- Orchestrator desplegado.

## Movimientos operativos documentados

- `docs/07_PROG_001A_PROGRAMACION_REMOTA.md`: router Owner para crear Jobs de código desde WhatsApp o canales autorizados, reutilizando Codex, ramas temporales, QA y Pull Requests sin merge ni despliegue automático.

## KB-001 — Knowledge Engine

El Knowledge Engine administra la lectura segura de la Base Oficial de Conocimiento y el control de impacto documental de cada movimiento.

### Fuentes autorizadas

Solo se consideran oficiales los documentos Markdown ubicados dentro de:

- `docs/`;
- `knowledge/`.

No se permite resolver rutas fuera de esas raíces, seguir rutas con traversal ni leer archivos no Markdown mediante este servicio.

### Control obligatorio por movimiento

Cada Job o cambio validado debe registrar:

- identificador del Job o movimiento;
- plataforma o módulo afectado;
- commit o PR relacionado;
- documentos maestros afectados;
- estado documental: `NO_REQUIERE_CAMBIO`, `PENDIENTE` o `ACTUALIZADO`;
- fecha de detección y cierre.

KB-001A habilita lectura y detección/registro de impacto. No modifica documentos maestros automáticamente. La escritura controlada corresponde a un movimiento posterior y requiere aprobación Owner, validación y commit documental.

### Orden permanente de ejecución

Todo movimiento debe seguir este orden:

1. documentar el alcance en el documento maestro existente;
2. guardar en GitHub;
3. ejecutar el cambio técnico;
4. validar pruebas, funcionamiento y Git;
5. cerrar guardando código, documentación, estado e impacto documental.
