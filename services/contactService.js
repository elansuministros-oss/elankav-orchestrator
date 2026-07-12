'use strict';

const { addContact, updateContact } = require('../adapters/crmWriteAdapter');
const { normalizeWhatsappE164 } = require('./phoneService');

const normalize = value => String(value || '').trim();
const normalizePhone = value => normalize(value).replace(/\D/g, '');

function normalizeContactInput(input = {}) {
  const identityId = normalize(input.identityId);
  const contactId = normalize(input.contactId);
  const whatsapp = normalizeWhatsappE164(input.whatsapp);

  if (!identityId) {
    throw Object.assign(new Error('CONTACT_IDENTITY_REQUIRED'), {
      code: 'CONTACT_IDENTITY_REQUIRED'
    });
  }

  if (!whatsapp) {
    throw Object.assign(new Error('CONTACT_WHATSAPP_INVALID'), {
      code: 'CONTACT_WHATSAPP_INVALID'
    });
  }

  return {
    identityId,
    contactId,
    contactName: normalize(input.contactName),
    contactRole: normalize(input.contactRole),
    whatsapp,
    phone: normalizePhone(input.phone),
    email: normalize(input.email).toLowerCase(),
    country: normalize(input.country),
    city: normalize(input.city),
    address: normalize(input.address),
    notes: normalize(input.notes),
    isPrimary: input.isPrimary === true
  };
}

async function registerContact(input) {
  const result = await addContact(normalizeContactInput(input));
  return { ok: true, status: result.status, contact: result.contact };
}

async function editContact(input) {
  const contact = normalizeContactInput(input);
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
  registerContact,
  editContact
};
