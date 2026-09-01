'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elan-seller-onboarding-'));
process.env.SELLER_ONBOARDING_STATE_FILE = path.join(stateDir, 'state.json');
process.env.OPENAI_API_KEY = 'test-key';

const {
  COMMAND_TYPE,
  SELLER_TUTORIAL_TEXT,
  buildAccessMessage,
  detectOwnerSellerAccessDeliveryCommand,
  detectTutorialPreference,
  executeOwnerSellerAccessDeliveryCommand,
  processSellerOnboardingReply,
  sendTutorialAudio
} = require('../services/sellerOnboardingService');

const valentina = {
  id: 'seller-valentina',
  seller_code: 'VALENTINA-001',
  display_name: 'Valentina Yahosca Ramos Mena',
  whatsapp: '+505 8212 1495',
  status: 'active',
  platforms: [{ platform: 'ELANVISUAL', status: 'active' }]
};

test('Owner puede pedir acceso con lenguaje natural sin IDs', () => {
  const command = detectOwnerSellerAccessDeliveryCommand(
    'ELAN mandale el acceso a Valentina Yahosca Ramos Mena'
  );
  assert.equal(command?.type, COMMAND_TYPE);
  assert.equal(command?.query, 'Valentina Yahosca Ramos Mena');
  assert.equal(command?.platform, 'ELANVISUAL');
});

test('entiende recuperación de clave con jerga natural', () => {
  const command = detectOwnerSellerAccessDeliveryCommand(
    'recuperale la clave a Valentina Yahosca Ramos Mena'
  );
  assert.equal(command?.type, COMMAND_TYPE);
  assert.equal(command?.query, 'Valentina Yahosca Ramos Mena');
});

test('entiende plataforma al final de la frase', () => {
  const command = detectOwnerSellerAccessDeliveryCommand(
    'mandale nuevamente sus credenciales a Valentina Yahosca Ramos Mena en ELANVISUAL'
  );
  assert.equal(command?.type, COMMAND_TYPE);
  assert.equal(command?.query, 'Valentina Yahosca Ramos Mena');
  assert.equal(command?.platform, 'ELANVISUAL');
});

test('no captura una orden de registrar vendedor', () => {
  assert.equal(
    detectOwnerSellerAccessDeliveryCommand('registra una vendedora llamada Valentina'),
    null
  );
});

test('mensaje de acceso deja claro que la contraseña es temporal y ofrece tutorial', () => {
  const text = buildAccessMessage({
    name: 'Valentina',
    platform: 'ELANVISUAL',
    access: {
      loginUrl: 'https://visual.elankav.com/login',
      username: 'valentina',
      password: 'Temporal123'
    }
  });
  assert.match(text, /Contraseña temporal: Temporal123/i);
  assert.match(text, /cambiá la contraseña/i);
  assert.match(text, /TEXTO o por AUDIO/i);
});

test('envía acceso solo al WhatsApp del vendedor oficial y deja onboarding pendiente', async () => {
  const sent = [];
  const result = await executeOwnerSellerAccessDeliveryCommand(
    {
      type: COMMAND_TYPE,
      action: 'send_access',
      query: 'Valentina Yahosca Ramos Mena',
      platform: 'ELANVISUAL'
    },
    {
      async listSellers() {
        return { data: { sellers: [valentina] } };
      },
      async provisionSellerAccess(sellerId, platform) {
        assert.equal(sellerId, 'seller-valentina');
        assert.equal(platform, 'ELANVISUAL');
        return {
          data: {
            loginUrl: 'https://visual.elankav.com/login',
            username: 'valentina',
            password: 'Temporal123'
          }
        };
      },
      delivery: {
        async sendText(payload) {
          sent.push(payload);
          return { chatId: '50582121495@c.us', messageId: 'msg-access' };
        }
      }
    }
  );

  assert.equal(result.handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, '50582121495');
  assert.match(sent[0].text, /Temporal123/);
  assert.match(result.outputText, /Acceso temporal enviado/i);
});

test('el vendedor puede escoger tutorial por texto con una respuesta simple', async () => {
  assert.equal(detectTutorialPreference('mejor por texto'), 'text');
  const reply = await processSellerOnboardingReply({
    message: 'texto',
    phone: '+505 8212 1495'
  });
  assert.equal(reply.handled, true);
  assert.equal(reply.completed, true);
  assert.equal(reply.outputText, SELLER_TUTORIAL_TEXT);
  assert.match(reply.outputText, /No tenés que memorizar comandos/i);
  assert.match(reply.outputText, /PRECIOS/);
  assert.match(reply.outputText, /COTIZACIONES/);
  assert.match(reply.outputText, /TRABAJOS \/ OT/);
  assert.match(reply.outputText, /COMISIONES/);
});

test('reconoce preferencia por audio y usa el canal de voz existente', async () => {
  assert.equal(detectTutorialPreference('mandamelo hablado'), 'audio');
  const voices = [];
  class FakeOpenAI {
    constructor() {
      this.audio = {
        speech: {
          create: async () => ({
            arrayBuffer: async () => Buffer.from('fake-audio')
          })
        }
      };
    }
  }
  const sent = await sendTutorialAudio({
    phone: '50582121495',
    delivery: {
      async sendVoice(payload) {
        voices.push(payload);
        return { messageId: `voice-${voices.length}` };
      }
    },
    dependencies: { OpenAI: FakeOpenAI }
  });
  assert.ok(sent.length >= 5);
  assert.equal(voices.length, sent.length);
  assert.equal(voices[0].phone, '50582121495');
  assert.equal(voices[0].mimeType, 'audio/mpeg');
  assert.ok(voices[0].data.length > 0);
});
