'use strict';

const DEFAULT_IDENTITY_ALIASES = Object.freeze({
  '215440458567779': '50588388940'
});

function normalizeIdentity(value) {
  return String(value || '')
    .split('@')[0]
    .replace(/\D/g, '');
}

function readEnvironmentAliases() {
  const raw = String(
    process.env.ELANKAV_IDENTITY_ALIASES_JSON || ''
  ).trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([alias, canonical]) => [
          normalizeIdentity(alias),
          normalizeIdentity(canonical)
        ])
        .filter(([alias, canonical]) => alias && canonical)
    );
  } catch {
    return {};
  }
}

function resolveCanonicalIdentity(value) {
  const receivedId = normalizeIdentity(value);

  if (!receivedId) {
    return Object.freeze({
      receivedId: null,
      canonicalId: null,
      matchedAlias: false,
      source: 'empty'
    });
  }

  const aliases = {
    ...DEFAULT_IDENTITY_ALIASES,
    ...readEnvironmentAliases()
  };

  const canonicalId = aliases[receivedId] || receivedId;

  return Object.freeze({
    receivedId,
    canonicalId,
    matchedAlias: canonicalId !== receivedId,
    source: aliases[receivedId]
      ? (Object.prototype.hasOwnProperty.call(
          readEnvironmentAliases(),
          receivedId
        )
          ? 'environment'
          : 'bootstrap')
      : 'direct'
  });
}

module.exports = {
  DEFAULT_IDENTITY_ALIASES,
  normalizeIdentity,
  resolveCanonicalIdentity
};
