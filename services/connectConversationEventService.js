'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';

function config() {
  const baseUrl = String(
    process.env.ELANKAV_CONNECT_URL ||
    process.env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).replace(/\/+$/, '');
  const token = String(
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.ORCHESTRATOR_INTERNAL_TOKEN ||
    ''
  ).trim();
  return { baseUrl, token };
}

async function publishConversationEvent(event, { fetchImpl = fetch } = {}) {
  const { baseUrl, token } = config();
  if (!token) {
    return { skipped: true, reason: 'CONNECT_INTERNAL_TOKEN_NOT_CONFIGURED' };
  }

  const response = await fetchImpl(`${baseUrl}/console/api/conversations/events`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Elankav-Source': 'ORCHESTRATOR_CONVERSATION_BRIDGE'
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || payload?.error || `CONNECT conversation HTTP ${response.status}`
    );
    error.status = response.status;
    error.code = payload?.error?.code || 'CONNECT_CONVERSATION_EVENT_FAILED';
    throw error;
  }

  return payload;
}

async function publishConversationEventSafely(event, dependencies = {}) {
  try {
    return await publishConversationEvent(event, dependencies);
  } catch (error) {
    console.warn('[CONNECT_CONVERSATION_EVENT_FAILED]', {
      message: error.message,
      code: error.code || null,
      status: error.status || null,
      direction: event?.direction || null,
      chatIdPresent: Boolean(event?.chatId)
    });
    return {
      skipped: true,
      reason: error.code || 'CONNECT_CONVERSATION_EVENT_FAILED'
    };
  }
}

module.exports = {
  publishConversationEvent,
  publishConversationEventSafely
};
