'use strict';

const PLATFORM_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'elanvisual',
    aliases: Object.freeze(['elanvisual', 'elan visual', 'visual', 'visual.elankav.com'])
  }),
  Object.freeze({
    id: 'elanhome',
    aliases: Object.freeze(['elanhome', 'elan home', 'home'])
  }),
  Object.freeze({
    id: 'elanpet',
    aliases: Object.freeze(['elanpet', 'elan pet', 'pet', 'pet.elankav.com'])
  }),
  Object.freeze({
    id: 'elancenter',
    aliases: Object.freeze(['elancenter', 'elan center', 'center'])
  }),
  Object.freeze({
    id: 'elan-ai',
    aliases: Object.freeze(['elan ai', 'elan-ai', 'elania', 'inteligencia elan'])
  }),
  Object.freeze({
    id: 'orchestrator',
    aliases: Object.freeze(['orchestrator', 'orquestador', 'elankav orchestrator'])
  }),
  Object.freeze({
    id: 'elankav',
    aliases: Object.freeze(['elankav', 'ecosistema elankav'])
  })
]);

function normalizeResolverText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[^a-z0-9.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasMatches(text, alias) {
  const normalizedAlias = normalizeResolverText(alias);
  if (!text || !normalizedAlias) return false;

  if (normalizedAlias.includes('.') || normalizedAlias.includes('-')) {
    return text.includes(normalizedAlias);
  }

  return (` ${text} `).includes(` ${normalizedAlias} `);
}

function findPlatform(value) {
  const text = normalizeResolverText(value);
  if (!text) return null;

  for (const definition of PLATFORM_DEFINITIONS) {
    for (const alias of definition.aliases) {
      if (aliasMatches(text, alias)) {
        return Object.freeze({
          platform: definition.id,
          matchedAlias: alias
        });
      }
    }
  }

  return null;
}

function resolvePlatform({ platform, message, metadata } = {}) {
  const explicit = findPlatform(platform);
  if (explicit) {
    return Object.freeze({
      platform: explicit.platform,
      source: 'explicit',
      matchedAlias: explicit.matchedAlias,
      confidence: 1
    });
  }

  const metadataPlatform = findPlatform(
    metadata?.platform ||
    metadata?.business ||
    metadata?.application ||
    metadata?.sourcePlatform
  );
  if (metadataPlatform) {
    return Object.freeze({
      platform: metadataPlatform.platform,
      source: 'metadata',
      matchedAlias: metadataPlatform.matchedAlias,
      confidence: 0.95
    });
  }

  const inferred = findPlatform(message);
  if (inferred) {
    return Object.freeze({
      platform: inferred.platform,
      source: 'message',
      matchedAlias: inferred.matchedAlias,
      confidence: 0.8
    });
  }

  return Object.freeze({
    platform: null,
    source: 'unresolved',
    matchedAlias: null,
    confidence: 0
  });
}

module.exports = {
  PLATFORM_DEFINITIONS,
  normalizeResolverText,
  findPlatform,
  resolvePlatform
};
