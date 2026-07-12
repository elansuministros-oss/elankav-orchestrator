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
