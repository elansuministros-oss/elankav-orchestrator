'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isVoicePayload,
  normalizeMimeType,
  normalizeWahaVoiceEvent
} = require('../modules/voicePipelineV2/wahaVoiceEvent');
const {
  extractRecoveredMedia,
  queryableMessageId
} = require('../adapters/wahaVoiceMediaAdapterV2');
const {
  clearVoicePipelineV2Dedupe,
  runVoicePipelineV2
} = require('../services/voicePipelineV2Service');

function voiceEvent(overrides = {}) {
  return {
    messageId: 'false_50588888888@lid_MSG123',
    session: 'ELANKAV',
    senderRaw: '50588888888@lid',
    phone: '50588888888',
    chatId: '50588888888@lid',
    media: {
      url: '/api/files/audio.ogg',
      mimeType: 'audio/ogg',
      filename: 'voice.ogg'
    },
    ...overrides
  };
}

function successfulDependencies(overrides = {}) {
  const calls = { voice: [], text: [], processed: [] };
  return {
    calls,
    dependencies: {
      downloadWahaMedia: async () => ({ buffer: Buffer.from('audio'), mimeType: 'application/octet-stream' }),
      transcribeAudio: async ({ mimeType }) => {
        assert.equal(mimeType, 'audio/ogg');
        return 'Necesito una cotización';
      },
      processMessage: async input => {
        calls.processed.push(input);
        return { reply: 'Con gusto. Indíqueme la medida.' };
      },
      synthesizeSpeech: async () => ({ data: 'BASE64', mimeType: 'audio/ogg' }),
      delivery: {
        sendVoice: async input => calls.voice.push(input),
        sendText: async input => calls.text.push(input)
      },
      ...overrides
    }
  };
}

test.beforeEach(() => clearVoicePipelineV2Dedupe());

test('normaliza MIME GOWS con codecs', () => {
  assert.equal(normalizeMimeType('audio/ogg; codecs=opus'), 'audio/ogg');
});

test('no clasifica mensajes de texto como audio', () => {
  assert.equal(isVoicePayload({ type: 'chat', body: 'Hola' }), false);
  assert.equal(normalizeWahaVoiceEvent({ event: 'message', payload: { from: '50588888888@c.us', body: 'Hola', type: 'chat' } }), null);
});

test('normaliza evento GOWS real con @lid y media', () => {
  const event = normalizeWahaVoiceEvent({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      id: 'false_50588888888@lid_MSG123',
      from: '50588888888@lid',
      fromMe: false,
      hasMedia: true,
      media: {
        url: '/api/files/audio.ogg',
        mimetype: 'audio/ogg; codecs=opus'
      }
    }
  });

  assert.equal(event.messageId, 'false_50588888888@lid_MSG123');
  assert.equal(event.chatId, '50588888888@lid');
  assert.equal(event.phone, '50588888888');
  assert.equal(event.media.mimeType, 'audio/ogg');
});

test('extrae ID consultable desde ID compuesto GOWS', () => {
  assert.equal(queryableMessageId('false_50588888888@lid_MSG123'), 'MSG123');
  assert.equal(queryableMessageId('MSG123'), 'MSG123');
});

test('extrae media recuperada por WAHA', () => {
  assert.deepEqual(
    extractRecoveredMedia({ payload: { media: { url: '/file.ogg', mimetype: 'audio/ogg' } } }),
    { url: '/file.ogg', mimeType: 'audio/ogg', filename: 'voice.ogg' }
  );
});

test('procesa audio y responde una sola vez por voz', async () => {
  const { calls, dependencies } = successfulDependencies();
  const result = await runVoicePipelineV2(voiceEvent(), dependencies);

  assert.deepEqual(result, { processed: true, replySent: true, replyType: 'voice' });
  assert.equal(calls.voice.length, 1);
  assert.equal(calls.text.length, 0);
  assert.equal(calls.processed.length, 1);
  assert.equal(calls.processed[0].metadata.pipeline, 'voice-v2');
});

test('recupera el mensaje por ID cuando webhook no trae media.url', async () => {
  let recovered = 0;
  const { dependencies } = successfulDependencies({
    mediaAdapter: {
      recoverMessage: async ({ messageId }) => {
        recovered += 1;
        assert.equal(messageId, 'false_50588888888@lid_MSG123');
        return { url: '/recovered.ogg', mimeType: 'audio/ogg', filename: 'voice.ogg' };
      }
    }
  });

  const result = await runVoicePipelineV2(voiceEvent({ media: { url: '', mimeType: 'audio/ogg', filename: 'voice.ogg' } }), dependencies);
  assert.equal(result.replyType, 'voice');
  assert.equal(recovered, 1);
});

test('usa fallback de texto si falla síntesis o envío de voz', async () => {
  const { calls, dependencies } = successfulDependencies({
    synthesizeSpeech: async () => {
      const error = new Error('TTS failed');
      error.code = 'TTS_FAILED';
      throw error;
    }
  });

  const result = await runVoicePipelineV2(voiceEvent(), dependencies);
  assert.deepEqual(result, { processed: true, replySent: true, replyType: 'text' });
  assert.equal(calls.voice.length, 0);
  assert.equal(calls.text.length, 1);
  assert.equal(calls.text[0].text, 'Con gusto. Indíqueme la medida.');
});

test('rechaza duplicado completado durante la ventana de idempotencia', async () => {
  const { calls, dependencies } = successfulDependencies();
  const first = await runVoicePipelineV2(voiceEvent(), dependencies);
  const second = await runVoicePipelineV2(voiceEvent(), dependencies);

  assert.equal(first.processed, true);
  assert.deepEqual(second, { duplicate: true, processed: false });
  assert.equal(calls.processed.length, 1);
});

test('libera idempotencia después de un fallo para permitir reintento', async () => {
  let attempts = 0;
  const { dependencies } = successfulDependencies({
    transcribeAudio: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('temporary'), { code: 'TEMPORARY' });
      return 'Reintento válido';
    }
  });

  await assert.rejects(() => runVoicePipelineV2(voiceEvent(), dependencies), /temporary/);
  const second = await runVoicePipelineV2(voiceEvent(), dependencies);
  assert.equal(second.processed, true);
  assert.equal(attempts, 2);
});
