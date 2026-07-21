# ECE-FOUNDATION-01 — Fundación del ELANKAV Commerce Engine

## Estado

```text
AUD-COMMERCE-001
AUDITORÍA DOCUMENTAL Y TÉCNICA COMPLETADA

ECE-FOUNDATION-01
ORDEN ARQUITECTÓNICO ESTABLECIDO
IMPLEMENTACIÓN NO INICIADA
```

Este documento establece la dirección oficial para construir ELANHOME como parte del ecosistema ELANKAV sin dañar, sustituir ni acoplar indebidamente ELANVISUAL o ELANPET.

No autoriza migraciones, creación de tablas productivas, integración con marketplaces, merge, deploy ni cambios en producción.

---

# 1. Decisión oficial

ELANHOME no se construirá como una tienda aislada ni como una copia de ELANPET.

ELANHOME será la primera plataforma que consuma un motor transversal denominado:

```text
ELANKAV Commerce Engine
```

El motor no pertenece exclusivamente a ELANHOME. Debe poder ser reutilizado posteriormente por ELANPET, ELANVISUAL u otras plataformas del ecosistema mediante contratos y servicios estables.

Arquitectura objetivo:

```text
ELANHOME
ELANPET
ELANVISUAL
Futuras plataformas
        ↓
Contratos comunes de comercio
        ↓
ELANKAV Orchestrator
        ↓
Services
        ↓
Adapters
        ↓
Supabase / proveedores locales / marketplaces / logística
```

---

# 2. Regla de protección del ecosistema

La incorporación del Commerce Engine debe ser aditiva.

Queda establecido:

- no modificar contratos vigentes de ELANVISUAL para adaptar ELANHOME;
- no reemplazar el catálogo, carrito o pedidos actuales de ELANPET durante la fase inicial;
- no copiar `AppContext`, persistencia local ni lógica acoplada de ELANPET;
- no convertir VQS en el carrito de ELANHOME;
- no conectar ELANHOME directamente a Supabase cuando exista Adapter o Service;
- no guardar secretos, tokens ni credenciales de marketplaces en el frontend;
- no obligar a que toda Orden de Compra dependa de una Orden de Trabajo;
- no duplicar CRM, proveedores, documentos, pagos o branding cuando ya exista un dominio transversal reutilizable.

ELANHOME será el consumidor piloto. ELANVISUAL y ELANPET permanecerán operativos con sus flujos actuales hasta que exista una migración independiente, validada y autorizada.

---

# 3. Modelo comercial oficial de ELANHOME

ELANHOME operará inicialmente como comercio sin inventario propio.

Flujo comercial:

```text
Registrar proveedor
        ↓
Importar o conectar catálogo
        ↓
Normalizar producto
        ↓
Vincular ofertas de proveedores
        ↓
Publicar producto maestro
        ↓
Cliente busca y compra
        ↓
Seleccionar fuente de abastecimiento
        ↓
Generar compra externa
        ↓
Proveedor / marketplace / courier entrega
        ↓
Seguimiento, conciliación y margen
```

ELANHOME será responsable de la experiencia comercial, precio de venta, cobro, seguimiento y control del pedido, aunque la disponibilidad y el fulfillment puedan provenir de terceros.

---

# 4. Separación obligatoria entre producto y proveedor

El catálogo público nunca debe depender directamente del catálogo de un proveedor.

Modelo oficial:

```text
Producto Maestro
        │
        ├── Variante A
        │      ├── Oferta Proveedor 1
        │      ├── Oferta Proveedor 2
        │      └── Oferta Marketplace 1
        │
        └── Variante B
               ├── Oferta Proveedor 1
               └── Oferta Marketplace 2
```

El cliente ve un producto comercial único.

Internamente ELANKAV conserva múltiples fuentes de abastecimiento con costo, stock, tiempo de entrega, moneda, restricciones, confiabilidad y margen.

Cada producto tendrá un identificador propio del ecosistema:

```text
ELANKAV SKU
```

Los identificadores externos, como códigos de proveedor, ASIN u otros IDs de marketplace, serán referencias de oferta y nunca la identidad principal del producto.

---

# 5. Dominios que componen el Commerce Engine

El Commerce Engine se dividirá como mínimo en los siguientes dominios:

