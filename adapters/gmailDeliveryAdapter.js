'use strict';

const { randomUUID } = require('node:crypto');

class GmailDeliveryError extends Error {
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
    throw new GmailDeliveryError(
      'GMAIL_MESSAGE_INVALID',
      `${fieldName} es obligatorio.`,
      400
    );
  }
  return text;
}

function emailAddressValue(value, fieldName, code) {
  const email = headerValue(value, fieldName).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GmailDeliveryError(code, `${fieldName} inválido.`, 400);
  }
  return email;
}

function emailValue(value) {
  return emailAddressValue(value, 'to', 'GMAIL_RECIPIENT_INVALID');
}

function bodyValue(value, fieldName, required = true) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  if (required && !text) {
    throw new GmailDeliveryError('GMAIL_MESSAGE_INVALID', fieldName + ' es obligatorio.', 400);
  }
  return text;
}

function parseSenderIdentities(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return Object.freeze({});

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GmailDeliveryError(
      'GMAIL_SENDER_IDENTITIES_INVALID',
      'GMAIL_SENDER_IDENTITIES_JSON debe ser un objeto JSON válido.',
      503
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GmailDeliveryError(
      'GMAIL_SENDER_IDENTITIES_INVALID',
      'GMAIL_SENDER_IDENTITIES_JSON debe ser un objeto identidad→correo.',
      503
    );
  }

  const identities = {};
  for (const [identity, address] of Object.entries(parsed)) {
    const key = clean(identity).toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(key)) {
      throw new GmailDeliveryError(
        'GMAIL_SENDER_IDENTITIES_INVALID',
        'Existe una identidad Gmail con nombre inválido.',
        503
      );
    }
    identities[key] = emailAddressValue(
      address,
      'sender identity',
      'GMAIL_SENDER_IDENTITIES_INVALID'
    );
  }
  return Object.freeze(identities);
}

