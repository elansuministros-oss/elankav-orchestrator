'use strict';

const { createHmac } = require('node:crypto');
const { createChannelDeliveryService } = require('./channelDeliveryService');

function clean(value) {
  return String(value || '').trim();
}

function connectBaseUrl(env = process.env) {
  return clean(env.CONNECT_BASE_URL || env.ELANKAV_CONNECT_URL || 'https://connect.elankav.com').replace(/\/+$/, '');
}

function internalToken(env = process.env) {
  const explicit = clean(env.CONNECT_INTERNAL_API_TOKEN || env.CONNECT_INTERNAL_TOKEN);
  if (explicit) return explicit;
  const root = clean(env.VQS_API_TOKEN);
  if (!root) return '';
  return createHmac('sha256', root)
    .update('ELANKAV_CHANNEL_INTERNAL_V1')
    .digest('hex');
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? '505' + digits : digits;
}

function parseAddressHeader(value) {
  const raw = clean(value);
  const match = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = clean(match?.[1] || raw).toLowerCase();
  const email = candidate.match(/[a-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return clean(email?.[0]).toLowerCase();
}

function header(headers, name) {
  const wanted = String(name || '').toLowerCase();
  const row = (Array.isArray(headers) ? headers : []).find(item =>
    clean(item?.name).toLowerCase() === wanted
  );
  return clean(row?.value);
}

function decodeBase64Url(value) {
  const raw = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  if (!raw) return '';
  const pad = raw.length % 4 ? '='.repeat(4 - raw.length % 4) : '';
  try {
    return Buffer.from(raw + pad, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractGmailBody(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const mime = clean(payload.mimeType).toLowerCase();
  const body = decodeBase64Url(payload?.body?.data);
  if (mime === 'text/plain' && body) return body.trim();

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const text = extractGmailBody(part);
    if (text) return text;
  }
  return body.trim();
}

async function attributeProspectingResponse({
  channel,
  destination,
  message,
  subject,
  externalRef,
  occurredAt,
  metadata,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const token = internalToken(env);
  if (!token) {
    const error = new Error('CONNECT_INTERNAL_TOKEN_REQUIRED');
    error.code = 'CONNECT_INTERNAL_TOKEN_REQUIRED';
    throw error;
  }

  const target = connectBaseUrl(env) + '/api/v1/prospecting/responses/attribute';
  const response = await fetchImpl(target, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Actor-Type': 'owner',
      'X-Elankav-Actor-Role': 'owner',
      'X-Elankav-Actor-Id': 'prospecting-response-attribution',
      'X-Elankav-Platform': 'ELANVISUAL',
      'X-Elankav-Source': 'ORCHESTRATOR_RESPONSE_ATTRIBUTION'
    },
    body: JSON.stringify({
      channel,
      destination,
      ...(clean(message) ? { message: clean(message) } : {}),
      ...(clean(subject) ? { subject: clean(subject) } : {}),
      ...(clean(externalRef) ? { externalRef: clean(externalRef) } : {}),
      ...(clean(occurredAt) ? { occurredAt: clean(occurredAt) } : {}),
      ...(metadata && typeof metadata === 'object' ? { metadata } : {})
    }),
    signal: AbortSignal.timeout(Number(env.CONNECT_RESPONSE_ATTRIBUTION_TIMEOUT_MS || 10_000))
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(clean(payload?.error?.message) || 'PROSPECTING_RESPONSE_ATTRIBUTION_FAILED');
    error.code = clean(payload?.error?.code) || 'PROSPECTING_RESPONSE_ATTRIBUTION_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function attributeWhatsappResponseSafely({
  phone,
  text,
  messageId,
  occurredAt,
  metadata,
  fetchImpl,
  env
} = {}) {
  const destination = normalizePhone(phone);
  if (!destination || !clean(text)) return { matched: false, skipped: true };
  try {
    return await attributeProspectingResponse({
      channel: 'whatsapp',
      destination,
      message: text,
      externalRef: messageId,
      occurredAt,
      metadata,
      fetchImpl,
      env
    });
  } catch (error) {
    console.error('[PROSPECTING_WHATSAPP_RESPONSE_ATTRIBUTION_FAILED]', {
      code: error?.code || null,
      message: error?.message || String(error)
    });
    return { matched: false, error: error?.code || error?.message || 'ATTRIBUTION_FAILED' };
  }
}

function createProspectingEmailReplyWorker({
  env = process.env,
  fetchImpl = globalThis.fetch,
  channelDelivery = createChannelDeliveryService({ env, fetchImpl }),
  attributeImpl = attributeProspectingResponse
} = {}) {
  const intervalMs = Math.max(60_000, Number(env.PROSPECTING_EMAIL_REPLY_POLL_MS || 300_000));
  const lookbackDays = Math.max(1, Math.min(30, Number(env.PROSPECTING_EMAIL_REPLY_LOOKBACK_DAYS || 7)));
  const seen = new Set();
  let timer = null;
  let running = false;
  const state = {
    running: false,
    processed: 0,
    matched: 0,
    ownerRecommended: 0,
    lastRunAt: null,
    lastErrorCode: null
  };

  async function runOnce() {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    state.running = true;
    try {
      const messages = await channelDelivery.listEmailMessages({
        q: `in:inbox newer_than:${lookbackDays}d`,
        maxResults: 50
      });
      let processed = 0;
      let matched = 0;
      let recommended = 0;

      for (const item of messages) {
        const id = clean(item?.id);
        if (!id || seen.has(id)) continue;
        const full = await channelDelivery.getEmailMessage(id);
        const headers = full?.payload?.headers || [];
        const from = parseAddressHeader(header(headers, 'From'));
        const subject = header(headers, 'Subject');
        const messageId = header(headers, 'Message-ID') || id;
        const text = extractGmailBody(full?.payload) || clean(full?.snippet);
        if (!from || !text) {
          seen.add(id);
          continue;
        }

        const result = await attributeImpl({
          channel: 'email',
          destination: from,
          message: text,
          subject,
          externalRef: messageId,
          occurredAt: full?.internalDate
            ? new Date(Number(full.internalDate)).toISOString()
            : new Date().toISOString(),
          metadata: {
            gmailId: id,
            gmailThreadId: clean(full?.threadId),
            source: 'gmail_inbox'
          },
          fetchImpl,
          env
        }).catch(error => ({
          matched: false,
          error: error?.code || error?.message || 'ATTRIBUTION_FAILED'
        }));

        seen.add(id);
        processed += 1;
        if (result?.matched) matched += 1;
        if (result?.ownerRecommended) recommended += 1;
      }

      while (seen.size > 2000) {
        const first = seen.values().next().value;
        if (!first) break;
        seen.delete(first);
      }

      state.processed += processed;
      state.matched += matched;
      state.ownerRecommended += recommended;
      state.lastRunAt = new Date().toISOString();
      state.lastErrorCode = null;
      return { skipped: false, processed, matched, ownerRecommended: recommended };
    } catch (error) {
      state.lastRunAt = new Date().toISOString();
      state.lastErrorCode = error?.code || error?.message || 'EMAIL_REPLY_WORKER_FAILED';
      console.error('[PROSPECTING_EMAIL_REPLY_WORKER_FAILED]', {
        code: state.lastErrorCode,
        message: error?.message || String(error)
      });
      return { skipped: false, processed: 0, matched: 0, error: state.lastErrorCode };
    } finally {
      running = false;
      state.running = false;
    }
  }

  function start() {
    if (timer) return;
    const startupDelay = Math.max(15_000, Number(env.PROSPECTING_EMAIL_REPLY_STARTUP_DELAY_MS || 45_000));
    setTimeout(() => {
      void runOnce();
      timer = setInterval(() => void runOnce(), intervalMs);
      timer.unref?.();
    }, startupDelay).unref?.();
  }

  function snapshot() {
    return { ...state, intervalMs };
  }

  return { runOnce, start, snapshot };
}

module.exports = {
  attributeProspectingResponse,
  attributeWhatsappResponseSafely,
  createProspectingEmailReplyWorker,
  decodeBase64Url,
  extractGmailBody,
  header,
  internalToken,
  normalizePhone,
  parseAddressHeader
};
