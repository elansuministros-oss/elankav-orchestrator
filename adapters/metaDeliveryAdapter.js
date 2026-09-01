'use strict';

class MetaDeliveryError extends Error {
  constructor(code, message, status = 502, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.metaCode = details.metaCode ?? null;
    this.metaSubcode = details.metaSubcode ?? null;
    this.metaType = details.metaType ?? null;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function requireText(value, fieldName) {
  const text = clean(value);
  if (!text) {
    throw new MetaDeliveryError(
      'META_ARGUMENT_REQUIRED',
      `${fieldName} es obligatorio.`,
      400
    );
  }
  return text;
}

function createMetaDeliveryAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const version = clean(env.META_GRAPH_API_VERSION);
  const pageId = clean(env.META_PAGE_ID);
  const pageToken = clean(env.META_PAGE_ACCESS_TOKEN);
  const instagramAccountId = clean(env.META_INSTAGRAM_ACCOUNT_ID);
  const instagramToken = clean(
    env.INSTAGRAM_ACCESS_TOKEN ||
    env.META_PAGE_ACCESS_TOKEN
  );

  function messengerConfiguration() {
    const configured = Boolean(version && pageId && pageToken);
    return Object.freeze({
      configured,
      state: 'AUTH_REQUIRED',
      reason: configured
        ? 'Credenciales Meta Page presentes; falta prueba activa y elegibilidad de conversación antes de VERIFIED.'
        : 'Messenger requiere versión Graph, Page ID y Page access token.'
    });
  }

  function instagramConfiguration() {
    const configured = Boolean(version && instagramAccountId && instagramToken);
    return Object.freeze({
      configured,
      state: 'AUTH_REQUIRED',
      reason: configured
        ? 'Credenciales Instagram presentes; falta prueba activa y elegibilidad de conversación antes de VERIFIED.'
        : 'Instagram Messaging requiere versión Graph, cuenta profesional y access token.'
    });
  }

  async function request(url, token, init = {}) {
    if (!clean(token)) {
      throw new MetaDeliveryError('META_AUTH_REQUIRED', 'Meta OAuth no está configurado.', 503);
    }

    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {})
        }
      });
    } catch (error) {
      throw new MetaDeliveryError(
        'META_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'Falló Meta Graph API.',
        502
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new MetaDeliveryError(
        'META_API_FAILED',
        clean(payload?.error?.message) || `Meta HTTP ${response.status}`,
        response.status,
        {
          metaCode:
            Number.isFinite(Number(payload?.error?.code))
              ? Number(payload.error.code)
              : null,
          metaSubcode:
            Number.isFinite(Number(payload?.error?.error_subcode))
              ? Number(payload.error.error_subcode)
              : null,
          metaType: clean(payload?.error?.type) || null
        }
      );
    }

    return payload;
  }

  async function probeMessenger() {
    if (!messengerConfiguration().configured) {
      throw new MetaDeliveryError(
        'MESSENGER_AUTH_REQUIRED',
        'Messenger no está configurado.',
        503
      );
    }

    const payload = await request(
      `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}?fields=id,name`,
      pageToken,
      { method: 'GET' }
    );

    return Object.freeze({
      state: 'AUTH_REQUIRED',
      pageId: clean(payload.id) || pageId,
      pageName: clean(payload.name) || null,
      reason: 'Token válido para la Página; cada conversación todavía debe verificar ventana y PSID antes de enviar.'
    });
  }

  async function sendMessengerText({
    recipientId,
    text,
    messageType = 'RESPONSE'
  } = {}) {
    if (!messengerConfiguration().configured) {
      throw new MetaDeliveryError('MESSENGER_AUTH_REQUIRED', 'Messenger no está configurado.', 503);
    }

    const psid = requireText(recipientId, 'recipientId');
    const message = requireText(text, 'text');
    const payload = await request(
      `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/messages`,
      pageToken,
      {
        method: 'POST',
        body: JSON.stringify({
          recipient: { id: psid },
          message_type: requireText(messageType, 'messageType'),
          message: { text: message }
        })
      }
    );

    return Object.freeze({
      status: 'SENT',
      recipientId: clean(payload.recipient_id) || psid,
      messageId: clean(payload.message_id) || null
    });
  }

  async function probeInstagram() {
    if (!instagramConfiguration().configured) {
      throw new MetaDeliveryError(
        'INSTAGRAM_AUTH_REQUIRED',
        'Instagram Messaging no está configurado.',
        503
      );
    }

    const payload = await request(
      `https://graph.instagram.com/${version}/${encodeURIComponent(instagramAccountId)}?fields=id,username`,
      instagramToken,
      { method: 'GET' }
    );

    return Object.freeze({
      state: 'AUTH_REQUIRED',
      accountId: clean(payload.id) || instagramAccountId,
      username: clean(payload.username) || null,
      reason: 'Token válido para la cuenta; cada conversación todavía debe verificar que el destinatario inició mensajería y que existe IGSID.'
    });
  }

  async function sendInstagramText({
    recipientId,
    text
  } = {}) {
    if (!instagramConfiguration().configured) {
      throw new MetaDeliveryError(
        'INSTAGRAM_AUTH_REQUIRED',
        'Instagram Messaging no está configurado.',
        503
      );
    }

    const igsid = requireText(recipientId, 'recipientId');
    const message = requireText(text, 'text');
    const payload = await request(
      `https://graph.instagram.com/${version}/${encodeURIComponent(instagramAccountId)}/messages`,
      instagramToken,
      {
        method: 'POST',
        body: JSON.stringify({
          recipient: { id: igsid },
          message: { text: message }
        })
      }
    );

    return Object.freeze({
      status: 'SENT',
      recipientId: clean(payload.recipient_id) || igsid,
      messageId: clean(payload.message_id) || null
    });
  }

  return Object.freeze({
    messengerConfiguration,
    instagramConfiguration,
    probeMessenger,
    probeInstagram,
    sendMessengerText,
    sendInstagramText
  });
}

module.exports = {
  MetaDeliveryError,
  createMetaDeliveryAdapter
};
