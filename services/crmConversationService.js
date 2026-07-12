'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerSupplier } = require('./supplierService');
const { registerClient } = require('./clientService');
const {
  resolveSupplier,
  getContacts,
  registerContact,
  editContact
} = require('./contactService');
const { normalizeWhatsappE164 } = require('./phoneService');

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

function detectCommand(message) {
  const raw = normalize(message);
  const value = normalizeCommand(raw);
  let match = value.match(/^(?:agregar|anadir|añadir|crear) contacto (?:a|para) (.+)$/);
  if (match) return { type: 'addContact', supplierName: match[1].trim() };
  match = value.match(/^editar contacto (?:de|del|en) (.+)$/);
  if (match) return { type: 'editContact', supplierName: match[1].trim() };
  if (/(crear|agregar|registrar).*(proveedor)/.test(value) || value.includes('quiero agregar un proveedor')) return { type: 'supplier' };
  if (/(crear|agregar|registrar).*(cliente)/.test(value) || value.includes('quiero agregar un cliente')) return { type: 'client' };
  return null;
}

function detectStart(message) {
  const command = detectCommand(message);
  return command ? command.type : null;
}

const isCancel = message => /^(cancelar|cancela|detener|no guardar)$/i.test(normalize(message));
const isConfirm = message => /^(si|sí|confirmo|guardar|proceder|confirmar)$/i.test(normalize(message));
const isSkip = message => /^(omitir|saltar|ninguno|no)$/i.test(normalize(message));

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
    state.step = 'contactName';
    return { done: false, text: '¿Cuál es el nombre del contacto principal? Podés responder “omitir”.' };
  }
  if (state.step === 'contactName') {
    state.data.contactName = isSkip(message) ? '' : normalize(message);
    state.step = 'whatsapp';
    return { done: false, text: '¿Cuál es el WhatsApp del proveedor? Es obligatorio.' };
  }
  if (state.step === 'whatsapp') {
    const whatsapp = normalizeWhatsappE164(message);
    if (!whatsapp) return { done: false, text: 'WhatsApp inválido. Enviámelo con código de país, por ejemplo +505 8888 8888.' };
    state.data.whatsapp = whatsapp;
    state.step = 'confirm';
    return { done: false, text: `Voy a registrar este proveedor:\n\nNombre: ${state.data.name}\nTipo: ${state.data.supplierType}\nRubro: ${state.data.categories.join(', ')}\nContacto: ${state.data.contactName || 'No indicado'}\nWhatsApp: ${whatsapp}\n\n¿Confirmás que lo guarde?` };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar”.' };
  await registerSupplier(state.data);
  return { done: true, text: `Proveedor registrado correctamente.\n\nNombre: ${state.data.name}\nWhatsApp: ${state.data.whatsapp}` };
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
    return { done: false, text: '¿Cuál es su WhatsApp? Es obligatorio.' };
  }
  if (state.step === 'phone') {
    const whatsapp = normalizeWhatsappE164(message);
    if (!whatsapp) return { done: false, text: 'WhatsApp inválido. Enviámelo con código de país.' };
    state.data.phone = whatsapp;
    state.data.whatsapp = whatsapp;
    state.step = 'confirm';
    return { done: false, text: `Voy a registrar este cliente:\n\nNombre: ${state.data.name}\nPlataforma: ${state.data.platform.toUpperCase()}\nResponsable: Administrador\nWhatsApp: ${whatsapp}\n\n¿Confirmás que lo guarde?` };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar”.' };
  const responsibleCommercialId = normalize(process.env.CRM_DEFAULT_ADMIN_IDENTITY_ID);
  if (!responsibleCommercialId) throw Object.assign(new Error('CRM_DEFAULT_ADMIN_IDENTITY_ID_NOT_CONFIGURED'), { code: 'CRM_DEFAULT_ADMIN_IDENTITY_ID_NOT_CONFIGURED' });
  await registerClient({ ...state.data, responsibleCommercialId });
  return { done: true, text: `Cliente registrado correctamente.\n\nNombre: ${state.data.name}\nPlataforma: ${state.data.platform.toUpperCase()}` };
}

