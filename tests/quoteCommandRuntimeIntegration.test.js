'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMANDS,
  processQuoteRuntimeCommand,
  resolveIntent
} = require('../services/quoteCore/quoteCommandRuntimeService');
const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  executeOwnerCommand
} = require('../services/ownerCommandService');

function memoryReader() {
  return {
    async select(table) {
      if (table === 'elankav_projects') {
        return [{
          id: 'p-1',
          project_number: 'PROJ-001',
          title: 'Rótulo luminoso',
          status: 'production',
          current_stage: 'fabricación',
          customer_snapshot: { name: 'Valentina Ruiz', companyName: 'Valentina Studio' }
        }];
      }
      return [];
    }
  };
}

test('QUOTE-CORE-05 reconoce consulta operacional de producción', () => {
  assert.equal(
    resolveIntent('Qué trabajos tenemos de Valentina en producción'),
    COMMANDS.PRODUCTION_BY_CUSTOMER
  );
});

test('QUOTE-CORE-05 responde usando el alcance owner global', async () => {
  const result = await processQuoteRuntimeCommand({
    message: 'Qué trabajos tenemos de Valentina en producción',
    actor: { role: 'owner' },
    reader: memoryReader()
  });

  assert.equal(result.handled, true);
  assert.equal(result.scope, 'global');
  assert.match(result.outputText, /PROJ-001/);
  assert.match(result.outputText, /Valentina/);
});

