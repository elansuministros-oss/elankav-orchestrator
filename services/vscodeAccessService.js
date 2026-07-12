const crypto = require('node:crypto');

const COOKIE_NAME = 'elankav_vscode_session';
const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionSecret() {
  return String(
    process.env.VSCODE_SESSION_SECRET ||
    process.env.ORCHESTRATOR_SESSION_SECRET ||
    process.env.VSCODE_ACCESS_TOKEN ||
    ''
  );
}

function sessionSeconds() {
  const configured = Number(process.env.VSCODE_SESSION_SECONDS);

  if (!Number.isInteger(configured) || configured < 300 || configured > 86400) {
    return DEFAULT_SESSION_SECONDS;
  }

  return configured;
}

function signPayload(payload) {
  const secret = sessionSecret();

  if (!secret) {
    const error = new Error('VSCODE_SESSION_SECRET_NOT_CONFIGURED');
    error.code = 'VSCODE_SESSION_SECRET_NOT_CONFIGURED';
    throw error;
  }

  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

function createVscodeSession(actor, now = Date.now()) {
  const normalizedActor = String(actor || '').replace(/\D/g, '');

  if (!normalizedActor) {
    throw new Error('VSCODE_SESSION_ACTOR_REQUIRED');
  }

  const expiresAt = now + sessionSeconds() * 1000;
  const payload = `${normalizedActor}.${expiresAt}`;
  const signature = signPayload(payload);
  const value = `${payload}.${signature}`;

  return {
    actor: normalizedActor,
    expiresAt,
    cookie: `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionSeconds()}`
  };
}

function readCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separator = item.indexOf('=');

      if (separator < 1) {
        return cookies;
      }

      cookies[item.slice(0, separator)] = decodeURIComponent(
        item.slice(separator + 1)
      );

      return cookies;
    }, {});
}

function verifyVscodeSession(req, now = Date.now()) {
  const value = readCookies(req)[COOKIE_NAME];

  if (!value) {
    return null;
  }

  const parts = value.split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [actor, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);

  if (!actor || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }

  const expected = signPayload(`${actor}.${expiresAt}`);

  if (!safeEqual(signature, expected)) {
    return null;
  }

  return {
    actor,
    expiresAt
  };
}

module.exports = {
  COOKIE_NAME,
  createVscodeSession,
  verifyVscodeSession
};