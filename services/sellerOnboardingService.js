'use strict';

const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { listSellers, provisionSellerAccess } = require('./ownerSellerConnectClient');
const { normalizeSellerRows, sellerMatches } = require('./ownerSellerReadService');

const COMMAND_TYPE = 'owner_seller_access_delivery';
const STATE_FILE = process.env.SELLER_ONBOARDING_STATE_FILE || '/opt/elankav/state/seller-onboarding-state.json';
const DEFAULT_PLATFORM = 'ELANVISUAL';

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function readStates() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; }
  catch { return {}; }
}

function writeStates(states) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(states, null, 2), { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}

function stateKey(phone) {
  return normalizePhone(phone);
}

function sellerName(seller = {}) {
  return clean(seller.display_name || seller.displayName || seller.legal_name || seller.legalName);
}

function sellerPhone(seller = {}) {
  return normalizePhone(seller.whatsapp || seller.phone);
}

function sellerPlatforms(seller = {}) {
  return (Array.isArray(seller.platforms) ? seller.platforms : [])
    .filter(row => !row?.status || normalize(row.status) === 'active')
    .map(row => clean(row.platform).toUpperCase())
    .filter(Boolean);
}

function parsePlatform(message) {
  const value = normalize(message);
  const aliases = [
    ['ELANVISUAL', ['elanvisual', 'elan visual', 'visual']],
    ['ELANHOME', ['elanhome', 'elan home']],
    ['ELANPET', ['elanpet', 'elan pet']],
    ['ELANCENTER', ['elancenter', 'elan center']],
    ['ELANKAV', ['elankav']]
  ];
  for (const [platform, names] of aliases) {
    if (names.some(name => value.includes(name))) return platform;
  }
  return DEFAULT_PLATFORM;
}

function extractTargetName(message) {
  let text = clean(message);
  text = text.replace(/^elan[\s,;:]+/i, '');
  const patterns = [
    /(?:manda(?:le)?|envia(?:le)?|envía(?:le)?|reenvia(?:le)?|reenvía(?:le)?|recupera(?:le)?|restablece(?:le)?|genera(?:le)?|dale)\s+(?:de nuevo\s+|nuevamente\s+|otra vez\s+)?(?:el\s+|sus\s+|su\s+)?(?:acceso|datos de acceso|clave|credencial(?:es)?)\s+(?:a\s+|para\s+)?(.+?)(?:\s+(?:en|a)\s+elan(?:visual|home|pet|center|kav))?$/i,
    /(?:acceso|datos de acceso|clave|credencial(?:es)?)\s+(?:de\s+|para\s+|a\s+)(?:la\s+|el\s+)?vendedor(?:a)?\s+(.+?)(?:\s+(?:en|a)\s+elan(?:visual|home|pet|center|kav))?$/i,
    /(?:manda(?:le)?|envia(?:le)?|envía(?:le)?|reenvia(?:le)?|reenvía(?:le)?)\s+(?:a\s+)?(.+?)\s+(?:su\s+|sus\s+|el\s+)?(?:acceso|datos de acceso|clave|credencial(?:es)?)(?:\s+(?:de|a|en)\s+elan(?:visual|home|pet|center|kav))?$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && clean(match[1])) return clean(match[1]).replace(/[.!?]+$/g, '').trim();
  }
  return '';
}

function detectOwnerSellerAccessDeliveryCommand(message) {
  const value = normalize(message).replace(/[.!?]+$/g, '');
  const hasAccess = /\b(acceso|clave|credencial|credenciales|contrasena|contraseña)\b/.test(value);
  const hasSendIntent = /\b(manda|mandale|envia|enviale|reenvia|reenviale|recupera|recuperale|restablece|restablecele|genera|generale|dale)\b/.test(value);
  if (!hasAccess || !hasSendIntent) return null;
  const query = extractTargetName(message);
  if (!query) return null;
  return Object.freeze({ type: COMMAND_TYPE, action: 'send_access', query, platform: parsePlatform(message) });
}

function buildAccessMessage({ name, platform, access }) {
  return [
    `Hola, ${name}. 👋`,
    '',
    `Te enviamos un acceso temporal para ${platform}.`,
    access.loginUrl ? `Enlace: ${access.loginUrl}` : '',
    access.username ? `Usuario: ${access.username}` : '',
    access.password ? `Contraseña temporal: ${access.password}` : '',
    '',
    'Esta credencial es para recuperar/activar tu acceso. Al ingresar, cambiá la contraseña por una personal que solo vos conozcás.',
    '',
    'También puedo enseñarte a trabajar con ELAN sin memorizar comandos. Podés hablarme normal, con abreviaturas o errores de escritura.',
    '',
    '¿Querés el tutorial por TEXTO o por AUDIO?'
  ].filter(Boolean).join('\n');
}

