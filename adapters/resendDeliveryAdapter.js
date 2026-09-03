'use strict';

class ResendDeliveryError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function headerValue(value, fieldName) {
  const text = clean(value).replace(/[\r\n]+/g, ' ');
  if (!text) {
    throw new ResendDeliveryError(
      'RESEND_MESSAGE_INVALID',
      `${fieldName} es obligatorio.`,
      400
    );
  }
  return text;
}

function bodyValue(value, fieldName, required = true) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  if (required && !text) {
    throw new ResendDeliveryError('RESEND_MESSAGE_INVALID', fieldName + ' es obligatorio.', 400);
  }
  return text;
}

function emailAddressValue(value, fieldName, code) {
  const email = headerValue(value, fieldName).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ResendDeliveryError(code, `${fieldName} inválido.`, 400);
  }
  return email;
}

function attachmentValues(value) {
  const rows = Array.isArray(value) ? value : [];
  let totalBytes = 0;
  return rows.map((item, index) => {
    const filename = headerValue(item?.fileName || item?.filename, `attachment[${index}].fileName`).replace(/"/g, "'");
    const dataBase64 = clean(item?.dataBase64 || item?.content).replace(/\s+/g, '');
    if (!dataBase64 || !/^[A-Za-z0-9+/=]+$/.test(dataBase64)) {
      throw new ResendDeliveryError('RESEND_ATTACHMENT_INVALID', `Adjunto ${index + 1} inválido.`, 400);
    }
    let bytes;
    try { bytes = Buffer.from(dataBase64, 'base64'); } catch { bytes = Buffer.alloc(0); }
    if (!bytes.length) throw new ResendDeliveryError('RESEND_ATTACHMENT_INVALID', `Adjunto ${index + 1} vacío.`, 400);
    totalBytes += bytes.length;
    if (totalBytes > 18 * 1024 * 1024) {
      throw new ResendDeliveryError('RESEND_ATTACHMENTS_TOO_LARGE', 'Los adjuntos superan 18 MB.', 413);
    }
    return Object.freeze({ filename, content: bytes.toString('base64') });
  });
}

function parseSenderIdentities(rawValue) {
  const fallback = Object.freeze({
    elanvisual: Object.freeze({
      address: 'visual@elankav.com',
      name: 'ELANVISUAL'
    }),
    'elan-go': Object.freeze({
      address: 'go@elankav.com',
      name: 'ELAN GO'
    })
  });

  const raw = clean(rawValue);
  if (!raw) return fallback;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ResendDeliveryError(
      'RESEND_SENDER_IDENTITIES_INVALID',
      'RESEND_SENDER_IDENTITIES_JSON debe ser un objeto JSON válido.',
      503
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ResendDeliveryError(
      'RESEND_SENDER_IDENTITIES_INVALID',
      'RESEND_SENDER_IDENTITIES_JSON debe ser un objeto identidad→remitente.',
      503
    );
  }

  const identities = {};
  for (const [identity, value] of Object.entries(parsed)) {
    const key = clean(identity).toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(key)) {
      throw new ResendDeliveryError(
        'RESEND_SENDER_IDENTITIES_INVALID',
        'Existe una identidad Resend con nombre inválido.',
        503
      );
    }

    const record =
      typeof value === 'string'
        ? { address: value, name: key }
        : value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : null;

    if (!record) {
      throw new ResendDeliveryError(
        'RESEND_SENDER_IDENTITIES_INVALID',
        `La identidad ${key} tiene una configuración inválida.`,
        503
      );
    }

    identities[key] = Object.freeze({
      address: emailAddressValue(
        record.address,
        'sender identity',
        'RESEND_SENDER_IDENTITIES_INVALID'
      ),
      name: headerValue(record.name || key, 'sender name')
    });
  }

  return Object.freeze(identities);
}

function createResendDeliveryAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const apiKey = clean(env.RESEND_API_KEY);
  const domainVerified =
    clean(env.RESEND_DOMAIN_VERIFIED).toLowerCase() === 'true';
  const identities = parseSenderIdentities(env.RESEND_SENDER_IDENTITIES_JSON);

  function configuration() {
    const configured = Boolean(apiKey && Object.keys(identities).length);
    return Object.freeze({
      configured,
      state:
        configured && domainVerified
          ? 'VERIFIED'
          : 'AUTH_REQUIRED',
      provider: 'resend',
      reason: !configured
        ? 'Falta RESEND_API_KEY en infraestructura.'
        : domainVerified
          ? 'Resend configurado con dominio verificado e identidades allowlisted.'
          : 'Resend configurado; falta confirmar RESEND_DOMAIN_VERIFIED=true después de verificar el dominio.'
    });
  }

  function resolveSender(fromIdentity) {
    const identity = clean(fromIdentity).toLowerCase();
    if (!identity) {
      throw new ResendDeliveryError(
        'RESEND_SENDER_IDENTITY_REQUIRED',
        'fromIdentity es obligatorio para correo saliente.',
        400
      );
    }

    const sender = identities[identity];
    if (!sender) {
      throw new ResendDeliveryError(
        'RESEND_SENDER_IDENTITY_NOT_ALLOWED',
        `La identidad de correo ${identity} no está autorizada.`,
        403
      );
    }

    return Object.freeze({
      identity,
      address: sender.address,
      name: sender.name,
      formatted: `${sender.name} <${sender.address}>`
    });
  }

  async function sendText({
    to,
    subject,
    text,
    html,
    inReplyTo,
    references,
    fromIdentity,
    attachments
  } = {}) {
    const config = configuration();
    if (!config.configured) {
      throw new ResendDeliveryError(
        'RESEND_AUTH_REQUIRED',
        'Resend requiere RESEND_API_KEY configurada en infraestructura.',
        503
      );
    }

    if (!domainVerified) {
      throw new ResendDeliveryError(
        'RESEND_DOMAIN_NOT_VERIFIED',
        'El dominio Resend todavía no está habilitado como verificado en infraestructura.',
        503
      );
    }

    const recipient = emailAddressValue(
      to,
      'to',
      'RESEND_RECIPIENT_INVALID'
    );
    const safeSubject = headerValue(subject, 'subject');
    const bodyText = bodyValue(text, 'text');
    const bodyHtml = bodyValue(html, 'html', false);
    const sender = resolveSender(fromIdentity);
    const files = attachmentValues(attachments);

    const headers = {};
    if (clean(inReplyTo)) {
      headers['In-Reply-To'] = headerValue(inReplyTo, 'inReplyTo');
    }
    if (clean(references)) {
      headers.References = headerValue(references, 'references');
    }

    let response;
    let payload = {};
    try {
      response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: sender.formatted,
          to: [recipient],
          subject: safeSubject,
          text: bodyText,
          ...(bodyHtml ? { html: bodyHtml } : {}),
          ...(files.length ? { attachments: files } : {}),
          ...(Object.keys(headers).length ? { headers } : {})
        })
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      throw new ResendDeliveryError(
        'RESEND_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'Falló Resend API.',
        502
      );
    }

    if (!response.ok) {
      throw new ResendDeliveryError(
        clean(payload?.name) || 'RESEND_API_FAILED',
        clean(payload?.message) || `Resend HTTP ${response.status}`,
        response.status || 502
      );
    }

    const id = clean(payload?.id);
    if (!id) {
      throw new ResendDeliveryError(
        'RESEND_RESPONSE_INVALID',
        'Resend no devolvió un id de correo.',
        502
      );
    }

    return Object.freeze({
      status: 'SENT',
      id,
      provider: 'resend',
      sender: sender.address,
      recipient
    });
  }

  return Object.freeze({
    configuration,
    resolveSender,
    sendText
  });
}

module.exports = {
  ResendDeliveryError,
  createResendDeliveryAdapter,
  parseSenderIdentities
};
