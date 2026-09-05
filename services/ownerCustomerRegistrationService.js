'use strict';

const {
  createCustomer,
  searchCustomers,
  updateOwnerCustomer,
  deactivateOwnerCustomer
} = require('./ownerBusinessConnectClient');

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


function isCustomerEditRequest(message) {
  const value = normalize(message);
  return /\b(edita|editar|corrige|corregir|actualiza|actualizar|cambia|cambiar|modifica|modificar)\b/.test(value)
    && /\bcliente\b/.test(value);
}

function isCustomerDeactivateRequest(message) {
  const value = normalize(message);
  return /\b(desactiva|desactivar|archiva|archivar|retira|retirar)\b/.test(value)
    && /\bcliente\b/.test(value);
}

function customerRows(result) {
  if (Array.isArray(result?.data?.results)) return result.data.results;
  if (Array.isArray(result?.data?.customers)) return result.data.customers;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.results)) return result.results;
  return [];
}

async function resolveSingleCustomer(reference, searchCustomersImpl = searchCustomers) {
  const result = await searchCustomersImpl(reference);
  const rows = customerRows(result);

  if (!rows.length) {
    return {
      found: false,
      outputText: `No encontré un cliente oficial que coincida con “${reference}”.`
    };
  }

  if (rows.length > 1) {
    const names = rows
      .slice(0, 10)
      .map(row => {
        const customer = row?.customer || row;
        return customer?.companyName || customer?.name || customer?.customerId || customer?.id;
      })
      .filter(Boolean);

    return {
      found: false,
      ambiguous: true,
      outputText: `Encontré más de un cliente que coincide con “${reference}”: ${names.join(', ')}.`
    };
  }

  const customer = rows[0]?.customer || rows[0];

  return {
    found: true,
    customer,
    id: customer?.customerId || customer?.id
  };
}

function customerReferenceFromMessage(message) {
  const raw = String(message || '').trim();

  const id = labeledValue(raw, ['id', 'id oficial', 'customer id']);
  if (id) return id;

  const labeled = labeledValue(raw, [
    'cliente',
    'nombre',
    'empresa',
    'negocio'
  ]);
  if (labeled) return labeled;

  const match = raw.match(
    /\bcliente\s+(.+?)(?=\s+(?:nombre|empresa|negocio|whatsapp|wasap|telefono|teléfono|correo|email|direccion|dirección|ciudad|municipio)\s*:|[,.]|$)/i
  );

  return match?.[1]?.trim() || '';
}

function customerPatchFromMessage(message) {
  const raw = String(message || '').trim();
  const patch = {};

  const name = labeledValue(raw, ['nuevo nombre', 'nombre nuevo']);
  const companyName = labeledValue(raw, [
    'nueva empresa',
    'empresa nueva',
    'nuevo negocio',
    'negocio nuevo'
  ]);
  const whatsapp = labeledValue(raw, [
    'nuevo whatsapp',
    'nuevo wasap',
    'nuevo telefono',
    'nuevo teléfono',
    'nuevo celular'
  ]);
  const email = labeledValue(raw, [
    'nuevo correo',
    'nuevo email'
  ]);
  const address = labeledValue(raw, [
    'nueva direccion',
    'nueva dirección'
  ]);
  const city = labeledValue(raw, [
    'nueva ciudad',
    'nuevo municipio'
  ]);

  if (name) patch.name = name;
  if (companyName) patch.companyName = companyName;
  if (whatsapp) patch.whatsapp = whatsapp;
  if (email) patch.email = email;
  if (address) patch.address = address;
  if (city) patch.city = city;

  return patch;
}

async function processOwnerCustomerEdit({
  message,
  searchCustomersImpl = searchCustomers,
  updateOwnerCustomerImpl = updateOwnerCustomer
} = {}) {
  if (!isCustomerEditRequest(message)) return { handled: false };

  const reference = customerReferenceFromMessage(message);
  if (!reference) {
    return {
      handled: true,
      completed: false,
      outputText: 'Necesito identificar qué cliente querés editar.'
    };
  }

  const patch = customerPatchFromMessage(message);

  if (!Object.keys(patch).length) {
    return {
      handled: true,
      completed: false,
      outputText: 'Indicame qué dato querés corregir del cliente.'
    };
  }

  const resolved = await resolveSingleCustomer(reference, searchCustomersImpl);
  if (!resolved.found) {
    return {
      handled: true,
      completed: false,
      outputText: resolved.outputText
    };
  }

  const result = await updateOwnerCustomerImpl(resolved.id, patch);
  const customer = result?.data || result;

  return {
    handled: true,
    completed: true,
    customer,
    result,
    outputText: [
      '✅ Cliente actualizado correctamente.',
      `Cliente: ${customer?.name || customer?.companyName || reference}`,
      customer?.companyName ? `Empresa: ${customer.companyName}` : '',
      customer?.phone || customer?.whatsapp
        ? `WhatsApp: ${customer.phone || customer.whatsapp}`
        : '',
      customer?.email ? `Correo: ${customer.email}` : '',
      `ID oficial: ${customer?.customerId || customer?.id || resolved.id}`
    ].filter(Boolean).join('\n')
  };
}

async function processOwnerCustomerDeactivate({
  message,
  searchCustomersImpl = searchCustomers,
  deactivateOwnerCustomerImpl = deactivateOwnerCustomer
} = {}) {
  if (!isCustomerDeactivateRequest(message)) return { handled: false };

  const reference = customerReferenceFromMessage(message);

  if (!reference) {
    return {
      handled: true,
      completed: false,
      outputText: 'Necesito identificar qué cliente querés desactivar.'
    };
  }

  const resolved = await resolveSingleCustomer(reference, searchCustomersImpl);
  if (!resolved.found) {
    return {
      handled: true,
      completed: false,
      outputText: resolved.outputText
    };
  }

  const result = await deactivateOwnerCustomerImpl(resolved.id);
  const customer = result?.data || result;

  return {
    handled: true,
    completed: true,
    customer,
    result,
    outputText: [
      '✅ Cliente desactivado.',
      `Cliente: ${customer?.name || customer?.companyName || reference}`,
      `ID oficial: ${customer?.customerId || customer?.id || resolved.id}`,
      'Estado: inactive'
    ].join('\n')
  };
}

module.exports = {
  isCustomerRegistrationRequest,
  isCustomerEditRequest,
  isCustomerDeactivateRequest,
  parseCustomerRegistration,
  processOwnerCustomerRegistration,
  processOwnerCustomerEdit,
  processOwnerCustomerDeactivate,
  resolveSingleCustomer,
  formatCustomer
};
