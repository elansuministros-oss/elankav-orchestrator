'use strict';

const DELIVERY_METHODS = Object.freeze({
  PICKUP: 'PICKUP',
  DELIVERY: 'DELIVERY',
  INSTALLATION: 'INSTALLATION',
  CARRIER: 'CARRIER'
});

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function resolveDeliveryMethod(input = {}) {
  if (input.deliveryMethod && Object.values(DELIVERY_METHODS).includes(String(input.deliveryMethod).toUpperCase())) {
    return String(input.deliveryMethod).toUpperCase();
  }
  const text = normalize(input.text || input.description || '');
  if (/\b(instalad[oa]|instalacion|montaje)\b/.test(text)) return DELIVERY_METHODS.INSTALLATION;
  if (/\b(delivery|entrega a domicilio|entregar|entrega)\b/.test(text)) return DELIVERY_METHODS.DELIVERY;
  if (/\b(cargo\s*trans|transportista|encomienda|envio por|enviar por)\b/.test(text)) return DELIVERY_METHODS.CARRIER;
  if (/\b(retira|retiro|recoge|recoger|taller)\b/.test(text)) return DELIVERY_METHODS.PICKUP;
  return input.requiresInstallation ? DELIVERY_METHODS.INSTALLATION : null;
}

function hasLocation(input = {}) {
  return Boolean(
    String(input.installationAddress || input.deliveryAddress || input.destination || '').trim() ||
    (Number.isFinite(Number(input.latitude)) && Number.isFinite(Number(input.longitude)))
  );
}

function resolveMissingRequirements(input = {}) {
  const missing = [];
  const deliveryMethod = resolveDeliveryMethod(input);

  if (!Number.isFinite(Number(input.width)) || Number(input.width) <= 0) missing.push('width');
  if (!Number.isFinite(Number(input.height)) || Number(input.height) <= 0) missing.push('height');
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) missing.push('quantity');

  if ([DELIVERY_METHODS.INSTALLATION, DELIVERY_METHODS.DELIVERY, DELIVERY_METHODS.CARRIER].includes(deliveryMethod) && !hasLocation(input)) {
    missing.push('location');
  }

  if (deliveryMethod === DELIVERY_METHODS.CARRIER && !String(input.carrier || '').trim()) {
    missing.push('carrier');
  }

  return Object.freeze({
    deliveryMethod,
    missing: Object.freeze(missing),
    complete: missing.length === 0
  });
}

function nextQuestion(result) {
  if (!result || result.complete) return null;
  const field = result.missing[0];
  if (field === 'location') {
    if (result.deliveryMethod === DELIVERY_METHODS.INSTALLATION) return '¿Dónde se realizará la instalación? Podés escribir la dirección o compartir la ubicación por WhatsApp.';
    if (result.deliveryMethod === DELIVERY_METHODS.DELIVERY) return '¿Dónde se realizará la entrega? Podés escribir la dirección o compartir la ubicación por WhatsApp.';
    return '¿Cuál es la ciudad o ubicación de destino del envío?';
  }
  if (field === 'carrier') return '¿Qué transportista se utilizará para el envío?';
  if (field === 'width' || field === 'height') return '¿Cuál es la medida exacta del trabajo?';
  if (field === 'quantity') return '¿Qué cantidad necesitás cotizar?';
  return 'Necesito un dato adicional para completar la cotización.';
}

function buildLogisticsRequest(input = {}) {
  const requirements = resolveMissingRequirements(input);
  if (!requirements.complete) {
    return Object.freeze({ ready: false, requirements, question: nextQuestion(requirements) });
  }

  return Object.freeze({
    ready: true,
    requirements,
    logistics: Object.freeze({
      method: requirements.deliveryMethod || DELIVERY_METHODS.PICKUP,
      origin: input.origin || null,
      destination: input.installationAddress || input.deliveryAddress || input.destination || null,
      coordinates: Number.isFinite(Number(input.latitude)) && Number.isFinite(Number(input.longitude))
        ? Object.freeze({ latitude: Number(input.latitude), longitude: Number(input.longitude) })
        : null,
      carrier: input.carrier || null,
      trips: Math.max(1, Number(input.trips) || 1),
      requiresRoadDistance: [DELIVERY_METHODS.INSTALLATION, DELIVERY_METHODS.DELIVERY].includes(requirements.deliveryMethod),
      requiresCarrierRate: requirements.deliveryMethod === DELIVERY_METHODS.CARRIER
    })
  });
}

module.exports = {
  DELIVERY_METHODS,
  buildLogisticsRequest,
  nextQuestion,
  resolveDeliveryMethod,
  resolveMissingRequirements
};