function base64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createGmailDeliveryAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const clientId = clean(env.GMAIL_OAUTH_CLIENT_ID);
  const clientSecret = clean(env.GMAIL_OAUTH_CLIENT_SECRET);
  const refreshToken = clean(env.GMAIL_OAUTH_REFRESH_TOKEN);
  const sender = clean(env.GMAIL_USER);
  const configuredSenderIdentities = clean(env.GMAIL_SENDER_IDENTITIES_JSON);

  function resolveSender(fromIdentity) {
    const identity = clean(fromIdentity).toLowerCase();
    if (!identity || identity === 'default') {
      return emailAddressValue(sender, 'sender', 'GMAIL_SENDER_INVALID');
    }

    const identities = parseSenderIdentities(configuredSenderIdentities);
    const selected = identities[identity];
    if (!selected) {
      throw new GmailDeliveryError(
        'GMAIL_SENDER_IDENTITY_NOT_ALLOWED',
        `La identidad de correo ${identity} no está autorizada en infraestructura.`,
        403
      );
    }
    return selected;
  }

  function configuration() {
    const configured = Boolean(clientId && clientSecret && refreshToken && sender);
    return Object.freeze({
      configured,
      state: configured ? 'AUTH_REQUIRED' : 'AUTH_REQUIRED',
      reason: configured
        ? 'Credenciales OAuth presentes; falta prueba activa contra Gmail antes de marcar VERIFIED.'
        : 'Faltan credenciales OAuth Gmail en infraestructura.'
    });
  }

  async function accessToken() {
    if (!configuration().configured) {
      throw new GmailDeliveryError(
        'GMAIL_AUTH_REQUIRED',
        'Gmail requiere OAuth configurado en infraestructura.',
        503
      );
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    let response;
    try {
      response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
    } catch (error) {
      throw new GmailDeliveryError(
        'GMAIL_OAUTH_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'Falló OAuth Gmail.',
        502
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !clean(payload.access_token)) {
      throw new GmailDeliveryError(
        'GMAIL_OAUTH_FAILED',
        clean(payload.error_description) || clean(payload.error) || `OAuth Gmail HTTP ${response.status}`,
        response.status || 502
      );
    }

    return clean(payload.access_token);
  }

  async function gmailRequest(path, init = {}) {
    const token = await accessToken();
    let response;
    try {
      response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {})
        }
      });
    } catch (error) {
      throw new GmailDeliveryError(
        'GMAIL_TRANSPORT_ERROR',
        error instanceof Error ? error.message : 'Falló Gmail API.',
        502
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiMessage =
        clean(payload?.error?.message) ||
        clean(payload?.error_description) ||
        `Gmail HTTP ${response.status}`;
      throw new GmailDeliveryError('GMAIL_API_FAILED', apiMessage, response.status);
    }
    return payload;
  }

  async function probeSenderIdentities() {
    const identities = parseSenderIdentities(configuredSenderIdentities);
    const entries = Object.entries(identities);
    if (!entries.length) {
      return Object.freeze({
        state: 'VERIFIED',
        identities: []
      });
    }

    const payload = await gmailRequest('/settings/sendAs', { method: 'GET' });
    const sendAs = Array.isArray(payload.sendAs) ? payload.sendAs : [];
    const byAddress = new Map(
      sendAs
        .filter(item => item && typeof item === 'object')
        .map(item => [clean(item.sendAsEmail).toLowerCase(), item])
        .filter(([address]) => Boolean(address))
    );

    const status = entries.map(([identity, address]) => {
      const item = byAddress.get(address);
      const verificationStatus = clean(item?.verificationStatus).toLowerCase();
      const verified =
        Boolean(item) &&
        (verificationStatus === 'accepted' || item?.isPrimary === true);

      return Object.freeze({
        identity,
        address,
        verified,
        verificationStatus: verificationStatus || (item ? 'unknown' : 'missing')
      });
    });

    return Object.freeze({
      state: status.every(item => item.verified) ? 'VERIFIED' : 'AUTH_REQUIRED',
      identities: status
    });
  }

  async function probe() {
    const payload = await gmailRequest('/profile', { method: 'GET' });
    const senderIdentities = await probeSenderIdentities();
    return Object.freeze({
      state: senderIdentities.state,
      emailAddress: clean(payload.emailAddress) || sender,
      messagesTotal: Number(payload.messagesTotal || 0),
      threadsTotal: Number(payload.threadsTotal || 0),
      senderIdentities: senderIdentities.identities
    });
  }

  async function sendText({
    to,
    subject,
    text,
    html,
    threadId,
    inReplyTo,
    references,
    fromIdentity
  } = {}) {
    const recipient = emailValue(to);
    const safeSubject = headerValue(subject, 'subject');
    const bodyText = bodyValue(text, 'text');
    const bodyHtml = bodyValue(html, 'html', false);
    const resolvedSender = resolveSender(fromIdentity);
    const boundary = '=_ELANKAV_' + randomUUID().replace(/-/g, '');

    const headers = [
      `From: ${resolvedSender}`,
      `To: ${recipient}`,
      `Subject: ${safeSubject}`,
      'MIME-Version: 1.0',
      ...(bodyHtml
        ? [`Content-Type: multipart/alternative; boundary="${boundary}"`]
        : ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit'])
    ];

    if (clean(inReplyTo)) {
      headers.push(`In-Reply-To: ${headerValue(inReplyTo, 'inReplyTo')}`);
    }
    if (clean(references)) {
      headers.push(`References: ${headerValue(references, 'references')}`);
    }

    const body = bodyHtml
      ? [
          '--' + boundary,
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          bodyText,
          '--' + boundary,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          bodyHtml,
          '--' + boundary + '--',
          ''
        ].join('\r\n')
      : bodyText;

    const raw = base64Url(headers.join('\r\n') + '\r\n\r\n' + body);
    const payload = await gmailRequest('/messages/send', {
      method: 'POST',
      body: JSON.stringify({
        raw,
        ...(clean(threadId) ? { threadId: clean(threadId) } : {})
      })
    });

    return Object.freeze({
      status: 'SENT',
      id: clean(payload.id) || null,
      threadId: clean(payload.threadId) || clean(threadId) || null
    });
  }

  async function listMessages({
    q = 'in:inbox',
    maxResults = 20
  } = {}) {
    const limit = Math.max(1, Math.min(100, Number(maxResults) || 20));
    const params = new URLSearchParams({
      maxResults: String(limit),
      q: clean(q) || 'in:inbox'
    });
    const payload = await gmailRequest(`/messages?${params.toString()}`, { method: 'GET' });
    return Array.isArray(payload.messages) ? payload.messages : [];
  }

  async function getMessage(id) {
    const messageId = clean(id);
    if (!messageId) {
      throw new GmailDeliveryError('GMAIL_MESSAGE_ID_REQUIRED', 'id es obligatorio.', 400);
    }
    return gmailRequest(`/messages/${encodeURIComponent(messageId)}?format=full`, {
      method: 'GET'
    });
  }

  return Object.freeze({
    configuration,
    probe,
    probeSenderIdentities,
    sendText,
    listMessages,
    getMessage
  });
}

module.exports = {
  GmailDeliveryError,
  base64Url,
  createGmailDeliveryAdapter,
  parseSenderIdentities
};