const SELLER_TUTORIAL_TEXT = [
  '📘 GUÍA RÁPIDA DE ELAN PARA VENDEDORES',
  '',
  'No tenés que memorizar comandos. Escribime como hablás normalmente por WhatsApp; puedo entender frases cortas, abreviaturas y errores de escritura.',
  '',
  '💰 PRECIOS',
  'Ejemplos: “cuanto vale un roll up”, “presio de rotulo boton”, “cuanto sale una lona 2 x 3”. Buscaré el precio oficial. Si una tarifa dice DESDE, te avisaré que es solo referencia mínima y no la convertiré sola en cotización formal.',
  '',
  '👤 CLIENTES',
  'Podés decir: “busca a Maria”, “tenemos registrado a COMEX”, “agrega este cliente”. Te pediré únicamente los datos que falten y usaré el registro oficial.',
  '',
  '📄 COTIZACIONES',
  'Ejemplos: “haceme una cotizacion para Abigail de un rotulo 60 x 60”, “cotizale 100 stickers a Carlos”, “enseñame mis cotizaciones”, “busca la cotizacion de Maria”. No necesitás UUID ni números técnicos.',
  '',
  '✏️ CAMBIOS Y ENVÍO',
  'Podés decir: “cambia la medida”, “agregale otro item”, “quitale ese item”, “dejala 60/40”, “enseñamela antes”, y cuando esté correcta: “mandasela”.',
  '',
  '🏭 TRABAJOS / OT',
  'Podés preguntar: “que trabajos tengo”, “cuales estan en produccion”, “como va el trabajo de Juan” o “enseñame mis OT”. Te mostraré únicamente lo que tu cuenta tenga autorizado.',
  '',
  '💵 VENTAS Y COMISIONES',
  'Podés preguntar: “cuanto he vendido este mes”, “cuanto tengo de comision” o “que comisiones me deben”. Si esa consulta todavía no está habilitada para tu cuenta, te lo diré claramente; nunca te mostraré información privada de otro vendedor.',
  '',
  '🧠 REGLA PRINCIPAL',
  'No hace falta escribir perfecto ni usar una frase exacta. Decime lo que querés hacer. Si algo es ambiguo o puede afectar un registro oficial, te preguntaré antes de ejecutarlo.',
  '',
  'Cuando necesités ayuda podés decir simplemente: “ELAN enseñame como hacer esto”.'
].join('\n');

const SELLER_TUTORIAL_AUDIO = [
  'Hola. Soy ELAN, tu asistente de trabajo. No necesitás aprender comandos ni escribir perfecto. Podés hablarme como hablás normalmente por WhatsApp.',
  'Para consultar precios, podés preguntarme cuánto vale un producto o describirme el trabajo. Buscaré el precio oficial. Si el precio dice desde, te voy a explicar que es una referencia mínima y no una cotización formal.',
  'Para clientes, podés pedirme que busque a una persona o empresa, o decirme que agreguemos un cliente nuevo. Te pediré únicamente los datos necesarios.',
  'Para cotizaciones, podés decirme algo como: haceme una cotización para María de un rótulo de sesenta por sesenta. También podés pedirme que cambie medidas, agregue o quite ítems, o que te enseñe la cotización antes de enviarla.',
  'Podés preguntarme cuáles cotizaciones tenés, qué trabajos están en producción, cómo va un trabajo o cuáles órdenes de trabajo tenés disponibles.',
  'También podés preguntar por tus ventas y comisiones. Si esa función todavía no está habilitada en tu cuenta, te lo voy a indicar sin inventar información.',
  'Recordá: no necesitás números técnicos, identificadores ni frases exactas. Decime qué querés hacer y yo voy a resolver la referencia humana cuando sea posible. Si algo no está claro, te preguntaré antes de ejecutar una operación.'
];

async function synthesizeSpeech(text, dependencies = {}) {
  const OpenAIImpl = dependencies.OpenAI || OpenAI;
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error('SELLER_TUTORIAL_TTS_NOT_CONFIGURED');
    error.code = 'SELLER_TUTORIAL_TTS_NOT_CONFIGURED';
    throw error;
  }
  const client = new OpenAIImpl({ apiKey });
  const speech = await client.audio.speech.create({
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.OPENAI_TTS_VOICE || 'coral',
    input: text,
    response_format: 'mp3',
    instructions: 'Habla en español latinoamericano, con tono claro, amable, profesional y pausado. Es un tutorial breve para un vendedor.'
  });
  return Buffer.from(await speech.arrayBuffer()).toString('base64');
}

async function sendTutorialAudio({ phone, delivery, dependencies = {} }) {
  const adapter = delivery || createWahaDeliveryAdapter();
  const sent = [];
  for (const section of SELLER_TUTORIAL_AUDIO) {
    const data = await synthesizeSpeech(section, dependencies);
    sent.push(await adapter.sendVoice({ phone, data, mimeType: 'audio/mpeg' }));
  }
  return sent;
}

