'use strict';

const business = require('./ownerBusinessCommandService');

const ORIGINAL_DETECT = business.detectOwnerBusinessCommand;
const ORIGINAL_EXECUTE = business.executeOwnerBusinessCommand;
const CUSTOMER_LIST = business.BUSINESS_COMMANDS.CUSTOMER_LIST;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const FIELD_RULES = Object.freeze([
  ['name', /\b(nombre|nombres|cliente|clientes)\b/],
  ['phone', /\b(telefono|telefonos|whatsapp|wasap|celular|celulares)\b/],
  ['companyName', /\b(empresa|empresas|negocio|negocios|compania|companias)\b/],
  ['email', /\b(correo|correos|email|emails)\b/],
  ['city', /\b(ciudad|ciudades|municipio|municipios)\b/],
  ['address', /\b(direccion|direcciones|domicilio|domicilios)\b/],
  ['taxId', /\b(ruc|documento|documentos|identificacion)\b/],
  ['platform', /\b(plataforma|plataformas)\b/],
  ['attention', /\b(atencion|contacto|contactos)\b/]
]);

function requestedCustomerFields(message) {
  const normalized = normalize(message);
  const fields = FIELD_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([field]) => field);

  // "clientes" is needed to identify the entity but should not force a detailed
  // response by itself. Name becomes explicit only when the owner asks for it or
  // when another profile field was requested.
  const explicitName = /\b(nombre|nombres)\b/.test(normalized);
  const profileFields = fields.filter(field => field !== 'name');
  if (!explicitName && profileFields.length === 0) return [];

  return Array.from(new Set(['name', ...profileFields]));
}

function detectOwnerBusinessCommand(message) {
  const command = ORIGINAL_DETECT(message);
  if (!command || command.type !== CUSTOMER_LIST) return command;

  const requestedFields = requestedCustomerFields(message);
  if (!requestedFields.length) return command;

  return Object.freeze({
    ...command,
    requestedFields
  });
}

function customerDisplayName(customer) {
  return String(
    customer?.name ||
    customer?.companyName ||
    customer?.displayName ||
    'Sin nombre'
  ).trim();
}

const FIELD_LABELS = Object.freeze({
  phone: 'Teléfono',
  companyName: 'Empresa',
  email: 'Correo',
  city: 'Ciudad',
  address: 'Dirección',
  taxId: 'Documento / RUC',
  platform: 'Plataforma',
  attention: 'Atención'
});

function customerFieldValue(customer, field) {
  if (field === 'name') return customerDisplayName(customer);
  if (field === 'phone') return customer?.phone || customer?.whatsapp || '';
  return customer?.[field] || '';
}

function formatDetailedCustomerList(result, requestedFields) {
  const rawRows = Array.isArray(result?.data?.results)
    ? result.data.results
    : [];

  const customers = rawRows
    .map(row => row?.customer || row)
    .filter(Boolean)
    .sort((a, b) => customerDisplayName(a).localeCompare(
      customerDisplayName(b),
      'es',
      { sensitivity: 'base' }
    ));

  const count = Number(result?.data?.count ?? customers.length);
  const header = `Clientes oficiales registrados: ${count}`;
  if (!customers.length) return 'No hay clientes oficiales registrados en CONNECT.';

  const fields = Array.from(new Set(['name', ...(requestedFields || [])]));
  const blocks = customers.map((customer, index) => {
    const lines = [`${index + 1}. ${customerDisplayName(customer)}`];

    for (const field of fields) {
      if (field === 'name') continue;
      const label = FIELD_LABELS[field] || field;
      const value = customerFieldValue(customer, field);
      lines.push(`   ${label}: ${value || 'No registrado'}`);
    }

    return lines.join('\n');
  });

  return [header, '', ...blocks].join('\n\n');
}

async function executeOwnerBusinessCommand(command) {
  const response = await ORIGINAL_EXECUTE(command);

  if (
    command?.type === CUSTOMER_LIST &&
    Array.isArray(command.requestedFields) &&
    command.requestedFields.length > 0 &&
    response?.handled
  ) {
    return {
      ...response,
      outputText: formatDetailedCustomerList(
        response.result,
        command.requestedFields
      )
    };
  }

  return response;
}

business.detectOwnerBusinessCommand = detectOwnerBusinessCommand;
business.executeOwnerBusinessCommand = executeOwnerBusinessCommand;

module.exports = {
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  formatDetailedCustomerList,
  requestedCustomerFields
};
