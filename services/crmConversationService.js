'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerSupplier } = require('./supplierService');
const { registerClient } = require('./clientService');

const STATE_FILE = process.env.CRM_COMMAND_STATE_FILE || '/opt/elankav/state/crm-command-state.json';

function normalize(value) {
  return String(value || '').trim();
}

function normalizeCommand(value) {
  return normalize(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function loadStates() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveStates(states) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(states, null, 2));
  fs.renameSync(temporary, STATE_FILE);
}

function getKey({ externalUserId, phone }) {
  return normalize(externalUserId) || normalize(phone) || 'owner';
}

function isCancel(message) {
  return /^(cancelar|cancela|detener|no guardar)$/i.test(normalize(message));
}

function isConfirm(message) {
  return /^(si|sí|confirmo|guardar|proceder|confirmar)$/i.test(normalize(message));
}

function detectStart(message) {
  const value = normalizeCommand(message);
  if (/(crear|agregar|registrar).*(proveedor)/.test(value) || /quiero agregar un proveedor/.test(value)) {
    return 'supplier';
  }
  if (/(crear|agregar|registrar).*(cliente)/.test(value) || /quiero agregar un cliente/.test(value)) {
    return 'client';
  }
  return null;
}

function parseSupplierType(message) {
  const value = normalizeCommand(message);
  if (/mixt|ambas|material.*servicio/.test(value)) return 'mixed';
  if (/servicio/.test(value)) return 'services';
  if (/material|materia prima|ferreter/.test(value)) return 'materials';
  return '';
}

function splitCategories(message) {
  return normalize(message)
    .split(/,| y /i)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatSupplierSummary(data) {
  const typeLabels = {
    materials: 'Materia prima',
    services: 'Servicios',
    mixed: 'Mixto'
  };
  return [
    'Voy a registrar este proveedor:',
    '',
    `Nombre: ${data.name}`,
    `Tipo: ${typeLabels[data.supplierType]}`,
    `Rubro: ${data.categories.join(', ')}`,
    '',
    '¿Confirmás que lo guarde?'
  ].join('\n');
}

function formatClientSummary(data) {
  return [
    'Voy a registrar este cliente:',
    '',
    `Nombre: ${data.name}`,
    `Plataforma: ${data.platform.toUpperCase()}`,
    `Responsable comercial: Administrador`,
    `Teléfono: ${data.phone || 'No indicado'}`,
    '',
    '¿Confirmás que lo guarde?'
  ].join('\n');
}

async function processSupplier(state, message) {
  if (state.step === 'name') {
    state.data.name = normalize(message);
    state.step = 'type';
    return '¿Vende materia prima, ofrece servicios o ambas cosas?';
  }

  if (state.step === 'type') {
    const supplierType = parseSupplierType(message);
    if (!supplierType) return 'Indicame si es proveedor de materia prima, servicios o mixto.';
    state.data.supplierType = supplierType;
    state.step = 'categories';
    return '¿Qué materiales o servicios ofrece?';
  }

  if (state.step === 'categories') {
    const categories = splitCategories(message);
    if (!categories.length) return 'Necesito al menos un material o servicio que ofrece.';
    state.data.categories = categories;
    state.step = 'confirm';
    return formatSupplierSummary(state.data);
  }

  if (state.step === 'confirm') {
    if (!isConfirm(message)) return 'Respondé “Sí” para guardar o “Cancelar” para detener.';
    const result = await registerSupplier(state.data);
    const name = result.supplier?.identity?.display_name || state.data.name;
    return `Proveedor registrado correctamente en el CRM.\n\nNombre: ${name}\nEstado: activo`;
  }

  throw new Error('CRM_SUPPLIER_FLOW_INVALID');
}

async function processClient(state, message) {
  if (state.step === 'platform') {
    state.data.platform = normalize(message);
    state.step = 'name';
    return '¿Cuál es el nombre del cliente?';
  }

  if (state.step === 'name') {
    state.data.name = normalize(message);
    state.step = 'phone';
    return '¿Cuál es su teléfono o WhatsApp? Podés responder “omitir”.';
  }

  if (state.step === 'phone') {
    state.data.phone = /^omitir$/i.test(normalize(message)) ? '' : normalize(message);
    state.step = 'confirm';
    return formatClientSummary(state.data);
  }

  if (state.step === 'confirm') {
    if (!isConfirm(message)) return 'Respondé “Sí” para guardar o “Cancelar” para detener.';
    const result = await registerClient(state.data);
    const name = result.client?.identity?.display_name || state.data.name;
    return `Cliente registrado correctamente.\n\nNombre: ${name}\nPlataforma: ${state.data.platform.toUpperCase()}\nResponsable comercial: Administrador`;
  }

  throw new Error('CRM_CLIENT_FLOW_INVALID');
}

async function processCrmConversation({ message, externalUserId, phone }) {
  const key = getKey({ externalUserId, phone });
  const states = loadStates();
  let state = states[key];

  if (state && isCancel(message)) {
    delete states[key];
    saveStates(states);
    return { handled: true, completed: true, outputText: 'Proceso cancelado. No se creó ningún registro.' };
  }

  if (!state) {
    const type = detectStart(message);
    if (!type) return { handled: false };

    state = {
      type,
      step: type === 'supplier' ? 'name' : 'platform',
      data: {},
      startedAt: new Date().toISOString()
    };
    states[key] = state;
    saveStates(states);

    return {
      handled: true,
      completed: false,
      outputText: type === 'supplier'
        ? 'Perfecto. Decime el nombre del proveedor.'
        : 'Perfecto. ¿Para qué plataforma será el cliente?'
    };
  }

  const outputText = state.type === 'supplier'
    ? await processSupplier(state, message)
    : await processClient(state, message);

  const completed = state.step === 'confirm' && isConfirm(message);
  if (completed) delete states[key];
  else states[key] = state;
  saveStates(states);

  return { handled: true, completed, outputText };
}

module.exports = {
  detectStart,
  isCancel,
  isConfirm,
  parseSupplierType,
  splitCategories,
  processCrmConversation
};
