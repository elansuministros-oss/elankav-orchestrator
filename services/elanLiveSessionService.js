'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 15 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function getSecret() {
  const secret = process.env.ELAN_LIVE_SESSION_SECRET || process.env.ORCHESTRATOR_OWNER_TOKEN || '';
  if (!secret || secret.length < 24) {
    const error = new Error('ELAN_LIVE_SESSION_SECRET_NOT_CONFIGURED');
    error.code = 'ELAN_LIVE_SESSION_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function resolveRole({ isOwner, role }) {
  if (isOwner) return 'owner';
  const normalized = String(role || '').trim().toLowerCase();
  return ['ventas', 'vendedor', 'seller'].includes(normalized) ? 'ventas' : 'assistant';
}

function createElanLiveSession({ phone, externalUserId, isOwner = false, role = null, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: String(externalUserId || phone || '').trim(),
    phone: String(phone || '').replace(/\D/g, ''),
    role: resolveRole({ isOwner, role }),
    owner: Boolean(isOwner),
    iat: now,
    exp: now + Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 3600)),
    nonce: crypto.randomBytes(12).toString('base64url')
  };
  if (!payload.sub) throw new Error('ELAN_LIVE_IDENTITY_REQUIRED');
  const encoded = base64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded)}`, payload };
}

function verifyElanLiveSession(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function buildElanLiveUrl(session) {
  const base = String(process.env.ELAN_LIVE_BASE_URL || 'https://visual.elankav.com/elan-live').replace(/\/$/, '');
  return `${base}#session=${encodeURIComponent(session.token)}`;
}

module.exports = { createElanLiveSession, verifyElanLiveSession, buildElanLiveUrl };
