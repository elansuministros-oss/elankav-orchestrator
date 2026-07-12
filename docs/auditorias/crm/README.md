# CRM — Índice documental

Estado del módulo: ACTIVO

Este directorio concentra la documentación oficial del CRM de ELANKAV.

## Regla documental

Antes de crear un documento nuevo:

1. Buscar documentación existente.
2. Actualizar el documento correspondiente cuando exista.
3. Crear un archivo nuevo únicamente cuando represente una fase o decisión distinta.
4. Mantener este índice actualizado.
5. No cerrar una fase sin evidencia funcional y documentación final.

## Arquitectura general

WhatsApp → WAHA → Identity Bridge → Owner Mode → ELAN IA → Services → Adapters → API CRM → Supabase CRM Core

## Documentos

- `../CRM-041-CIERRE.md` — Cierre validado de la integración CRM de solo lectura.
- `CRM-042-PLAN-MAESTRO.md` — Fase abierta para escritura controlada y creación de proveedores y clientes desde WhatsApp.

## Estado de fases

| Fase | Estado | Objetivo |
|---|---|---|
| CRM-041 | COMPLETADO | Consulta segura desde ELAN IA hacia CRM Core. |
| CRM-042 | EN DESARROLLO | Crear proveedores globales y clientes por plataforma desde WhatsApp. |

## Fuente oficial

Supabase es la fuente oficial de datos. Ninguna interfaz, modelo de IA ni plataforma debe escribir directamente en Supabase cuando exista una API, Adapter o Service correspondiente.
