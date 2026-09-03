'use strict';

const { createWahaDeliveryAdapter } = require('../adapters/wahaDeliveryAdapter');
const { createGmailDeliveryAdapter } = require('../adapters/gmailDeliveryAdapter');
const { createResendDeliveryAdapter } = require('../adapters/resendDeliveryAdapter');
const { createMetaDeliveryAdapter } = require('../adapters/metaDeliveryAdapter');

class ChannelDeliveryError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function createChannelDeliveryService({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const waha = createWahaDeliveryAdapter({ env, fetchImpl });
  const gmail = createGmailDeliveryAdapter({ env, fetchImpl });
  const resend = createResendDeliveryAdapter({ env, fetchImpl });
  const meta = createMetaDeliveryAdapter({ env, fetchImpl });

  function whatsappConfigured() {
    return Boolean(
      clean(env.WAHA_BASE_URL || 'https://waha.elankav.com') &&
      clean(env.WAHA_API_KEY || env.WAHA_API_TOKEN)
    );
  }

  function capabilitySnapshot() {
    const resendConfig = resend.configuration();
    const gmailConfig = gmail.configuration();
    const emailConfig = resendConfig.configured ? resendConfig : gmailConfig;
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
        state:
          emailConfig.state === 'VERIFIED'
            ? 'VERIFIED'
            : 'AUTH_REQUIRED',
        configured: emailConfig.configured,
        provider: resendConfig.configured ? 'resend' : 'gmail',
        requiresPerTargetVerification: false,
        reason: emailConfig.reason
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
          const resendConfig = resend.configuration();
          if (resendConfig.configured) {
            result.push({
              ...item,
              state: resendConfig.state,
              authenticated: resendConfig.state === 'VERIFIED',
              provider: 'resend',
              reason: resendConfig.reason
            });
            continue;
          }

          const probe = await gmail.probe();
          result.push({
            ...item,
            state: probe.state === 'VERIFIED' ? 'VERIFIED' : 'AUTH_REQUIRED',
            authenticated: probe.state === 'VERIFIED',
            provider: 'gmail'
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
      throw new ChannelDeliveryError(
        'CHANNEL_DELIVERY_ARGUMENTS_INVALID',
        'channel y text son obligatorios.',
        400
      );
    }

    if (channel === 'whatsapp') {
      if (!whatsappConfigured()) {
        throw new ChannelDeliveryError(
          'WHATSAPP_AUTH_REQUIRED',
          'WAHA no está configurado.',
          503
        );
      }

      if (clean(input.messageType).toLowerCase() === 'image') {
        const result = await waha.sendImage({
          phone: input.phone,
          chatId: input.chatId,
          imageUrl: input.imageUrl,
          caption: clean(input.caption),
          fileName: clean(input.fileName) || 'elan-preview.png',
          mimeType: clean(input.mimeType) || 'image/png'
        });
        return {
          channel,
          status: 'SENT',
          externalRef: result.messageId || null,
          recipient: result.chatId,
          messageType: 'image'
        };
      }

      if (clean(input.messageType).toLowerCase() === 'file') {
        const result = await waha.sendFile({
          phone: input.phone,
          chatId: input.chatId,
          fileUrl: input.fileUrl,
          caption: clean(input.caption || text),
          fileName: clean(input.fileName) || 'documento.pdf',
          mimeType: clean(input.mimeType) || 'application/pdf'
        });
        return {
          channel,
          status: 'SENT',
          externalRef: result.messageId || null,
          recipient: result.chatId,
          messageType: 'file'
        };
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
      const resendConfig = resend.configuration();
      const transport = resendConfig.configured ? resend : gmail;
      const result = await transport.sendText({
        to: input.to,
        subject: input.subject,
        text,
        html: input.html,
        threadId: input.threadId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        fromIdentity: input.fromIdentity,
        attachments: Array.isArray(input.attachments) ? input.attachments : []
      });
      return {
        channel,
        status: 'SENT',
        externalRef: result.id,
        provider: result.provider || (resendConfig.configured ? 'resend' : 'gmail'),
        ...(result.threadId ? { threadId: result.threadId } : {}),
        ...(result.sender ? { sender: result.sender } : {}),
        ...(result.recipient ? { recipient: result.recipient } : {})
      };
    }

    if (channel === 'messenger') {
      if (input.verifiedTarget !== true) {
        throw new ChannelDeliveryError(
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
        throw new ChannelDeliveryError(
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

    throw new ChannelDeliveryError(
      'CHANNEL_UNSUPPORTED',
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
  ChannelDeliveryError,
  createChannelDeliveryService
};
