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

function isAuthorizedInline(message) {
  const value = normalizeCommand(message);
  return /\b(hazlo|hacelo|ejecuta|ejecutalo|guardalo|registralo|actualizalo|crealo|confirmame cuando|deja guardado|procede)\b/.test(value);
}

function parseEmail(message) {
  const match = normalize(message).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0].toLowerCase() : '';
}

function parseWhatsapp(message) {
  const matches = normalize(message).match(/(?:\+?505[\s().-]*)?\d{4}[\s.-]*\d{4}/g) || [];
  return matches.map(value => normalizeWhatsappE164(value)).find(Boolean) || '';
}

function extractField(message, labels) {
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = normalize(message).match(new RegExp(`(?:${escaped})(?:\\s+es)?\\s*[:,-]?\\s*([^.;\\n]+)`, 'i'));
  return match ? normalize(match[1]) : '';
}

function parseCategories(message) {
  const raw = normalize(message);
  const match = raw.match(/(?:vende|venden|ofrece|ofrecen|materiales|productos|categorias?)\s*[:,-]?\s*(.+?)(?:\.|\n|\b(?:contacto|whatsapp|telefono|correo|email|guardalo|hazlo|ejecuta)\b|$)/i);
  if (!match) return [];
  return match[1].split(/,|\s+y\s+/i).map(item => normalize(item)).filter(Boolean);
}

function parsePlatform(message) {
  const value = normalizeCommand(message);
  const platforms = ['elanvisual', 'elanpet', 'elancenter', 'elanhome', 'elantransporte', 'elankav'];
  return platforms.find(platform => value.includes(platform)) || '';
}

function parseSupplierName(message) {
  const raw = normalize(message);
  const patterns = [
    /(?:actualizar|actualiza|modificar|modifica|cambiar|cambia)(?:\s+los datos|\s+el contacto)?(?:\s+de|\s+del|\s+al|\s+el)?\s+proveedor\s+([^.;\n]+)/i,
    /(?:agregar|agrega|crear|registrar|registra)\s+(?:este\s+)?proveedor\s*[:,-]?\s*([^.;\n]+)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return normalize(match[1]).replace(/\b(?:contacto|whatsapp|telefono|correo|email|vende|venden|ofrece|ofrecen)\b.*$/i, '').trim();
    }
  }
  return '';
}

function parseContactSupplierName(message) {
  const raw = normalize(message);
  const match = raw.match(/(?:agregar|agrega|crear|registrar|registra)\s+(?:este\s+)?contacto\s+(?:a|para|en)\s+([^:;,.\n]+)/i);
  return match ? normalize(match[1]) : '';
}

function parseClientName(message) {
  const raw = normalize(message);
  const match = raw.match(/(?:agregar|agrega|crear|registrar|registra)\s+(?:este\s+)?cliente\s*[:,-]?\s*([^.;\n]+)/i);
  if (!match) return '';
  return normalize(match[1]).replace(/\b(?:whatsapp|telefono|correo|email|plataforma)\b.*$/i, '').trim();
}

function parseContactName(message) {
  return extractField(message, ['nombre del contacto', 'contacto', 'nombre']);
}

function parseContactRole(message) {
  return extractField(message, ['cargo', 'area', 'área', 'rol']);
}

function detectCommand(message) {
  const raw = normalize(message);
  const value = normalizeCommand(raw);

  const supplierUpdateName = parseSupplierName(raw);
  if (/\b(actualizar|actualiza|modificar|modifica|cambiar|cambia)\b/.test(value) && supplierUpdateName) {
    return { type: 'supplierUpdate', supplierName: supplierUpdateName, inline: true };
  }

  const contactSupplierName = parseContactSupplierName(raw);
  if (contactSupplierName) {
    return { type: 'addContact', supplierName: contactSupplierName, inline: true };
  }

  let match = value.match(/^(?:agregar|agrega|anadir|crear) contacto (?:a|para) (.+)$/);
  if (match) return { type: 'addContact', supplierName: match[1].trim() };

  match = value.match(/^(?:editar|edita) contacto (?:de|del|en) (.+)$/);
  if (match) return { type: 'editContact', supplierName: match[1].trim() };

  if (/(crear|agregar|registrar).*(proveedor)/.test(value) || value.includes('quiero agregar un proveedor')) {
    return { type: 'supplier', inline: true };
  }

  if (/(crear|agregar|registrar).*(cliente)/.test(value) || value.includes('quiero agregar un cliente')) {
    return { type: 'client', inline: true };
  }

  if (/(crear|agregar|registrar).*(trabajador|empleado|colaborador)/.test(value)) {
    return { type: 'unsupported', entity: 'trabajador' };
  }

  return null;
}

