'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_PATH =
  '/var/lib/elankav/orchestrator/owner-language-profile.json';

const PROTECTED_ALIAS_VALUE_PATTERN = /[0-9%$€£¥₡]/;

const DEFAULT_PROFILE = Object.freeze({
  version: 1,
  aliases: Object.freeze({
    cotisame: 'cotizame',
    cotisacion: 'cotizacion',
    cotisaciones: 'cotizaciones',
    superbase: 'supabase',
    wassap: 'whatsapp',
    wasap: 'whatsapp',
    watsap: 'whatsapp',
    'cargo tran': 'cargo trans'
  })
});

function normalizeBasic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getStorePath(env = process.env) {
  return String(
    env.OWNER_LANGUAGE_PROFILE_STORE_PATH || DEFAULT_STORE_PATH
  ).trim() || DEFAULT_STORE_PATH;
}

async function readProfile(env = process.env) {
  try {
    const raw = await fs.readFile(getStorePath(env), 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        version: 1,
        aliases: { ...DEFAULT_PROFILE.aliases }
      };
    }

    return {
      version: 1,
      aliases: {
        ...DEFAULT_PROFILE.aliases,
        ...(parsed.aliases || {})
      }
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version: 1,
        aliases: { ...DEFAULT_PROFILE.aliases }
      };
    }
    throw error;
  }
}

async function writeProfile(profile, env = process.env) {
  const storePath = getStorePath(env);

  await fs.mkdir(path.dirname(storePath), {
    recursive: true,
    mode: 0o700
  });

  const tempPath = `${storePath}.${process.pid}.tmp`;

  await fs.writeFile(
    tempPath,
    `${JSON.stringify(profile, null, 2)}\n`,
    { mode: 0o600 }
  );

  await fs.rename(tempPath, storePath);
}

function applyAliases(value, aliases = {}) {
  let output = normalizeBasic(value);

  const ordered = Object.entries(aliases)
    .map(([from, to]) => [
      normalizeBasic(from),
      normalizeBasic(to)
    ])
    .filter(([from, to]) => from && to && from !== to)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of ordered) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    output = output.replace(
      new RegExp(`\\b${escaped}\\b`, 'g'),
      to
    );
  }

  return output;
}

async function normalizeOwnerLanguage(value, env = process.env) {
  const profile = await readProfile(env);
  return applyAliases(value, profile.aliases);
}

async function learnAlias({
  spoken,
  canonical,
  env = process.env
} = {}) {
  const from = normalizeBasic(spoken);
  const to = normalizeBasic(canonical);

  if (!from || !to || from === to) {
    const error = new Error('OWNER_LANGUAGE_ALIAS_INVALID');
    error.code = 'OWNER_LANGUAGE_ALIAS_INVALID';
    throw error;
  }

  if (
    PROTECTED_ALIAS_VALUE_PATTERN.test(from) ||
    PROTECTED_ALIAS_VALUE_PATTERN.test(to)
  ) {
    const error =
      new Error('OWNER_LANGUAGE_ALIAS_PROTECTED_VALUE');

    error.code =
      'OWNER_LANGUAGE_ALIAS_PROTECTED_VALUE';

    throw error;
  }

  const profile = await readProfile(env);

  profile.aliases[from] = to;

  await writeProfile(profile, env);

  return {
    spoken: from,
    canonical: to
  };
}

module.exports = {
  DEFAULT_STORE_PATH,
  applyAliases,
  getStorePath,
  learnAlias,
  normalizeBasic,
  normalizeOwnerLanguage,
  readProfile,
  writeProfile
};
