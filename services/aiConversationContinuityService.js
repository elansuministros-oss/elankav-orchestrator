'use strict';

const conversations = new Map();

function keyOf({ platform, externalUserId, phone }) {
  const identity = String(externalUserId || phone || '').trim();
  return `${String(platform || '').trim().toLowerCase()}:${identity}`;
}

function settingsOf(config = {}) {
  return {
    enabled: config.enabled !== false,
    historyLimit: Math.max(2, Math.min(Number(config.historyLimit || 12), 30)),
    ttlMinutes: Math.max(5, Math.min(Number(config.ttlMinutes || 1440), 10080))
  };
}

function getHistory(identity, continuityConfig) {
  const settings = settingsOf(continuityConfig);
  if (!settings.enabled) return [];
  const key = keyOf(identity);
  const current = conversations.get(key);
  if (!current) return [];
  if (Date.now() - current.updatedAt > settings.ttlMinutes * 60 * 1000) {
    conversations.delete(key);
    return [];
  }
  return current.messages.slice(-settings.historyLimit);
}

function appendTurn(identity, continuityConfig, userMessage, assistantMessage) {
  const settings = settingsOf(continuityConfig);
  if (!settings.enabled) return;
  const key = keyOf(identity);
  const current = conversations.get(key) || { messages: [], updatedAt: Date.now() };
  current.messages.push({ role: 'user', content: String(userMessage || '').trim() });
  current.messages.push({ role: 'assistant', content: String(assistantMessage || '').trim() });
  current.messages = current.messages.filter(item => item.content).slice(-settings.historyLimit);
  current.updatedAt = Date.now();
  conversations.set(key, current);
}

function clearConversation(identity) {
  conversations.delete(keyOf(identity));
}

module.exports = { getHistory, appendTurn, clearConversation, settingsOf };