function detectStart(message) {
  const command = detectCommand(message);
  return command ? command.type : null;
}

const isCancel = message => {
  const value = normalizeCommand(message).replace(/[.!?]+$/g, '').trim();
  return new Set([
    'cancelar', 'cancela', 'cancelalo', 'cancelala', 'detener', 'deten', 'parar',
    'no guardar', 'cancelar esta conversacion', 'cancelar conversacion',
    'cancelar este proceso', 'detener este proceso', 'deja eso', 'dejalo',
    'olvida eso', 'olvidalo', 'cambiar de tema', 'cambiemos de tema'
  ]).has(value) || /^(cancelar|cancela|deten|detener|parar|deja|olvida)\b/.test(value);
};

const isConfirm = message => {
  const value = normalizeCommand(message).replace(/[.!?]+$/g, '').trim();
  return new Set([
    'si', 'confirmo', 'guardar', 'proceder', 'confirmar', 'hazlo', 'hacelo',
    'dale', 'correcto', 'si hazlo', 'si hacelo', 'si eso quiero', 'eso quiero',
    'si confirmo', 'procede'
  ]).has(value);
};

const isSkip = message => /^(omitir|saltar|ninguno|no)$/i.test(normalize(message));

function parseSupplierType(message) {
  const value = normalizeCommand(message);
  if (/mixt|ambas|material.*servicio/.test(value)) return 'mixed';
  if (/servicio/.test(value)) return 'services';
  if (/material|materia prima|ferreter|vinil|lona|acrilico|pvc|coroplast/.test(value)) return 'materials';
  return '';
}

function splitCategories(message) {
  return normalize(message).split(/,| y /i).map(item => item.trim()).filter(Boolean);
}

function ownerKey({ externalUserId, phone }) {
  return normalize(externalUserId) || normalize(phone) || 'owner';
}

function parseSupplierPayload(message) {
  return {
    name: parseSupplierName(message),
    supplierType: parseSupplierType(message),
    categories: parseCategories(message),
    contactName: parseContactName(message),
    contactRole: parseContactRole(message),
    whatsapp: parseWhatsapp(message),
    phone: parseWhatsapp(message),
    email: parseEmail(message),
    country: /\bnacional\b/i.test(message) ? 'Nicaragua' : ''
  };
}

function parseContactPayload(message) {
  return {
    contactName: parseContactName(message),
    contactRole: parseContactRole(message),
    whatsapp: parseWhatsapp(message),
    phone: parseWhatsapp(message),
    email: parseEmail(message),
    country: /\bnacional\b/i.test(message) ? 'Nicaragua' : ''
  };
}

function parseClientPayload(message) {
  const whatsapp = parseWhatsapp(message);
  return {
    platform: parsePlatform(message),
    name: parseClientName(message),
    phone: whatsapp,
    whatsapp,
    email: parseEmail(message)
  };
}

function hasSupplierPayload(payload) {
  return Boolean(payload.name && payload.supplierType && payload.categories.length && payload.whatsapp);
}

function hasContactPayload(payload) {
  return Boolean(payload.contactName && payload.whatsapp);
}

function hasClientPayload(payload) {
  return Boolean(payload.platform && payload.name && payload.whatsapp);
}

async function executeSupplierInline(message) {
  const payload = parseSupplierPayload(message);
  if (!hasSupplierPayload(payload)) return null;
  await registerSupplier(payload);
  return { done: true, text: `Proveedor registrado y verificado.\n\nNombre: ${payload.name}\nWhatsApp: ${payload.whatsapp}` };
}

async function executeContactInline(supplier, message) {
  const payload = parseContactPayload(message);
  if (!hasContactPayload(payload)) return null;
  const contacts = await getContacts(supplier.id);
  const result = await registerContact({
    identityId: supplier.id,
    ...payload,
    isPrimary: contacts.length === 0
  });
  const saved = result.contact || payload;
  return {
    done: true,
    text: `Contacto registrado y verificado en ${supplier.display_name}.\n\nNombre: ${saved.contact_name || saved.contactName || payload.contactName}\nWhatsApp: ${saved.whatsapp || payload.whatsapp}\nCorreo: ${saved.email || payload.email || 'No indicado'}`
  };
}

function contactNameOf(contact = {}) {
  return normalize(contact.contact_name || contact.contactName);
}

