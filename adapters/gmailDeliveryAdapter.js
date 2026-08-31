'use strict';

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

function emailValue(value) {
  const email = headerValue(value, 'to').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GmailDeliveryError('GMAIL_RECIPIENT_INVALID', 'Correo destinatario inválido.', 400);
  }
  return email;
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

  async function probe() {
    const payload = await gmailRequest('/profile', { method: 'GET' });
    return Object.freeze({
      state: 'VERIFIED',
      emailAddress: clean(payload.emailAddress) || sender,
      messagesTotal: Number(payload.messagesTotal || 0),
      threadsTotal: Number(payload.threadsTotal || 0)
    });
  }

  async function sendText({
    to,
    subject,
    text,
    threadId,
    inReplyTo,
    references
  } = {}) {
    const recipient = emailValue(to);
    const safeSubject = headerValue(subject, 'subject');
    const bodyText = headerValue(text, 'text');

    const headers = [
      `From: ${headerValue(sender, 'sender')}`,
      `To: ${recipient}`,
      `Subject: ${safeSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit'
    ];

    if (clean(inReplyTo)) {
      headers.push(`In-Reply-To: ${headerValue(inReplyTo, 'inReplyTo')}`);
    }
    if (clean(references)) {
      headers.push(`References: ${headerValue(references, 'references')}`);
    }

    const raw = base64Url(`${headers.join('\r\n')}\r\n\r\n${bodyText}`);
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
    sendText,
    listMessages,
    getMessage
  });
}

module.exports = {
  GmailDeliveryError,
  base64Url,
  createGmailDeliveryAdapter
};