async function executeOwnerSellerAccessDeliveryCommand(command, dependencies = {}) {
  const listSellersImpl = dependencies.listSellers || listSellers;
  const provisionImpl = dependencies.provisionSellerAccess || provisionSellerAccess;
  const delivery = dependencies.delivery || createWahaDeliveryAdapter();
  const payload = await listSellersImpl();
  const sellers = normalizeSellerRows(payload);
  const matches = sellers.filter(seller => sellerMatches(seller, command.query));

  if (!matches.length) {
    return {
      handled: true,
      outputText: `No encontré un vendedor oficial que coincida con “${clean(command.query)}”. No envié ningún acceso.`,
      result: { status: 'completed', count: 0 }
    };
  }
  if (matches.length > 1) {
    return {
      handled: true,
      outputText: `Encontré ${matches.length} vendedores que coinciden con “${clean(command.query)}”. Decime un poco más del nombre para no enviar el acceso a la persona equivocada.`,
      result: { status: 'completed', count: matches.length }
    };
  }

  const seller = matches[0];
  const name = sellerName(seller) || clean(command.query);
  const phone = sellerPhone(seller);
  const sellerId = clean(seller.id);
  const platform = clean(command.platform || DEFAULT_PLATFORM).toUpperCase();
  if (!phone) {
    return {
      handled: true,
      outputText: `Encontré a ${name}, pero su registro oficial no tiene WhatsApp. No envié credenciales.`,
      result: { status: 'completed', count: 1 }
    };
  }
  if (sellerPlatforms(seller).length && !sellerPlatforms(seller).includes(platform)) {
    return {
      handled: true,
      outputText: `${name} existe, pero no tiene ${platform} activo en crm_seller_platforms. No envié credenciales.`,
      result: { status: 'completed', count: 1 }
    };
  }

  const accessPayload = await provisionImpl(sellerId, platform);
  const access = accessPayload?.data || accessPayload || {};
  if (!access.username || !access.password) {
    const error = new Error('SELLER_ACCESS_RESPONSE_INCOMPLETE');
    error.code = 'SELLER_ACCESS_RESPONSE_INCOMPLETE';
    throw error;
  }

  const sent = await delivery.sendText({ phone, text: buildAccessMessage({ name, platform, access }) });
  const states = readStates();
  states[stateKey(phone)] = {
    sellerId,
    name,
    phone,
    platform,
    stage: 'awaiting_tutorial_format',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeStates(states);

  return {
    handled: true,
    outputText: [
      `✅ Acceso temporal enviado a ${name}.`,
      `WhatsApp: ${phone}`,
      `Plataforma: ${platform}`,
      'Le indiqué que cambie la contraseña al ingresar.',
      'También le pregunté si quiere el tutorial por TEXTO o AUDIO.'
    ].join('\n'),
    result: { status: 'completed', sellerId, phone, platform, messageId: sent.messageId || null }
  };
}

function detectTutorialPreference(message) {
  const value = normalize(message).replace(/[.!?]+$/g, '');
  if (/\b(audio|voz|hablado|hablada|nota de voz|mandamelo hablado|mandamela hablada)\b/.test(value)) return 'audio';
  if (/\b(texto|escrito|escribime|mensaje|por escrito)\b/.test(value)) return 'text';
  return '';
}

async function processSellerOnboardingReply({ message, phone, dependencies = {} } = {}) {
  const key = stateKey(phone);
  if (!key) return { handled: false };
  const states = readStates();
  const state = states[key];
  if (!state || state.stage !== 'awaiting_tutorial_format') return { handled: false };

  const preference = detectTutorialPreference(message);
  if (!preference) {
    return {
      handled: true,
      completed: false,
      outputText: 'Perfecto. Solo decime cómo preferís el tutorial: TEXTO o AUDIO.'
    };
  }

  if (preference === 'text') {
    delete states[key];
    writeStates(states);
    return { handled: true, completed: true, outputText: SELLER_TUTORIAL_TEXT };
  }

  const delivery = dependencies.delivery || createWahaDeliveryAdapter();
  await sendTutorialAudio({ phone: key, delivery, dependencies });
  delete states[key];
  writeStates(states);
  return {
    handled: true,
    completed: true,
    suppressDelivery: false,
    outputText: '🎧 Listo. Te envié el tutorial por audio. Si después querés verlo escrito, decime “tutorial por texto”.'
  };
}

module.exports = {
  COMMAND_TYPE,
  DEFAULT_PLATFORM,
  SELLER_TUTORIAL_AUDIO,
  SELLER_TUTORIAL_TEXT,
  STATE_FILE,
  buildAccessMessage,
  detectOwnerSellerAccessDeliveryCommand,
  detectTutorialPreference,
  executeOwnerSellerAccessDeliveryCommand,
  extractTargetName,
  processSellerOnboardingReply,
  sendTutorialAudio,
  synthesizeSpeech
};
