'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../services/crmConversationService.js');
const source = fs.readFileSync(target, 'utf8');

const replacements = [
  {
    name: 'parseSupplierName',
    before: "function parseSupplierName(message) {\n  const raw = normalize(message);",
    after: "function parseSupplierName(message) {\n  const raw = normalizeCommand(message);"
  },
  {
    name: 'parseContactSupplierName',
    before: "function parseContactSupplierName(message) {\n  const raw = normalize(message);",
    after: "function parseContactSupplierName(message) {\n  const raw = normalizeCommand(message);"
  },
  {
    name: 'parseClientName',
    before: "function parseClientName(message) {\n  const raw = normalize(message);",
    after: "function parseClientName(message) {\n  const raw = normalizeCommand(message);"
  }
];

let next = source;

for (const replacement of replacements) {
  if (next.includes(replacement.after)) {
    console.log(`✓ ${replacement.name} ya estaba corregido`);
    continue;
  }

  if (!next.includes(replacement.before)) {
    throw new Error(`No se encontró el bloque esperado: ${replacement.name}`);
  }

  next = next.replace(replacement.before, replacement.after);
  console.log(`✓ ${replacement.name} corregido`);
}

if (next === source) {
  console.log('Sin cambios pendientes.');
  process.exit(0);
}

const backup = `${target}.bak.crm-one-shot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, next, 'utf8');

console.log(`✓ Respaldo: ${backup}`);
console.log(`✓ Archivo actualizado: ${target}`);
