'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'QUOTE_CORE_01.sql'),
  'utf8'
);

function tableDefinition(tableName) {
  const pattern = new RegExp(
    `create table if not exists public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`,
    'i'
  );
  return sql.match(pattern)?.[1] || '';
}

function assertColumns(tableName, columns) {
  const definition = tableDefinition(tableName);
  assert.ok(definition, `No se encontró la tabla ${tableName}`);
  for (const column of columns) {
    assert.match(
      definition,
      new RegExp(`\\b${column}\\b`, 'i'),
      `${tableName} debe contener ${column}`
    );
  }
}

test('QUOTE-CORE-05 define todas las tablas operativas nuevas', () => {
  for (const table of [
    'elankav_quotations',
    'elankav_projects',
    'elankav_quotation_follow_ups',
    'elankav_project_events',
    'elankav_work_orders',
    'elankav_purchase_orders',
    'elankav_project_receipts'
  ]) {
    assert.ok(tableDefinition(table), `Falta ${table}`);
  }
});

test('QUOTE-CORE-05 cotizaciones coincide con QuoteProjectService', () => {
  assertColumns('elankav_quotations', [
    'quotation_number',
    'platform_id',
    'source_type',
    'source_id',
    'design_mode',
    'customer_id',
    'executive_id',
    'status',
    'public_token',
    'public_url',
    'customer_snapshot',
    'executive_snapshot',
    'items',
    'pricing',
    'payment_terms',
    'relations',
    'contract_version',
    'subtotal_usd',
    'discount_usd',
    'tax_usd',
    'total_usd',
    'exchange_rate',
    'payable_total_nio',
    'deposit_confirmed_at',
    'deposit_reference',
    'created_by',
    'updated_by'
  ]);
});

test('QUOTE-CORE-05 usa texto para identidades externas', () => {
  const quotations = tableDefinition('elankav_quotations');
  const projects = tableDefinition('elankav_projects');
  const followUps = tableDefinition('elankav_quotation_follow_ups');

  assert.match(quotations, /customer_id text not null/i);
  assert.match(quotations, /executive_id text not null/i);
  assert.match(projects, /customer_id text not null/i);
  assert.match(projects, /executive_id text not null/i);
  assert.match(followUps, /owner_executive_id text/i);
});

test('QUOTE-CORE-05 permite upsert único de seguimiento', () => {
  const followUps = tableDefinition('elankav_quotation_follow_ups');
  assert.match(followUps, /quotation_id uuid not null unique/i);
});

test('QUOTE-CORE-05 eventos coincide con appendEvent', () => {
  assertColumns('elankav_project_events', [
    'project_id',
    'quotation_id',
    'event_type',
    'actor_type',
    'actor_user_id',
    'actor_executive_id',
    'actor_role',
    'platform_id',
    'payload',
    'occurred_at'
  ]);
});

test('QUOTE-CORE-05 contiene índices para consultas de ELAN AI', () => {
  for (const index of [
    'idx_elankav_quotations_customer',
    'idx_elankav_quotations_executive',
    'idx_elankav_quotations_status',
    'idx_elankav_projects_status',
    'idx_elankav_projects_customer',
    'idx_elankav_projects_executive',
    'idx_elankav_followups_next',
    'idx_elankav_work_orders_project_status',
    'idx_elankav_purchase_orders_project_status'
  ]) {
    assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'));
  }
});

test('QUOTE-CORE-05 queda transaccional y no activa RLS prematuramente', () => {
  assert.match(sql, /^\s*--[\s\S]*?\bbegin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assert.doesNotMatch(sql, /alter table[\s\S]*enable row level security/i);
});
