'use strict';

const { createCustomer } = require('./ownerBusinessConnectClient');

function normalize(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function labeledValue(message, labels) {
  const lines = String(message || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const normalized = normalize(line);

    for (const label of labels) {
      const prefix = `${normalize(label)}:`;
      if (normalized.startsWith(prefix)) {
        return line.slice(line.indexOf(':') + 1).trim();
      }
    }
  }

  return '';
}

function isCustomerRegistrationRequest(message) {
  const value = normalize(message);
  if (!value) return false;

  const action =
    /\b(registra|registrar|crea|crear|agrega|agregar|carga|cargar|alta)\b/.test(value);

  const customer = /\bcliente\b/.test(value);

  return action && customer;
}

function parseCustomerRegistration(message) {
  if (!isCustomerRegistrationRequest(message)) return null;

  const raw = String(message || '').trim();

  let name = labeledValue(raw, [
    'nombre',
    'nombre del cliente',
    'cliente'
  ]);

  const companyName = labeledValue(raw, [
    'empresa',
    'negocio',
    'compañía',
    'compania',
    'razón social',
    'razon social'
  ]);

  const whatsapp = labeledValue(raw, [
    'whatsapp',
    'wasap',
    'teléfono',
    'telefono',
    'celular'
  ]);

  const address = labeledValue(raw, [
    'dirección',
    'direccion'
  ]);

  const city = labeledValue(raw, [
    'ciudad',
    'municipio'
  ]);

  let email = labeledValue(raw, [
    'correo',
    'email',
    'correo electrónico',
    'correo electronico'
  ]);

  if (!email) {
    const emailMatch = raw.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    );
    if (emailMatch) email = emailMatch[0].toLowerCase();
  }

  if (!name && !companyName) {
    const inline = raw.match(
      /\bcliente\s+(.+?)(?=\s+(?:whatsapp|wasap|telefono|teléfono|celular|correo|email|empresa|negocio|direccion|dirección|ciudad|municipio)\b|[,.]|$)/i
    );

    if (inline?.[1]) {
      const candidate = inline[1].trim();

      if (
        candidate &&
        !/^(?:para|nuevo|nueva|este|esta|un|una|en)\b/i.test(candidate)
      ) {
        name = candidate;
      }
    }
  }

  if (!name && companyName) name = companyName;

  return {
    type: 'business_customer_create',
    input: {
      ...(name ? { name } : {}),
      ...(companyName ? { companyName } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      ...(email ? { email } : {}),
      ...(address ? { address } : {}),
      ...(city ? { city } : {})
    }
  };
}

function formatCustomer(customer, idempotent = false) {
  return [
    idempotent
      ? '✅ El cliente ya existía; reutilicé el registro oficial.'
      : '✅ Cliente registrado correctamente.',
    `Cliente: ${customer?.name || customer?.companyName || 'Sin nombre'}`,
    customer?.companyName &&
    customer.companyName !== customer?.name
      ? `Empresa: ${customer.companyName}`
      : '',
    customer?.phone || customer?.whatsapp
      ? `WhatsApp: ${customer.phone || customer.whatsapp}`
      : '',
    customer?.email
      ? `Correo: ${customer.email}`
      : '',
    customer?.address
      ? `Dirección: ${customer.address}`
      : '',
    customer?.city
      ? `Ciudad: ${customer.city}`
      : '',
    customer?.customerId || customer?.id
      ? `ID oficial: ${customer.customerId || customer.id}`
      : ''
  ].filter(Boolean).join('\n');
}

async function processOwnerCustomerRegistration({
  message,
  createCustomerImpl = createCustomer
} = {}) {
  const command = parseCustomerRegistration(message);

  if (!command) {
    return { handled: false };
  }

  if (!command.input?.name && !command.input?.companyName) {
    return {
      handled: true,
      completed: false,
      outputText: 'Necesito el nombre del cliente o de la empresa.'
    };
  }

  const result = await createCustomerImpl(command.input);
  const customer = result?.data || result;

  return {
    handled: true,
    completed: true,
    command,
    customer,
    result,
    outputText: formatCustomer(
      customer,
      Boolean(result?.idempotent)
    )
  };
}

module.exports = {
  isCustomerRegistrationRequest,
  parseCustomerRegistration,
  processOwnerCustomerRegistration,
  formatCustomer
};
