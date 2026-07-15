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
  /\b(me gustaria|quiero|quisiera|necesito)\b.*\b(algo asi|algo similar|parecido|una opcion similar|mas elegante)\b/,
  /\b(render|renderiza|renderizame)\b/,
  /\b(propuesta de diseno|propuesta visual)\b/
]);

const CONTEXTUAL_DESIGN_REQUEST_PATTERNS = Object.freeze([
  /\b(podrias|puedes|podes)\b.*\b(mandar|mandarme|enviar|enviarme|mostrar|mostrarme|hacer|preparar)\b/,
  /\b(mandame|enviame|mostrame|quiero verlo|quiero verla|quiero ver como quedaria)\b/
]);

const PROJECT_CONTEXT_PATTERN =
  /\b(rotulo|fachada|cajuela|jala vista|letras|luminos|acrilico|acm|logo|negocio|medida|interior|exterior)\b/;

const VISUAL_OFFER_PATTERN =
  /\b(propuesta visual|propuesta de diseno|render|diseno|como quedaria|imagen del proyecto|preparar la propuesta)\b/;

const LOGO_REQUEST_PATTERN =
  /(?:\b(tenes|tienes|envia|enviame|manda|mandame|comparti|compartime)\b.*\blogo\b|\blogo\b.*\b(enviar|mandar|compartir|imagen|archivo)\b)/;

const AFFIRMATIVE_REPLY_PATTERN =
  /^(si|sip|claro|por favor|porfavor|dale|ok|okay|perfecto|me encanta|hagamoslo|hacelo)$/;

const NO_LOGO_REPLY_PATTERN =
  /^(no|nop|sin logo|no tengo(?: el)? logo|no cuento con(?: el)? logo|no lo tengo)$/;

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

function normalizeDesignHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-12)
    .map(item => ({
      role: String(item?.role || '').trim().toLowerCase(),
      content: String(item?.content || '').trim().slice(0, 1200)
    }))
    .filter(item =>
      ['user', 'assistant'].includes(item.role) &&
      item.content
    );
}

function detectConversationDesignIntent({
  message,
  history = [],
  references = [],
  brandAssets = []
} = {}) {
  const direct = detectDesignIntent(message);
  const normalized = direct.normalized;
  const normalizedHistory = normalizeDesignHistory(history);
  const recentHistory = normalizedHistory
    .map(item => normalizeDesignIntentText(item.content));
  const recentAssistantHistory = normalizedHistory
    .filter(item => item.role === 'assistant')
    .map(item => normalizeDesignIntentText(item.content));
  const hasProjectContext = recentHistory.some(value =>
    PROJECT_CONTEXT_PATTERN.test(value)
  );
  const logoRequested = recentAssistantHistory.some(value =>
    LOGO_REQUEST_PATTERN.test(value)
  );
  const hasAssets =
    (Array.isArray(references) && references.length > 0) ||
    (Array.isArray(brandAssets) && brandAssets.length > 0);
  const assetContinuation = logoRequested && hasAssets;
  const noLogoReply =
    logoRequested && NO_LOGO_REPLY_PATTERN.test(normalized);
  const contextualRequest =
    hasProjectContext &&
    CONTEXTUAL_DESIGN_REQUEST_PATTERNS.some(pattern =>
      pattern.test(normalized)
    );
  const affirmativeVisualRequest =
    AFFIRMATIVE_REPLY_PATTERN.test(normalized) &&
    recentAssistantHistory.some(value =>
      VISUAL_OFFER_PATTERN.test(value)
    );
  const detected =
    direct.detected ||
    contextualRequest ||
    affirmativeVisualRequest ||
    noLogoReply ||
    assetContinuation;

  return Object.freeze({
    detected,
    intent: detected ? 'design' : null,
    confidence: direct.detected
      ? 'RULE'
      : detected
        ? 'CONTEXT'
        : direct.confidence,
    normalized,
    hasAssets,
    hasProjectContext,
    logoRequested,
    noLogoReply,
    reason: direct.detected
      ? 'DIRECT_REQUEST'
      : contextualRequest
        ? 'CONTEXTUAL_REQUEST'
        : affirmativeVisualRequest
          ? 'AFFIRMATIVE_VISUAL_REQUEST'
          : noLogoReply
            ? 'NO_LOGO_CONTINUATION'
            : assetContinuation
              ? 'LOGO_ASSET_CONTINUATION'
            : null
  });
}

function shouldRequestLogo({ detection } = {}) {
  if (!detection?.detected) return false;
  if (detection.hasAssets) return false;
  if (detection.logoRequested || detection.noLogoReply) return false;
  if (/\b(disena|crea|haz|haceme)\b.*\blogo\b/.test(detection.normalized)) {
    return false;
  }

  return true;
}

function buildDesignConversationPrompt({
  message,
  history = [],
  noLogoReply = false
} = {}) {
  const transcript = normalizeDesignHistory(history)
    .slice(-10)
    .map(item => {
      const speaker = item.role === 'assistant'
        ? 'ELAN IA'
        : 'Cliente';
      return `${speaker}: ${item.content}`;
    });
  const lines = [
    'Generá una propuesta visual usando únicamente los datos confirmados por el cliente en esta conversación.',
    'Conservá producto, medidas, ubicación, texto, estilo e iluminación cuando estén indicados. No inventes datos faltantes.'
  ];

  if (noLogoReply) {
    lines.push('El cliente confirmó que no enviará un archivo de logo; construí la propuesta con el nombre, texto y estilo descritos.');
  }

  if (transcript.length) {
    lines.push('Conversación reciente:', ...transcript);
  }

  lines.push(`Solicitud actual del cliente: ${String(message || '').trim()}`);
  return lines.join('\n').slice(0, 10000);
}

module.exports = {
  buildDesignConversationPrompt,
  detectConversationDesignIntent,
  detectDesignIntent,
  normalizeDesignHistory,
  shouldRequestLogo,
  normalizeDesignIntentText
};
