'use strict';

const providerServiceCostService = require('./providerServiceCostService');

const clean = value => String(value || '').trim();
const number = value => Number(String(value || '').replace(',', '.'));

function field(text, label) {
  const raw = String(text || '');

  // Formato original multilínea.
  const lineMatch = raw.match(
    new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im')
  );
  if (lineMatch) return clean(lineMatch[1]);

  // WhatsApp Owner pasa por normalizeOwnerLanguage(), que aplana
  // el mensaje a una sola línea. Detectar el valor hasta el
  // siguiente campo estructurado.
  const escapeRegex = value =>
    String(value || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');

  const normalizedLabel = escapeRegex(label);

  const knownLabels = [
    'proveedor',
    'servicio',
    'material',
    'unidad',
    'pedido minimo',
    'pedido mínimo',
    'permanencia maxima instalada',
    'permanencia máxima instalada',
    'costos del proveedor'
  ]
    .filter(item => item.toLowerCase() !== String(label || '').toLowerCase())
    .map(escapeRegex)
    .join('|');

  const flatMatch = raw.match(
    new RegExp(
      `\\b${normalizedLabel}\\s*:\\s*(.+?)(?=\\s+(?:${knownLabels})\\s*:|$)`,
      'i'
    )
  );

  return flatMatch ? clean(flatMatch[1]) : '';
}

function isProviderServiceRegistrationRequest(message) {
  const text = clean(message).toLowerCase();

  return (
    /\b(proveedor|provedor)\b/.test(text) &&
    /\b(servicio|costos?\s+del\s+proveedor)\b/.test(text) &&
    /\b(registra|registrar|agrega|agregar|aplica|aplicar)\b/.test(text)
  );
}

function extractProvider(message) {
  const match = message.match(
    /proveedor\s+(.+?)\s+para\s+(?:ELANVISUAL|ELANHOME|ELANPET|ELANCENTER|ELANKAV)\b/i
  );

  if (match) return clean(match[1]);

  const labeled = field(message, 'Proveedor');
  return labeled || '';
}

function extractPlatform(message) {
  const match = message.match(/\b(ELANVISUAL|ELANHOME|ELANPET|ELANCENTER|ELANKAV)\b/i);
  return match ? match[1].toUpperCase() : 'ELANVISUAL';
}

function extractMinimum(message) {
  const match = message.match(/pedido\s+m[ií]nimo\s*:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function extractInstalledDays(message) {
  const match = message.match(
    /permanencia\s+m[aá]xima\s+instalada\s*:\s*(\d+)\s*d[ií]as/i
  );
  return match ? Number(match[1]) : undefined;
}

function moneyMatch(message, pattern) {
  const match = message.match(pattern);
  if (!match) return null;

  const amount = number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseProviderServiceRegistration(message) {
  const provider = extractProvider(message);
  const serviceName = field(message, 'Servicio');
  const material = field(message, 'Material');
  const minimumQuantity = extractMinimum(message);
  const maxInstalledDays = extractInstalledDays(message);
  const platform = extractPlatform(message);

  const costs = [];

  const fabrication = moneyMatch(
    message,
    /fabricaci[oó]n\s+de\s+manta[^]*?USD\s*([0-9]+(?:[.,][0-9]+)?)[^.\n]*por\s+manta/i
  );
  if (fabrication) {
    costs.push({
      code: 'FABRICACION_MANTA',
      name: 'Fabricación de manta',
      amount: fabrication,
      currency: 'USD',
      basis: 'per_unit',
      unit: 'manta'
    });
  }

  const permit = moneyMatch(
    message,
    /gesti[oó]n\s+de\s+permiso[^]*?USD\s*([0-9]+(?:[.,][0-9]+)?)/i
  );
  if (permit) {
    costs.push({
      code: 'PERMISO_ALCALDIA',
      name: 'Gestión de permiso de Alcaldía',
      amount: permit,
      currency: 'USD',
      basis: 'per_transaction',
      unit: 'trámite'
    });
  }

  const tax = moneyMatch(
    message,
    /impuesto\s+municipal[^]*?USD\s*([0-9]+(?:[.,][0-9]+)?)[^.\n]*por\s+manta/i
  );
  if (tax) {
    costs.push({
      code: 'IMPUESTO_MUNICIPAL',
      name: 'Impuesto municipal',
      amount: tax,
      currency: 'USD',
      basis: 'per_unit',
      unit: 'manta'
    });
  }

  const removal = moneyMatch(
    message,
    /desinstalaci[oó]n[^]*?USD\s*([0-9]+(?:[.,][0-9]+)?)[^.\n]*por\s+manta/i
  );
  if (removal) {
    costs.push({
      code: 'DESINSTALACION',
      name: 'Desinstalación',
      amount: removal,
      currency: 'USD',
      basis: 'per_unit',
      unit: 'manta'
    });
  }

  const km = moneyMatch(
    message,
    /fuera\s+de\s+managua[^]*?USD\s*([0-9]+(?:[.,][0-9]+)?)[^.\n]*por\s*km/i
  );
  if (km) {
    costs.push({
      code: 'LOGISTICA_KM',
      name: 'Logística fuera de Managua',
      amount: km,
      currency: 'USD',
      basis: 'per_unit',
      unit: 'km'
    });
  }

  return {
    provider,
    platform,
    serviceName,
    ...(material ? { material } : {}),
    ...(minimumQuantity ? { minimumQuantity } : {}),
    ...(maxInstalledDays ? { maxInstalledDays } : {}),
    costs
  };
}

async function processOwnerProviderServiceRegistration({ message } = {}) {
  if (!isProviderServiceRegistrationRequest(message)) {
    return { handled: false };
  }

  const data = parseProviderServiceRegistration(message);

  if (!data.provider) {
    return {
      handled: true,
      completed: false,
      outputText: 'Necesito el nombre del proveedor.'
    };
  }

  if (!data.serviceName) {
    return {
      handled: true,
      completed: false,
      outputText: 'Necesito el nombre del servicio del proveedor.'
    };
  }

  if (!data.costs.length) {
    return {
      handled: true,
      completed: false,
      outputText: 'No encontré costos válidos para registrar.'
    };
  }

  const result =
    await providerServiceCostService.registerProviderServiceCost(data);

  return {
    handled: true,
    completed: true,
    result,
    outputText:
      `✅ Servicio aplicado al proveedor ${result.provider?.tradeName || data.provider}.\n` +
      `Servicio: ${data.serviceName}\n` +
      `Costos registrados: ${data.costs.length}.`
  };
}

module.exports = {
  isProviderServiceRegistrationRequest,
  parseProviderServiceRegistration,
  processOwnerProviderServiceRegistration
};
