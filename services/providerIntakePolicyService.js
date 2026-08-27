'use strict';

const { resolveCanonicalIdentity } = require('./context/identityResolver');

const PURPOSES = Object.freeze({
  REGISTER: 'register_provider',
  CONTACT: 'contact_registered_provider',
  RESEARCH: 'research_provider',
  UNKNOWN: 'unknown'
});

function normalizeText(value) {
  return String(value || '').trim();
}

function detectOwnerPurpose(text) {
  const value = normalizeText(text).toLowerCase();
  if (!value) return PURPOSES.UNKNOWN;
  if (/registr|agreg|nuevo proveedor|dar de alta|lista de proveedores/.test(value)) return PURPOSES.REGISTER;
  if (/investig|averigu|tarif|precio|catalog|que ofrece|qué ofrece/.test(value)) return PURPOSES.RESEARCH;
  if (/escrib|contact|pregunt|cotiz|mensaje/.test(value)) return PURPOSES.CONTACT;
  return PURPOSES.UNKNOWN;
}

function resolveProviderIntake({ identity, ownerText, registeredProvider = null } = {}) {
  const canonicalIdentity = resolveCanonicalIdentity(identity);
  const purpose = detectOwnerPurpose(ownerText);

  if (purpose === PURPOSES.UNKNOWN) {
    return {
      action: 'ask_owner_intent',
      canonicalIdentity,
      registeredProvider,
      prompt: registeredProvider
        ? 'Este contacto ya está registrado como proveedor. ¿Qué necesitás que haga con él?'
        : 'Este contacto no está registrado como proveedor. ¿Querés que lo investigue, lo registre o que le escriba algo específico?'
    };
  }

  return {
    action: purpose,
    canonicalIdentity,
    registeredProvider
  };
}

function providerAiDisclosure() {
  return 'Hola. Soy ELAN, la asistente de inteligencia artificial de nuestro equipo comercial. Estoy recopilando información para evaluar una relación como proveedor y canal de reventa con su empresa.';
}

function providerDiscoveryQuestions() {
  return [
    '¿Qué productos o servicios ofrecen actualmente?',
    '¿Tienen catálogo o tarifario vigente que puedan compartir?',
    '¿En qué ciudad están ubicados y cuál es su cobertura de entrega?',
    'Trabajamos como canal comercial y revendedores. ¿Manejan precio especial para reventa o descuento sobre su precio público?',
    '¿El descuento cambia por volumen o monto de compra?',
    '¿Cuál es la compra mínima, si aplica?',
    '¿Qué condiciones de pago manejan para revendedores?',
    '¿Los precios incluyen impuestos y hasta qué fecha tienen vigencia?',
    '¿Qué tiempos de producción, preparación o entrega manejan?'
  ];
}

function providerNegotiationPolicy() {
  return Object.freeze({
    discloseAi: true,
    neverClaimHuman: true,
    businessPosition: 'reseller_and_commercial_channel',
    objectives: [
      'obtain_current_catalog',
      'obtain_public_price',
      'obtain_reseller_price',
      'obtain_volume_discount',
      'obtain_minimum_order',
      'obtain_payment_terms',
      'obtain_delivery_terms',
      'obtain_price_validity'
    ],
    prohibited: [
      'invent_price',
      'invent_discount',
      'invent_availability',
      'promise_purchase_without_owner_authorization',
      'publish_observed_price_as_official',
      'hide_ai_identity_from_provider'
    ],
    persistence: 'connect_provider_intelligence_staging',
    officialization: 'owner_approval_required'
  });
}

module.exports = {
  PURPOSES,
  detectOwnerPurpose,
  resolveProviderIntake,
  providerAiDisclosure,
  providerDiscoveryQuestions,
  providerNegotiationPolicy
};