async function processAddContact(state, message) {
  if (state.step === 'contactName') {
    state.data.contactName = isSkip(message) ? '' : normalize(message);
    state.step = 'contactRole';
    return { done: false, text: '¿Cuál es su cargo o área? Podés responder “omitir”.' };
  }
  if (state.step === 'contactRole') {
    state.data.contactRole = isSkip(message) ? '' : normalize(message);
    state.step = 'whatsapp';
    return { done: false, text: '¿Cuál es su WhatsApp? Es obligatorio.' };
  }
  if (state.step === 'whatsapp') {
    const whatsapp = normalizeWhatsappE164(message);
    if (!whatsapp) return { done: false, text: 'WhatsApp inválido. Usá formato internacional, por ejemplo +505 8888 8888.' };
    state.data.whatsapp = whatsapp;
    state.step = 'email';
    return { done: false, text: '¿Cuál es su correo? Podés responder “omitir”.' };
  }
  if (state.step === 'email') {
    state.data.email = isSkip(message) ? '' : normalize(message).toLowerCase();
    state.step = 'confirm';
    return { done: false, text: `Voy a agregar este contacto a ${state.data.supplierName}:\n\nNombre: ${state.data.contactName || 'No indicado'}\nÁrea: ${state.data.contactRole || 'No indicada'}\nWhatsApp: ${state.data.whatsapp}\nCorreo: ${state.data.email || 'No indicado'}\n\n¿Confirmás?` };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar”.' };
  await registerContact({
    identityId: state.data.identityId,
    contactName: state.data.contactName,
    contactRole: state.data.contactRole,
    whatsapp: state.data.whatsapp,
    email: state.data.email,
    isPrimary: state.data.isPrimary === true
  });
  return { done: true, text: `Contacto agregado correctamente a ${state.data.supplierName}.\n\nWhatsApp: ${state.data.whatsapp}` };
}

const EDIT_FIELDS = {
  nombre: 'contactName', contacto: 'contactName', area: 'contactRole', cargo: 'contactRole',
  whatsapp: 'whatsapp', telefono: 'phone', correo: 'email', ciudad: 'city',
  direccion: 'address', notas: 'notes'
};

function parseEditField(message) {
  const value = normalizeCommand(message);
  return EDIT_FIELDS[value] || '';
}

function contactLabel(contact, index) {
  return `${index + 1}. ${contact.contact_name || 'Sin nombre'} — ${contact.role_or_area || 'Sin área'} — ${contact.whatsapp}`;
}

async function processEditContact(state, message) {
  if (state.step === 'selectContact') {
    const index = Number.parseInt(normalize(message), 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= state.data.contacts.length) return { done: false, text: 'Indicame el número del contacto que querés editar.' };
    state.data.contact = state.data.contacts[index];
    delete state.data.contacts;
    state.step = 'field';
    return { done: false, text: '¿Qué querés editar: nombre, cargo/área, WhatsApp, teléfono, correo, ciudad, dirección o notas?' };
  }
  if (state.step === 'field') {
    const field = parseEditField(message);
    if (!field) return { done: false, text: 'Elegí: nombre, cargo, área, WhatsApp, teléfono, correo, ciudad, dirección o notas.' };
    state.data.field = field;
    state.step = 'value';
    return { done: false, text: 'Decime el nuevo valor.' };
  }
  if (state.step === 'value') {
    let value = normalize(message);
    if (state.data.field === 'whatsapp') {
      value = normalizeWhatsappE164(message);
      if (!value) return { done: false, text: 'WhatsApp inválido. Enviámelo con código de país.' };
    }
    state.data.value = value;
    state.step = 'confirm';
    return { done: false, text: `Voy a actualizar el contacto ${state.data.contact.contact_name || state.data.contact.whatsapp}.\n\nCampo: ${state.data.field}\nNuevo valor: ${value}\n\n¿Confirmás?` };
  }
  if (!isConfirm(message)) return { done: false, text: 'Respondé “Sí” para guardar o “Cancelar”.' };
  await editContact({
    identityId: state.data.identityId,
    contactId: state.data.contact.id,
    [state.data.field]: state.data.value
  });
  return { done: true, text: `Contacto actualizado correctamente en ${state.data.supplierName}.` };
}

async function initializeState(start) {
  if (start.type === 'supplier') return { type: 'supplier', step: 'name', data: {} };
  if (start.type === 'client') return { type: 'client', step: 'platform', data: {} };

  const supplier = await resolveSupplier(start.supplierName);
  if (start.type === 'addContact') {
    const contacts = await getContacts(supplier.id);
    return {
      type: 'addContact',
      step: 'contactName',
      data: {
        identityId: supplier.id,
        supplierName: supplier.display_name,
        isPrimary: contacts.length === 0
      }
    };
  }

  const contacts = await getContacts(supplier.id);
  if (!contacts.length) {
    const error = new Error('CRM_SUPPLIER_HAS_NO_CONTACTS');
    error.code = 'CRM_SUPPLIER_HAS_NO_CONTACTS';
    throw error;
  }
  if (contacts.length === 1) {
    return {
      type: 'editContact',
      step: 'field',
      data: { identityId: supplier.id, supplierName: supplier.display_name, contact: contacts[0] }
    };
  }
  return {
    type: 'editContact',
    step: 'selectContact',
    data: { identityId: supplier.id, supplierName: supplier.display_name, contacts }
  };
}

function initialPrompt(state) {
  if (state.type === 'supplier') return 'Perfecto. Decime el nombre del proveedor.';
  if (state.type === 'client') return 'Perfecto. ¿Para qué plataforma será el cliente?';
  if (state.type === 'addContact') return `Proveedor encontrado: ${state.data.supplierName}.\n¿Cuál es el nombre del nuevo contacto? Podés responder “omitir”.`;
  if (state.step === 'field') return `Proveedor encontrado: ${state.data.supplierName}.\n¿Qué querés editar: nombre, cargo/área, WhatsApp, teléfono, correo, ciudad, dirección o notas?`;
  return `Proveedor encontrado: ${state.data.supplierName}.\nElegí el contacto por número:\n${state.data.contacts.map(contactLabel).join('\n')}`;
}

async function processCrmConversation({ message, externalUserId, phone }) {
  const key = ownerKey({ externalUserId, phone });
  const states = readStates();
  let state = states[key];

  if (state && isCancel(message)) {
    delete states[key];
    writeStates(states);
    return { handled: true, completed: true, outputText: 'Proceso cancelado. No se realizó ningún cambio.' };
  }

  if (!state) {
    const start = detectCommand(message);
    if (!start) return { handled: false };
    state = await initializeState(start);
    states[key] = state;
    writeStates(states);
    return { handled: true, completed: false, outputText: initialPrompt(state) };
  }

  let result;
  if (state.type === 'supplier') result = await processSupplier(state, message);
  else if (state.type === 'client') result = await processClient(state, message);
  else if (state.type === 'addContact') result = await processAddContact(state, message);
  else result = await processEditContact(state, message);

  if (result.done) delete states[key];
  else states[key] = state;
  writeStates(states);
  return { handled: true, completed: result.done, outputText: result.text };
}

module.exports = {
  detectStart,
  detectCommand,
  isCancel,
  isConfirm,
  parseSupplierType,
  splitCategories,
  parseEditField,
  processCrmConversation
};
