'use strict';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const PROVIDER_PATTERNS = [
  /\b(somos|soy|represento)\s+(proveedor(?:es)?|distribuidor(?:es)?|fabricante(?:s)?|importador(?:es)?|mayorista(?:s)?)/,
  /\b(quiero|queremos|quisiera|quisieramos)\s+(ser|ofrecer(?:les)?|vender(?:les)?|suministrar(?:les)?)\b/,
  /\b(ofrecemos|vendemos|distribuimos|fabricamos|importamos|suministramos)\b/,
  /\b(catalogo|lista de precios|tarifario|precios mayoristas|precio de distribuidor)\b/,
  /\b(proveedor|proveedores)\b.*\b(productos|servicios|materiales|insumos|catalogo|precios)\b/,
  /\b(productos|servicios|materiales|insumos|catalogo|precios)\b.*\b(proveedor|proveedores)\b/
];

const BUYER_PATTERNS = [
  /\b(necesito|necesitamos|quiero|queremos|quisiera|quisieramos)\b.*\b(cotizar|cotizacion|presupuesto|precio|comprar|hacer|fabricar|instalar)\b/,
  /\b(cotizar|cotizacion|presupuesto)\b.*\b(rotulo|rotulos|letras|vinil|impresion|publicidad|senalizacion|acrilico|fachada|banner|lona|display)\b/,
  /\b(cuanto (cuesta|vale)|que precio|precio de)\b/,
  /\b(me interesa|nos interesa)\b.*\b(servicio|rotulo|rotulos|publicidad|impresion|senalizacion|letras|vinil)\b/
];

function knownRole(actor) {
  if (!actor || actor.resolutionStatus === 'not_found') return null;
  const role = normalize(actor.role);
  if (['provider', 'customer', 'seller', 'family', 'owner', 'prospect'].includes(role)) return role;
  return null;
}

function classifyInboundCommercialRelationship({ message, actor } = {}) {
  const role = knownRole(actor);
  if (role) {
    return {
      kind: role === 'provider' ? 'provider' : role === 'prospect' ? 'buyer_prospect' : role,
      source: 'known_identity',
      confidence: 'high',
      role
    };
  }

  const text = normalize(message);
  if (!text) return { kind: 'ambiguous', source: 'message', confidence: 'low', role: null };

  const provider = PROVIDER_PATTERNS.some(pattern => pattern.test(text));
  const buyer = BUYER_PATTERNS.some(pattern => pattern.test(text));

  if (provider && !buyer) return { kind: 'provider_candidate', source: 'message', confidence: 'high', role: null };
  if (buyer && !provider) return { kind: 'buyer_prospect', source: 'message', confidence: 'high', role: null };
  if (provider && buyer) return { kind: 'ambiguous', source: 'message', confidence: 'medium', role: null };
  return { kind: 'ambiguous', source: 'message', confidence: 'low', role: null };
}

function clarificationMessage() {
  return 'Con gusto. Para atenderte correctamente, ¿nos escribís porque necesitás alguno de nuestros servicios de ELANVISUAL o porque querés ofrecernos productos o servicios como proveedor?';
}

function providerCandidateMessage() {
  return 'Gracias por contactarnos. Entiendo que nos escribís como posible proveedor de ELANVISUAL. Podés enviarme el nombre de tu empresa y, si lo tenés disponible, catálogo, lista de precios o tarifas, disponibilidad, tiempos de entrega y datos de contacto comercial. Lo revisaré como relación de proveedor, no como solicitud de compra.';
}

module.exports = {
  classifyInboundCommercialRelationship,
  clarificationMessage,
  providerCandidateMessage
};
