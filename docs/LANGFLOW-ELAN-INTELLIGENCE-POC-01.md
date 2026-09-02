# LANGFLOW-ELAN-INTELLIGENCE-POC-01

## Objetivo

Validar Langflow como capa visual de razonamiento y selección de herramientas para ELAN,
sin convertirlo en otra fuente de datos, CRM, Supabase, motor de cotizaciones ni transporte.

Arquitectura objetivo:

```
WhatsApp / Voice / Web / CONNECT Chat
              |
          Orchestrator
    identidad + permisos + transporte
              |
           Langflow
 razonamiento + selección de capacidad
              |
       capacidades existentes
              |
 CONNECT / VQS / Providers / Prospecting / Design / Inventory / Projects
```

## Autoridades que NO cambian

- CONNECT: autoridad de datos empresariales.
- Orchestrator: identidad, permisos, WhatsApp, Owner Ops y ejecución protegida.
- WAHA: transporte WhatsApp existente; no se reinicia ni modifica para este POC.
- Unified Memory: memoria canónica existente; Langflow no crea una memoria empresarial paralela.
- Supabase existente: no se crea otro Supabase.

Langflow puede usar almacenamiento interno solamente para guardar configuración de flows,
usuarios y metadatos propios del componente. Ese almacenamiento NO será fuente de verdad de
clientes, precios, proyectos, proveedores, inventario o cotizaciones.

## Fase 1 — POC de lectura

Langflow se ejecuta en `127.0.0.1:7860`, no expuesto públicamente.

Se usa el componente OpenAPI Agent / API Request de Langflow contra el contrato:

`deploy/langflow/connect-readonly.openapi.yaml`

Pruebas iniciales:

1. "Buscá este cliente."
2. "¿Cuánto cuesta el PVC de 10 mm?"
3. "Buscá proveedores de acrílico."
4. "¿Cuál es la última cotización?"
5. "Listame los precios autorizados que coincidan con PVC."

Resultado esperado:
- utilizar datos reales;
- no inventar valores;
- no enviar mensajes;
- no crear ni modificar registros;
- no activar campañas;
- no tocar WAHA.

## Fase 2 — integración con Unified Runtime

Una vez probado el POC, Langflow NO debe recibir permisos ilimitados de CONNECT.

La integración final debe reutilizar:
- `elanUnifiedToolRegistry.js`
- `elanUnifiedRuntimeService.js`
- identidad/roles existentes
- Unified Memory de CONNECT

El patrón final será:

```
mensaje -> Orchestrator resuelve actor
        -> Langflow decide tool + argumentos
        -> Orchestrator valida permiso
        -> elanUnifiedToolRegistry ejecuta
        -> resultado real vuelve a Langflow
        -> respuesta final
```

Así Langflow razona, pero nunca puede elevar permisos ni ejecutar una herramienta que el actor
no tenga autorizada.

## Operaciones sensibles

Deben conservar confirmación/gates existentes:
- enviar WhatsApp o correo;
- crear/editar cotización;
- crear/editar cliente o proveedor;
- aprobar/promover proveedores;
- activar campañas/outreach;
- pagos;
- Owner Ops;
- repository.deploy;
- restart de servicios.

Langflow Human-in-the-Loop puede complementar estos gates, pero NO reemplazarlos.

## Seguridad del POC

- imagen oficial fijada a `langflowai/langflow:1.12.0`;
- bind solamente a localhost;
- auto-login deshabilitado;
- contraseña obligatoria;
- custom Python components deshabilitados;
- code interpreter deshabilitado;
- secretos únicamente por `.env` de servidor;
- no se incluyen secretos en Git;
- sin exposición pública;
- sin WAHA;
- sin campañas.

## Despliegue

No desplegar por Vercel.

Antes de instalar:
1. validar capacidad RAM/CPU del host;
2. validar Docker existente sin reiniciar WAHA;
3. crear directorio persistente;
4. generar secretos;
5. levantar únicamente el contenedor Langflow;
6. verificar `GET http://127.0.0.1:7860/health_check`;
7. crear flow POC;
8. probar exclusivamente lecturas;
9. documentar resultados;
10. solo después diseñar la integración al Unified Runtime.

No declarar READY hasta completar las pruebas naturales desde WhatsApp usando el runtime protegido.
