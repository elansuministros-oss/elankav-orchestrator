# ELANKAV Orchestrator — Knowledge Kernel

Este directorio contiene la fuente documental operativa del Orchestrator.

Reglas:

1. Producción tiene prioridad.
2. No modificar `main` directamente.
3. Todo cambio debe ejecutarse en una rama temporal.
4. Auditar antes de modificar.
5. Un movimiento debe tener un solo objetivo.
6. Validar build, QA y Git antes de cerrar.
7. Supabase es la fuente oficial de datos.
8. La UI no debe conectarse directamente a la base de datos si existe un Adapter o Service.
9. Ninguna operación destructiva se ejecuta sin aprobación.
10. Los secretos nunca se almacenan en Git.
