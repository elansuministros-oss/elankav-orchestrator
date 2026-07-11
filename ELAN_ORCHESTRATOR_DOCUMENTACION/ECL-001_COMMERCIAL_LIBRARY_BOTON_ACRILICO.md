# ECL-001 — ELANKAV Commercial Library

## Estado

Fundación implementada. Integración con Sales Engine, WhatsApp y OpenAI pendiente de validación.

## Objetivo

Crear una fuente comercial compartida para todo el ecosistema ELANKAV. La IA no debe inventar materiales, espesores, medidas, precios, variantes ni reglas de venta.

## Arquitectura

```text
Plataformas ELANKAV
↓
Adapters
↓
Commercial Library Service
↓
Producto / Variante / Precio / Prompt / Flujo
↓
Sales Engine
↓
OpenAI
```

## Producto piloto

`boton-acrilico`

### Reglas técnicas oficiales

- Acrílico transparente: 3 mm.
- Medida base: 60 cm.
- Medida máxima estándar: 120 cm.
- Incremento estándar: 10 cm.
- Aumento por incremento: USD 20.
- Medidas fuera de 60–120 cm: revisión manual.
- Medidas intermedias que no sean múltiplos de 10 cm: revisión manual.

### Variantes iniciales

| ID | Nombre | Precio base 60 cm |
|---|---|---:|
| boton-transparente | Botón Transparente | USD 100 |
| boton-con-impresion | Botón con Impresión | USD 130 |
| boton-impresion-uv-premium | Botón Impresión UV Premium | USD 150 |
| boton-premium-combinado | Botón Premium Combinado | USD 190 |

### Ejemplo de cálculo

```text
Botón Transparente 60 cm = USD 100
Botón Transparente 70 cm = USD 120
Botón Transparente 80 cm = USD 140
```

## Reglas comerciales validadas

1. Cuando el cliente envía el logo, se genera una muestra automáticamente.
2. No esperar que el cliente solicite el render.
3. Una reacción positiva como “bello” o “me encanta” mueve la conversación al cierre.
4. No generar una segunda imagen sin motivo.
5. Después de una reacción positiva, pedir foto del lugar para visualizar mejor la instalación.
6. Forma de pago: 60% anticipo y 40% saldo.
7. Cuentas bancarias y enlaces de pago deben venir de configuración oficial, nunca de prompts.
8. La IA no puede inventar especificaciones.

## Archivos implementados en elankav-core

- `commercial-library/products/boton-acrilico/product.js`
- `commercial-library/products/boton-acrilico/prompts.js`
- `commercial-library/products/boton-acrilico/sales-flow.js`
- `services/commercialLibraryService.js`
- `test/commercialLibraryService.test.js`
- `commercial-library/ACCESS_MATRIX.md`

## Matriz de accesos inicial

La Commercial Library no tiene acceso directo a:

- CRM
- Inventario
- Producción
- Pagos
- WAHA
- OpenAI
- Supabase

Es un núcleo de lectura y cálculo. Los accesos se añadirán mediante Adapters y Servicios específicos después de validar.

## Escalamiento previsto

Los siguientes productos se agregarán uno por uno usando el mismo contrato:

1. Rótulo jala vista.
2. Fachada PVC.
3. Fachada ACM.
4. Letras 3D.
5. Caja de luz.
6. Vehículos.
7. Otros servicios.

## Regla de continuidad

Todo nuevo producto debe declarar:

- plataformas consumidoras;
- materiales y espesores oficiales;
- medidas estándar y límites;
- variantes;
- reglas de precio;
- prompts de render;
- flujo comercial;
- matriz de accesos;
- pruebas mínimas.

No se conecta al Sales Engine hasta que su configuración esté completa y validada.