```text
Commerce Engine
├── Product Master
├── Product Variants
├── Supplier Hub
├── Supplier Offers
├── Pricing Engine
├── Availability Engine
├── Cart Service
├── Checkout Service
├── Customer Order Service
├── Sourcing Engine
├── Purchase Order Service
├── Fulfillment Service
├── Logistics Service
├── Returns Service
├── Marketplace Connector Registry
└── Commerce Documents
```

## 5.1 Product Master

Responsable de:

- identidad canónica del producto;
- título y descripción comercial;
- categoría, marca y atributos;
- variantes;
- imágenes y documentos;
- publicación por plataforma;
- normalización y deduplicación.

## 5.2 Supplier Hub

Extiende el CRM de proveedores sin duplicar la identidad empresarial.

Debe relacionarse con el CRM oficial:

```text
crm_identities
        ↓
commerce_suppliers
```

Contendrá información comercial y operativa adicional:

- rubro;
- categorías y marcas;
- tipo de integración;
- condiciones de pago;
- cobertura;
- tiempos de entrega;
- modalidad de fulfillment;
- confiabilidad;
- devoluciones e incidencias;
- estado de la relación comercial.

## 5.3 Supplier Offers

Relaciona un producto o variante con una fuente de abastecimiento.

Cada oferta debe conservar como snapshot:

- proveedor;
- identificador externo;
- costo del artículo;
- moneda;
- stock o disponibilidad;
- envío;
- impuestos estimados;
- importación estimada;
- cantidad mínima;
- tiempo de entrega;
- fecha de última verificación;
- condiciones y restricciones.

## 5.4 Pricing Engine

No utilizará únicamente un porcentaje fijo.

Debe permitir reglas por:

- plataforma;
- categoría;
- marca;
- proveedor;
- tipo de producto;
- rango de costo;
- logística;
- riesgo;
- canal comercial;
- margen mínimo;
- promociones autorizadas.

## 5.5 Availability Engine

Determina si una oferta puede utilizarse.

Niveles iniciales:

1. disponibilidad importada o cacheada;
2. confirmación manual;
3. sincronización automática mediante conector autorizado.

## 5.6 Sourcing Engine

Selecciona la mejor fuente de abastecimiento.

No debe elegir únicamente el costo más bajo.

Criterios mínimos:

- disponibilidad;
- costo total aterrizado;
- tiempo de entrega;
- margen;
- confiabilidad;
- restricciones;
- capacidad logística;
- términos de pago;
- riesgo de devolución o garantía.

Toda selección debe generar una decisión auditable.

---

# 6. Reutilización autorizada de ELANVISUAL

ELANVISUAL ya aporta patrones y capacidades que deben reutilizarse mediante contratos transversales, no mediante copia directa de sus pantallas.

Capacidades reutilizables:

- cliente HTTP hacia Orchestrator;
- headers de plataforma, actor, rol e identidad;
- adapters de normalización documental;
- `brandSnapshot` por plataforma;
- pagos y recibos oficiales;
- Document Engine;
- Storage Adapter y flujo de entrega;
- auditoría;
- órdenes de compra;
- seguimiento de proyectos y documentos.

Capacidades exclusivas de ELANVISUAL:

- VQS como cotizador de proyectos;
- AI-23 y costos de producción gráfica;
- diseño y fabricación de rotulación;
- OT de producción gráfica;
- componentes y formularios específicos de ELANVISUAL.

Regla:

```text
Reutilizar contrato y servicio
≠
Copiar interfaz o lógica específica de rotulación
```

---

# 7. Reutilización autorizada de ELANPET

ELANPET confirma que el ecosistema ya posee experiencia funcional en:

- catálogo;
- carrito;
- pago por transferencia;
- anticipo o pago total;
- pedidos;
- seguimiento público;
- producción;
- CMS.

Sin embargo, su implementación actual está acoplada a su contexto de aplicación, veterinarias, comisiones, producción y persistencia local.

Por tanto:

- la experiencia de usuario puede servir como referencia;
- los cálculos puros pueden extraerse después de auditoría;
- el modelo actual de pedido no será el contrato transversal;
- `AppContext` no será copiado a ELANHOME;
- `localStorage` no será fuente oficial del Commerce Engine;
- veterinarias y comisiones seguirán siendo dominio exclusivo de ELANPET;
- cualquier migración de ELANPET será posterior, opcional y separada.

