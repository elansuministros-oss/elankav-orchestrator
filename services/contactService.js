'use strict';

const {
  findSupplier,
  listContacts,
  addContact,
  updateContact
} = require('../adapters/crmWriteAdapter');
const { normalizeWhatsappE164 } = require('./phoneService');

const normalize = value => String(value || '').trim();
const normalizePhone = value => normalize(value).replace(/\D/g, '');

function normalizeContactInput(input = {}, { partial = false } = {}) {
  const identityId = normalize(input.identityId);
  const contactId = normalize(input.contactId);

  if (!identityId) {
    throw Object.assign(new Error('CONTACT_IDENTITY_REQUIRED'), {
      code: 'CONTACT_IDENTITY_REQUIRED'
    });
  }

  const output = { identityId, contactId };
  const textFields = ['contactName', 'contactRole', 'email', 'country', 'city', 'address', 'notes'];
  for (const field of textFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(input, field)) {
      output[field] = field === 'email'
        ? normalize(input[field]).toLowerCase()
        : normalize(input[field]);
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, 'phone')) {
    output.phone = normalizePhone(input.phone);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, 'isPrimary')) {
    output.isPrimary = input.isPrimary === true;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, 'whatsapp')) {
    const whatsapp = normalizeWhatsappE164(input.whatsapp);
    if (!whatsapp) {
      throw Object.assign(new Error('CONTACT_WHATSAPP_INVALID'), {
        code: 'CONTACT_WHATSAPP_INVALID'
      });
    }
    output.whatsapp = whatsapp;
  }

  return output;
}

async function resolveSupplier(name) {
  const result = await findSupplier(normalize(name));
  return result.supplier;
}

async function getContacts(identityId) {
  const result = await listContacts(normalize(identityId));
  return result.contacts || [];
}

async function registerContact(input) {
  const result = await addContact(normalizeContactInput(input));
  return { ok: true, status: result.status, contact: result.contact };
}

async function editContact(input) {
  const contact = normalizeContactInput(input, { partial: true });
  if (!contact.contactId) {
    throw Object.assign(new Error('CONTACT_ID_REQUIRED'), {
      code: 'CONTACT_ID_REQUIRED'
    });
  }
  const result = await updateContact(contact);
  return { ok: true, status: result.status, contact: result.contact };
}

module.exports = {
  normalizeContactInput,
  resolveSupplier,
  getContacts,
  registerContact,
  editContact
};