test('QUOTE-CORE-05 queda deshabilitado por defecto y no captura mensajes', async () => {
  const result = await processQuoteRuntimeCommand({
    message: 'Qué cotizaciones están sin seguimiento',
    actor: { role: 'owner' },
    env: {}
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'QUOTE_CORE_RUNTIME_DISABLED');
});

test('Owner Commands existentes conservan prioridad', () => {
  const previous = process.env.QUOTE_CORE_RUNTIME_ENABLED;
  process.env.QUOTE_CORE_RUNTIME_ENABLED = 'true';
  try {
    assert.equal(detectOwnerCommand('context sync'), OWNER_COMMANDS.CONTEXT_SYNC);
    assert.equal(detectOwnerCommand('cancelar'), OWNER_COMMANDS.CANCEL_FLOW);
    assert.equal(
      detectOwnerCommand('Qué cotizaciones están sin seguimiento').type,
      OWNER_COMMANDS.QUOTE_QUERY
    );
  } finally {
    if (previous === undefined) delete process.env.QUOTE_CORE_RUNTIME_ENABLED;
    else process.env.QUOTE_CORE_RUNTIME_ENABLED = previous;
  }
});

test('executeOwnerCommand entrega la consulta Quote Core mediante el router owner', async () => {
  const previous = process.env.QUOTE_CORE_RUNTIME_ENABLED;
  process.env.QUOTE_CORE_RUNTIME_ENABLED = 'true';
  try {
    const originalFetch = global.fetch;
    global.fetch = async url => {
      const value = String(url);
      if (value.includes('/elankav_projects?')) {
        return new Response(JSON.stringify([{
          id: 'p-1', project_number: 'PROJ-001', title: 'Rótulo luminoso',
          status: 'production', current_stage: 'fabricación',
          customer_snapshot: { name: 'Valentina Ruiz' }
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const oldUrl = process.env.SUPABASE_URL;
    const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const result = await executeOwnerCommand({
      command: {
        type: OWNER_COMMANDS.QUOTE_QUERY,
        message: 'Qué trabajos tenemos de Valentina en producción'
      },
      platform: 'elanvisual'
    });

    assert.equal(result.command, OWNER_COMMANDS.QUOTE_QUERY);
    assert.equal(result.job, null);
    assert.match(result.outputText, /PROJ-001/);

    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  } finally {
    if (previous === undefined) delete process.env.QUOTE_CORE_RUNTIME_ENABLED;
    else process.env.QUOTE_CORE_RUNTIME_ENABLED = previous;
  }
});


test('Owner consulta proyectos activos globales', async () => {
  const rows = [
    {
      project_number: 'PROY-001',
      title: 'Proyecto activo',
      status: 'production',
      current_stage: 'production',
      expected_delivery_at: null,
      customer_snapshot: { name: 'Cliente A' }
    },
    {
      project_number: 'PROY-002',
      title: 'Proyecto cerrado',
      status: 'completed',
      current_stage: 'completed',
      expected_delivery_at: null,
      customer_snapshot: { name: 'Cliente B' }
    }
  ];

  const reader = {
    async select(table) {
      assert.equal(table, 'elankav_projects');
      return rows;
    }
  };

  const result = await processQuoteRuntimeCommand({
    message: 'Qué proyectos tengo activos',
    actor: { role: 'owner' },
    reader
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, COMMANDS.ACTIVE_PROJECTS);
  assert.equal(result.scope, 'global');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].projectNumber, 'PROY-001');
  assert.match(result.outputText, /1 proyecto\(s\) activo\(s\)/);
});

test('Owner reconoce consultas naturales de compras, entregas y pagos', () => {
  assert.equal(
    resolveIntent('Qué compras tengo pendientes'),
    COMMANDS.OPEN_PURCHASE_ORDERS
  );

  assert.equal(
    resolveIntent('Qué proveedor no ha entregado'),
    COMMANDS.PENDING_SUPPLIER_DELIVERIES
  );

  assert.equal(
    resolveIntent('Ya entregó Play Marketing?'),
    COMMANDS.SUPPLIER_DELIVERY_STATUS
  );

  assert.equal(
    resolveIntent('Qué debo pagarle a proveedores'),
    COMMANDS.PENDING_SUPPLIER_PAYMENTS
  );

  assert.equal(
    resolveIntent('Qué compras están bloqueando producción'),
    COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES
  );
});

test('Owner lista únicamente órdenes de compra abiertas', async () => {
  const reader = {
    async select(table) {
      assert.equal(table, 'elankav_purchase_orders');

      return [
        {
          id: 'po-1',
          purchase_order_number: 'OC-2026-000001',
          supplier_name_snapshot: 'PLAY MARKETING',
          supplier_id: 'supplier-1',
          status: 'draft',
          blocks_production: true,
          currency: 'NIO',
          total: 3707.04
        },
        {
          id: 'po-2',
          purchase_order_number: 'OC-2026-000002',
          supplier_name_snapshot: 'Proveedor B',
          supplier_id: 'supplier-2',
          status: 'received',
          blocks_production: false,
          currency: 'NIO',
          total: 100
        }
      ];
    }
  };

  const result = await processQuoteRuntimeCommand({
    message: 'Qué compras tengo pendientes',
    actor: { role: 'owner' },
    reader
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, COMMANDS.OPEN_PURCHASE_ORDERS);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].purchaseOrderNumber, 'OC-2026-000001');
  assert.match(result.outputText, /PLAY MARKETING/);
});

test('Owner distingue reporte del proveedor de recepción interna', async () => {
  const reader = {
    async select(table) {
      if (table === 'elankav_purchase_orders') {
        return [{
          id: 'po-play',
          purchase_order_number: 'OC-2026-000002',
          supplier_name_snapshot: 'PLAY MARKETING',
          supplier_id: 'supplier-play',
          status: 'ordered',
          blocks_production: true,
          currency: 'NIO',
          total: 3707.04
        }];
      }

      if (table === 'elankav_purchase_order_delivery_lines') {
        return [{
          id: 'line-1',
          purchase_order_id: 'po-play',
          supplier_status: 'ready',
          supplier_ready_qty: 10,
          supplier_delivered_qty: 0,
          internal_received_at: null,
          internal_received_qty: 0,
          internal_conformity: false
        }];
      }

      return [];
    }
  };

  const result = await processQuoteRuntimeCommand({
    message: 'Ya entregó Play Marketing?',
    actor: { role: 'owner' },
    reader
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, COMMANDS.SUPPLIER_DELIVERY_STATUS);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].supplierDelivered, false);
  assert.equal(result.rows[0].internalReceived, false);
  assert.match(result.outputText, /proveedor reporta avance/);
  assert.match(result.outputText, /recepción interna pendiente/);
});

test('Owner informa cuando no existen pagos pendientes a proveedores', async () => {
  const reader = {
    async select(table) {
      assert.equal(table, 'elankav_supplier_payment_orders');
      return [];
    }
  };

  const result = await processQuoteRuntimeCommand({
    message: 'Qué debo pagarle a proveedores',
    actor: { role: 'owner' },
    reader
  });

  assert.equal(result.handled, true);
  assert.equal(result.command, COMMANDS.PENDING_SUPPLIER_PAYMENTS);
  assert.equal(result.rows.length, 0);
  assert.match(
    result.outputText,
    /No encontré órdenes de pago pendientes/
  );
});

test('Owner reconoce variantes naturales de entregas pendientes', () => {
  const samples = [
    'Qué entregas están pendientes',
    'Qué entregas siguen pendientes',
    'Qué entregas faltan',
    'Qué falta entregar',
    'Qué materiales faltan'
  ];

  for (const message of samples) {
    assert.equal(
      resolveIntent(message),
      COMMANDS.PENDING_SUPPLIER_DELIVERIES,
      message
    );
  }
});