function contactWhatsappOf(contact = {}) {
  return normalizeWhatsappE164(contact.whatsapp || contact.phone);
}

function findSupplierContact(contacts, payload) {
  const expectedPhone = normalizeWhatsappE164(payload.whatsapp);
  const expectedName = normalizeCommand(payload.contactName);
  if (expectedPhone) {
    const found = contacts.find(contact => contactWhatsappOf(contact) === expectedPhone);
    if (found) return found;
  }
  if (expectedName) {
    const found = contacts.find(contact => normalizeCommand(contactNameOf(contact)) === expectedName);
    if (found) return found;
  }
  if (contacts.length === 1) return contacts[0];
  return null;
}

async function executeSupplierUpdateInline(supplier, message) {
  const payload = parseContactPayload(message);
  if (!payload.contactName && !payload.whatsapp && !payload.email) return null;
  const contacts = await getContacts(supplier.id);
  const existing = findSupplierContact(contacts, payload);
  let operation;
  let saved;

  if (existing) {
    const update = { identityId: supplier.id, contactId: existing.id };
    if (payload.contactName) update.contactName = payload.contactName;
    if (payload.contactRole) update.contactRole = payload.contactRole;
    if (payload.whatsapp) {
      update.whatsapp = payload.whatsapp;
      update.phone = payload.phone;
    }
    if (payload.email) update.email = payload.email;
    if (payload.country) update.country = payload.country;
    const result = await editContact(update);
    saved = result.contact || { ...existing, ...update };
    operation = 'actualizado';
  } else {
    if (!payload.whatsapp) return null;
    const result = await registerContact({
      identityId: supplier.id,
      ...payload,
      isPrimary: contacts.length === 0
    });
    saved = result.contact || payload;
    operation = 'creado';
  }

  return {
    done: true,
    text: `Listo. El contacto de ${supplier.display_name} fue ${operation} y verificado en el CRM.\n\nNombre: ${saved.contact_name || saved.contactName || payload.contactName || 'No indicado'}\nWhatsApp: ${saved.whatsapp || payload.whatsapp || 'No indicado'}\nCorreo: ${saved.email || payload.email || 'No indicado'}`
  };
}

async function executeClientInline(message) {
  const payload = parseClientPayload(message);
  if (!hasClientPayload(payload)) return null;
  const responsibleCommercialId = normalize(process.env.CRM_DEFAULT_ADMIN_IDENTITY_ID);
  if (!responsibleCommercialId) throw Object.assign(new Error('CRM_DEFAULT_ADMIN_IDENTITY_ID_NOT_CONFIGURED'), { code: 'CRM_DEFAULT_ADMIN_IDENTITY_ID_NOT_CONFIGURED' });
  await registerClient({ ...payload, responsibleCommercialId });
  return { done: true, text: `Cliente registrado y verificado.\n\nNombre: ${payload.name}\nPlataforma: ${payload.platform.toUpperCase()}\nWhatsApp: ${payload.whatsapp}` };
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
  if (start.type === 'supplierUpdate') {
    return {
      type: 'supplierUpdate',
      step: 'details',
      data: { identityId: supplier.id, supplierName: supplier.display_name }
    };
  }
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
  if (state.type === 'supplierUpdate') return `Perfecto. Tengo identificado al proveedor ${state.data.supplierName}. Enviame el nombre del contacto, WhatsApp y correo que querés actualizar.`;
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

    if (start.type === 'unsupported') {
      return {
        handled: true,
        completed: true,
        outputText: `La entidad ${start.entity} todavía no tiene Service y Adapter de escritura autorizados. No ejecuté ningún cambio.`
      };
    }

    if (start.inline && isAuthorizedInline(message)) {
      let inlineResult = null;
      if (start.type === 'supplier') inlineResult = await executeSupplierInline(message);
      else if (start.type === 'client') inlineResult = await executeClientInline(message);
      else {
        const supplier = await resolveSupplier(start.supplierName);
        if (start.type === 'addContact') inlineResult = await executeContactInline(supplier, message);
        else if (start.type === 'supplierUpdate') inlineResult = await executeSupplierUpdateInline(supplier, message);
      }
      if (inlineResult) {
        return { handled: true, completed: true, outputText: inlineResult.text };
      }
    }

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
  isAuthorizedInline,
  parseSupplierType,
  splitCategories,
  parseEditField,
  parseSupplierPayload,
  parseContactPayload,
  parseClientPayload,
  processCrmConversation
};
