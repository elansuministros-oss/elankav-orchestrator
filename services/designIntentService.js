'use strict';

function normalizeDesignIntentText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const DESIGN_ACTION_PATTERNS = Object.freeze([
  /\b(hace|hacer|haceme|haz|hazme|disena|disename|disenar|crea|creame|crear)\b.*\b(diseno|render|fachada|rotulo|logo|interior|espacio|propuesta)\b/,
  /\b(quiero|necesito|quisiera|ocupo)\b.*\b(diseno|render|propuesta visual|fachada|rotulo|logo)\b/,
  /\b(mostra|mostrame|muestrame|visualiza|visualizame)\b.*\b(como quedaria|resultado|fachada|rotulo|espacio)\b/,
  /\b(render|renderiza|renderizame)\b/,
  /\b(propuesta de diseno|propuesta visual)\b/
]);

const DESIGN_EXCLUSION_PATTERNS = Object.freeze([
  /\bque es\b.*\bdiseno\b/,
  /\bcuanto cuesta\b.*\bdisenador\b/,
  /\b(problema|error|bug)\b.*\bdiseno\b.*\b(sistema|pagina|app|codigo)\b/
]);

function detectDesignIntent(message) {
  const normalized = normalizeDesignIntentText(message);

  if (!normalized) {
    return Object.freeze({
      detected: false,
      intent: null,
      confidence: 'NONE',
      normalized
    });
  }

  if (
    DESIGN_EXCLUSION_PATTERNS.some(pattern =>
      pattern.test(normalized)
    )
  ) {
    return Object.freeze({
      detected: false,
      intent: null,
      confidence: 'EXCLUDED',
      normalized
    });
  }

  const detected = DESIGN_ACTION_PATTERNS.some(pattern =>
    pattern.test(normalized)
  );

  return Object.freeze({
    detected,
    intent: detected ? 'design' : null,
    confidence: detected ? 'RULE' : 'NONE',
    normalized
  });
}

module.exports = {
  detectDesignIntent,
  normalizeDesignIntentText
};
