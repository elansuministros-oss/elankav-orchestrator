'use strict';

const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const { createGmailDeliveryAdapter } = require('../adapters/gmailDeliveryAdapter');
const { createMetaDeliveryAdapter } = require('../adapters/metaDeliveryAdapter');

class CommercialDeliveryError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function createCommercialDeliveryService({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const waha = createWahaDeliveryAdapter({ env, fetchImpl });
  const gmail = createGmailDeliveryAdapter({ env, fetchImpl });
  const meta = createMetaDeliveryAdapter({ env, fetchImpl });

  function whatsappConfigured() {
    return Boolean(
      clean(env.WAHA_BASE_URL || 'https://waha.elankav.com') &&
      clean(env.WAHA_API_KEY || env.WAHA_API_TOKEN)
    );
  }

  function capabilitySnapshot() {
    const gmailConfig = gmail.configuration();
    const messengerConfig = meta.messengerConfiguration();
    const instagramConfig = meta.instagramConfiguration();

    return [
      {
        channel: 'whatsapp',
        state: whatsappConfigured() ? 'VERIFIED' : 'AUTH_REQUIRED',
        configured: whatsappConfigured(),
        requiresPerTargetVerification: true
      },
      {
        channel: 'email',
        state: 'AUTH_REQUIRED',
        configured: gmailConfig.configured,
        requiresPerTargetVerification: false
      },
      {
        channel: 'messenger',
        state: 'AUTH_REQUIRED',
        configured: messengerConfig.configured,
        requiresPerTargetVerification: true
      },
      {
        channel: 'instagram_dm',
        state: 'AUTH_REQUIRED',
        configured: instagramConfig.configured,
        requiresPerTargetVerification: true
      }
    ];
  }

  async function probeCapabilities() {
    const base = capabilitySnapshot();
    const result = [];

    for (const item of base) {
      if (!item.configured) {
        result.push(item);
        continue;
      }

      try {
        if (item.channel === 'email') {
          const probe = await gmail.probe();
          result.push({
            ...item,
            state: probe.state === 'VERIFIED' ? 'VERIFIED' : 'AUTH_REQUIRED',
            authenticated: probe.state === 'VERIFIED'
          });
          continue;
        }

        if (item.channel === 'messenger') {
          await meta.probeMessenger();
          result.push({
            ...item,
            state: 'AUTH_REQUIRED',
            authenticated: true,
            reason: 'OAuth de Página válido; cada PSID y ventana de conversación debe verificarse antes del envío.'
          });
          continue;
        }

        if (item.channel === 'instagram_dm') {
          await meta.probeInstagram();
          result.push({
            ...item,
            state: 'AUTH_REQUIRED',
            authenticated: true,
            reason: 'OAuth de Instagram válido; cada IGSID debe provenir de una conversación iniciada por el destinatario.'
          });
          continue;
        }

        result.push(item);
      } catch (error) {
        result.push({
          ...item,
          state: 'AUTH_REQUIRED',
          authenticated: false,
          errorCode: clean(error?.code) || 'CHANNEL_PROBE_FAILED'
        });
      }
    }

    return result;
  }

  async function deliver(input = {}) {
    const channel = clean(input.channel);
    const text = clean(input.text);
    if (!channel || !text) {
      throw new CommercialDeliveryError(
        'COMMERCIAL_DELIVERY_ARGUMENTS_INVALID',
        'channel y text son obligatorios.',
        400
      );
    }

    if (channel === 'whatsapp') {
      if (!whatsappConfigured()) {
        throw new CommercialDeliveryError(
          'WHATSAPP_AUTH_REQUIRED',
          'WAHA no está configurado.',
          503
        );
      }
      const result = await waha.sendText({
        phone: input.phone,
        chatId: input.chatId,
        text
      });
      return {
        channel,
        status: 'SENT',
        externalRef: result.messageId || null,
        recipient: result.chatId
      };
    }

    if (channel === 'email') {
      const result = await gmail.sendText({
        to: input.to,
        subject: input.subject,
        text,
        threadId: input.threadId,
        inReplyTo: input.inReplyTo,
        references: input.references
      });
      return {
        channel,
        status: 'SENT',
        externalRef: result.id,
        threadId: result.threadId
      };
    }

    if (channel === 'messenger') {
      if (input.verifiedTarget !== true) {
        throw new CommercialDeliveryError(
          'MESSENGER_TARGET_NOT_VERIFIED',
          'Messenger exige PSID y conversación elegible verificados por CONNECT.',
          409
        );
      }
      const result = await meta.sendMessengerText({
        recipientId: input.recipientId,
        text,
        messageType: input.messageType || 'RESPONSE'
      });
      return {
        channel,
        status: 'SENT',
        externalRef: result.messageId,
        recipientId: result.recipientId
      };
    }

    if (channel === 'instagram_dm') {
      if (input.verifiedTarget !== true) {
        throw new CommercialDeliveryError(
          'INSTAGRAM_TARGET_NOT_VERIFIED',
          'Instagram exige IGSID de una conversación elegible verificada por CONNECT.',
          409
        );
      }
      const result = await meta.sendInstagramText({
        recipientId: input.recipientId,
        text
      });
      return {
        channel,
        status: 'SENT',
        externalRef: result.messageId,
        recipientId: result.recipientId
      };
    }

    throw new CommercialDeliveryError(
      'COMMERCIAL_CHANNEL_UNSUPPORTED',
      `Canal no soportado por el transport runtime: ${channel}.`,
      501
    );
  }

  return Object.freeze({
    capabilitySnapshot,
    probeCapabilities,
    deliver,
    listEmailMessages: gmail.listMessages,
    getEmailMessage: gmail.getMessage
  });
}

module.exports = {
  CommercialDeliveryError,
  createCommercialDeliveryService
};