---

# 8. Órdenes de Trabajo y Órdenes de Compra

ELANVISUAL y ELANHOME tienen flujos distintos.

ELANVISUAL:

```text
Cotización
→ Anticipo
→ Orden de Trabajo
→ Orden de Compra
```

ELANHOME:

```text
Pedido confirmado
→ Selección de proveedor
→ Orden de Compra
→ Fulfillment
```

El contrato de Orden de Compra deberá admitir al menos:

```text
originType:
- work_order
- customer_order
- manual
- inventory_replenishment
```

Así se mantiene el flujo de ELANVISUAL sin bloquear el modelo comercial de ELANHOME.

---

# 9. Integración con marketplaces y proveedores externos

Ningún marketplace se integrará directamente desde React.

Arquitectura obligatoria:

```text
ELANHOME
        ↓
Commerce API
        ↓
Marketplace Connector Registry
        ├── Local Supplier Connector
        ├── Manual Connector
        ├── CSV / Excel Connector
        ├── Amazon Connector
        ├── Alibaba Connector
        ├── AliExpress Connector
        └── futuros conectores
```

Contrato neutral propuesto:

```text
searchProducts()
getProduct()
getOffer()
checkAvailability()
estimateLandedCost()
createExternalOrder()
getExternalOrder()
getTracking()
cancelExternalOrder()
```

Cada conector deberá declarar capacidades porque no todos los proveedores permiten búsqueda, checkout, cancelación o tracking automático.

Antes de habilitar un marketplace debe auditarse individualmente:

- programa comercial disponible;
- acceso a API;
- autorización para reventa o intermediación;
- reglas de marca y catálogo;
- checkout permitido;
- métodos de pago;
- shipping internacional;
- impuestos y aduana;
- devoluciones y garantías;
- restricciones por país;
- protección de credenciales;
- costos y límites operativos.

Queda prohibido utilizar scraping como base oficial sin movimiento técnico, legal y de seguridad separado.

---

# 10. Modelo de datos inicial propuesto

Entidades mínimas:

```text
commerce_products
commerce_product_variants
commerce_categories
commerce_suppliers
commerce_supplier_offers
commerce_price_rules
commerce_carts
commerce_cart_items
commerce_orders
commerce_order_items
commerce_sourcing_decisions
commerce_purchase_orders
commerce_purchase_order_items
commerce_fulfillments
commerce_shipments
commerce_returns
commerce_connector_accounts
commerce_connector_events
```

No se crearán estas tablas en producción durante ECE-FOUNDATION-01.

Antes de cualquier migración se debe definir:

- contrato;
- ownership del dato;
- relaciones con CRM, pagos, documentos y OT/OC;
- RLS y permisos;
- auditoría;
- idempotencia;
- estrategia de rollback;
- backfill, si aplica;
- pruebas de regresión sobre ELANVISUAL y ELANPET.

---

# 11. Orden oficial de ejecución

## Fase 0 — Fundación documental y contractual

Movimiento:

```text
ECE-FOUNDATION-01
```

Orden:

1. aprobar este documento como dirección oficial;
2. identificar contratos compartidos existentes;
3. definir `ProductContract`;
4. definir `SupplierContract`;
5. definir `SupplierOfferContract`;
6. definir `CartContract`;
7. definir `CustomerOrderContract`;
8. definir `SourcingDecisionContract`;
9. evolucionar `PurchaseOrderContract` para múltiples orígenes;
10. definir `MarketplaceConnectorContract`;
11. definir errores normalizados;
12. definir IAM, auditoría y permisos;
13. diseñar pruebas de compatibilidad;
14. actualizar línea base y roadmap.

No incluye implementación productiva.

## Fase 1 — Supplier Hub y Product Master

Movimiento futuro:

```text
ECE-SUPPLY-01
```

Orden:

1. servicios de proveedores;
2. categorías y rubros;
3. producto maestro;
4. variantes;
5. ofertas;
6. normalización de catálogos;
7. importación manual y CSV/Excel;
8. API de lectura;
9. pruebas;
10. documentación.

## Fase 2 — Catálogo ELANHOME

Movimiento futuro:

```text
ELANHOME-CATALOG-01
```

Orden:

1. consumir Product Master en modo lectura;
2. navegación por categorías;
3. búsqueda;
4. ficha de producto;
5. variantes;
6. disponibilidad informativa;
7. precio comercial;
8. SEO y accesibilidad;
9. pruebas sin checkout.

## Fase 3 — Carrito y pedido

Movimiento futuro:

```text
ECE-ORDER-01
```

Orden:

1. carrito persistente del servidor;
2. checkout;
3. identidad de cliente;
4. dirección y logística;
5. pedido oficial;
6. totales y snapshots;
7. pagos;
8. recibos;
9. seguimiento;
10. pruebas E2E.

## Fase 4 — Sourcing y compra local

Movimiento futuro:

```text
ECE-SOURCING-01
```

Orden:

1. disponibilidad manual;
2. cálculo de costo aterrizado;
3. selección auditable;
4. generación de OC desde pedido;
5. confirmación del proveedor;
6. fulfillment;
7. tracking;
8. conciliación de margen.

## Fase 5 — Primer conector externo

Movimiento futuro:

```text
ECE-CONNECTOR-01
```

Orden:

1. seleccionar un proveedor o marketplace autorizado;
2. auditar políticas y APIs;
3. implementar Adapter aislado;
4. operar inicialmente en modo lectura;
5. verificar costo, disponibilidad y tracking;
6. habilitar compra automática únicamente con autorización separada;
7. registrar auditoría, límites, errores y rollback.

## Fase 6 — Migración opcional de plataformas existentes

Solo después de estabilizar ELANHOME:

```text
ELANPET-COMMERCE-MIGRATION-01
ELANVISUAL-COMMERCE-INTEGRATION-01
```

Cada migración será un movimiento independiente.

No se retirará ninguna funcionalidad existente hasta completar:

- paridad funcional;
- migración de datos;
- pruebas E2E;
- rollback;
- validación en Preview;
- autorización de producción.

---

# 12. Criterios obligatorios de aceptación

El Commerce Engine solo podrá avanzar a implementación cuando exista evidencia de:

- contratos neutrales por plataforma;
- separación entre producto y oferta;
- separación entre pedido y compra externa;
- compatibilidad de OC con `work_order` y `customer_order`;
- ausencia de acceso privilegiado desde frontend;
- IAM y auditoría definidos;
- idempotencia para pedidos y compras;
- snapshots de costos, precios y disponibilidad;
- protección de ELANVISUAL y ELANPET mediante pruebas de regresión;
- rollback documentado;
- documentación y línea base actualizadas.

---

# 13. Prohibiciones permanentes

- No copiar el repositorio ELANPET para crear ELANHOME.
- No convertir ELANHOME en una segunda instancia de VQS.
- No usar el código externo del proveedor como SKU principal.
- No publicar catálogos de proveedores sin normalización.
- No sobrescribir productos maestros al actualizar una oferta.
- No ejecutar compras externas sin idempotencia y confirmación de estado.
- No almacenar secretos en Vite, React, localStorage o repositorios.
- No asumir que una URL accesible implica stock confirmado.
- No asumir que el proveedor más barato es la mejor fuente.
- No activar Amazon, Alibaba u otro marketplace sin auditoría individual.
- No migrar ELANPET o ELANVISUAL como parte del MVP de ELANHOME.

---

# 14. Fuente oficial y continuidad

Este documento es la fuente maestra para la dirección del ELANKAV Commerce Engine.

Todo chat o movimiento relacionado deberá leer, en este orden:

1. `docs/00_MASTER_INDEX.md`;
2. `docs/06_LINEA_BASE_ECOSISTEMA.md`;
3. `docs/05_ROADMAP_PROPUESTO.md`;
4. `docs/ECE-FOUNDATION-01_COMMERCE_ENGINE.md`;
5. el documento específico del movimiento activo.

No se debe reconstruir esta arquitectura desde memoria conversacional ni crear una estructura paralela.

---

# 15. Estado de cierre documental

```text
AUD-COMMERCE-001
CERRADO COMO AUDITORÍA

ECE-FOUNDATION-01
ESTABLECIDO DOCUMENTALMENTE
PENDIENTE DE APROBACIÓN E IMPLEMENTACIÓN CONTROLADA
```

No se modificó:

- ELANVISUAL;
- ELANPET;
- ELANHOME;
- Supabase;
- Orchestrator funcional;
- producción;
- variables de entorno;
- conectores externos.
