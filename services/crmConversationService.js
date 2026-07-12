'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerSupplier } = require('./supplierService');
const { registerClient } = require('./clientService');

const STATE_FILE = process.env.CRM_COMMAND_STATE_FILE || '/opt/elankav/state/crm-command-state.json';
const normalize = value => String(value || '').trim();
const normalizeCommand = value => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function readStates() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; }
  catch { return {}; }
}

function writeStates(states) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(states, null, 2));
  fs.renameSync(temp, STATE_FILE);
}

function detectStart(message) {
  const value = normalizeCommand(message);
  if (/(crear|agregar|registrar).*(proveedor)/.test(value) || value.includes('quiero agregar un proveedor')) return 'supplier';
  if (/(crear|agregar|registrar).*(cliente)/.test(value) || value.includes('quiero agregar un cliente')) return 'client';
  return null;
}

const isCancel = message => /^(cancelar|cancela|detener|no guardar)$/i.test(normalize(message));
const isConfirm = message => /^(si|sí|confirmo|guardar|proceder|confirmar)$/i.test(normalize(message));

function parseSupplierType(message) {
  const value = normalizeCommand(message);
  if (/mixt|ambas|material.*servicio/.test(value)) return 'mixed';
  if (/servicio/.test(value)) return 'services';
  if (/material|materia prima|ferreter/.test(value)) return 'materials';
  return '';
}

function splitCategories(message) {
  return normalize(message).split(/,| y /i).map(item => item.trim()).filter(Boolean);
}

function ownerKey({ externalUserId, phone }) {
  return normalize(externalUserId) || normalize(phone) || 'owner';
}

async function processSupplier(state, message) {
  if (state.step === 'name') {
    state.data.name = normalize(message);
    state.step = 'type';
    return { done: false, text: '¿Vende materia prima, ofrece servicios o ambas cosas?' };
  }
  if (state.step === 'type') {
    const type = parseSupplierType(message);
    if (!type) return { done: false, text: 'Indicame si es proveedor de materia prima, servicios o mixto.' };
    state.data.supplierType = type;
    state.step = 'categories';
    return { done: false, text: '¿Qué materiales o servicios ofrece?' };
  }
  if (state.step === 'categories') {
    const categories = splitCategories(message);
    if (!categories.length) return { done: false, text: 'Necesito al menos un material o servicio.' };
    state.data.categories = categories;
    state.step = 'confirm';
    return {
      done: false,
      text: `Voy a registrar este proveedor:\n\nNombre: ${state.data.name}\nTipo: ${state.data.supplierType}\nRubro: ${categories.join(', ')}\n\n¿Confirmás que lo guarde?`
    };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar” para detener.' };
  await registerSupplier(state.data);
  return { done: true, text: `Proveedor registrado correctamente en el CRM.\n\nNombre: ${state.data.name}\nEstado: activo` };
}

async function processClient(state, message) {
  if (state.step === 'platform') {
    state.data.platform = normalize(message);
    state.step = 'name';
    return { done: false, text: '¿Cuál es el nombre del cliente?' };
  }
  if (state.step === 'name') {
    state.data.name = normalize(message);
    state.step = 'phone';
    return { done: false, text: '¿Cuál es su teléfono o WhatsApp? Podés responder “omitir”.' };
  }
  if (state.step === 'phone') {
    state.data.phone = /^omitir$/i.test(normalize(message)) ? '' : normalize(message);
    state.step = 'confirm';
    return {
      done: false,
      text: `Voy a registrar este cliente:\n\nNombre: ${state.data.name}\nPlataforma: ${state.data.platform.toUpperCase()}\nResponsable comercial: Administrador\nTeléfono: ${state.data.phone || 'No indicado'}\n\n¿Confirmás que lo guarde?`
    };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar” para detener.' };
  await registerClient(state.data);
  return { done: true, text: `Cliente registrado correctamente.\n\nNombre: ${state.data.name}\nPlataforma: ${state.data.platform.toUpperCase()}\nResponsable comercial: Administrador` };
}

async function processCrmConversation({ message, externalUserId, phone }) {
  const key = ownerKey({ externalUserId, phone });
  const states = readStates();
  let state = states[key];

  if (state && isCancel(message)) {
    delete states[key];
    writeStates(states);
    return { handled: true, completed: true, outputText: 'Proceso cancelado. No se creó ningún registro.' };
  }

  if (!state) {
    const type = detectStart(message);
    if (!type) return { handled: false };
    state = { type, step: type === 'supplier' ? 'name' : 'platform', data: {} };
    states[key] = state;
    writeStates(states);
    return {
      handled: true,
      completed: false,
      outputText: type === 'supplier'
        ? 'Perfecto. Decime el nombre del proveedor.'
        : 'Perfecto. ¿Para qué plataforma será el cliente?'
    };
  }

  const result = state.type === 'supplier'
    ? await processSupplier(state, message)
    : await processClient(state, message);

  if (result.done) delete states[key];
  else states[key] = state;
  writeStates(states);
  return { handled: true, completed: result.done, outputText: result.text };
}

module.exports = { detectStart, isCancel, isConfirm, parseSupplierType, splitCategories, processCrmConversation };
