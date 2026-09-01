'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyAliases,
  learnAlias,
  normalizeOwnerLanguage,
  readProfile
} = require('../services/ownerLanguageProfileService');

test('normalizes common Owner spelling variants', () => {
  const result = applyAliases(
    'ELAN ase una cotisacion y mandala por wassap',
    {
      cotisacion: 'cotizacion',
      wassap: 'whatsapp'
    }
  );

  assert.equal(
    result,
    'elan ase una cotizacion y mandala por whatsapp'
  );
});

test('normalizes known platform pronunciation variants', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  const result = await normalizeOwnerLanguage(
    'revisa la superbase y cargo tran',
    env
  );

  assert.equal(
    result,
    'revisa la supabase y cargo trans'
  );
});

test('learns and persists a confirmed Owner alias', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await learnAlias({
    spoken: 'cotisame',
    canonical: 'cotizame',
    env
  });

  const profile = await readProfile(env);

  assert.equal(
    profile.aliases.cotisame,
    'cotizame'
  );

  const normalized = await normalizeOwnerLanguage(
    'elan cotisame un rotulo',
    env
  );

  assert.equal(
    normalized,
    'elan cotizame un rotulo'
  );
});

test('does not alter numbers or monetary values', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  const input =
    'cotisame 3 rotulos a 300 dolares con 60% y 40%';

  const normalized =
    await normalizeOwnerLanguage(input, env);

  assert.equal(
    normalized,
    'cotizame 3 rotulos a 300 dolares con 60% y 40%'
  );
});

test('personalized Owner language normalization feeds official command router', async () => {
  const {
    detectOwnerCommand,
    OWNER_COMMANDS
  } = require('../services/ownerCommandService');

  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-router-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await learnAlias({
    spoken: 'bentas',
    canonical: 'ventas',
    env
  });

  const normalized = await normalizeOwnerLanguage(
    'ELAN actua como asistente de bentas',
    env
  );

  const command = detectOwnerCommand(normalized);

  assert.equal(command?.type, OWNER_COMMANDS.MODE_SET);
  assert.equal(command?.mode, 'VENTAS');
});

test('personalized normalization preserves amounts while correcting language', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-money-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await learnAlias({
    spoken: 'cotisame',
    canonical: 'cotizame',
    env
  });

  const normalized = await normalizeOwnerLanguage(
    'cotisame 3 rotulos a 275 dolares con 60% de anticipo',
    env
  );

  assert.match(normalized, /\b275\b/);
  assert.match(normalized, /\b60%/);
  assert.equal(
    normalized,
    'cotizame 3 rotulos a 275 dolares con 60% de anticipo'
  );
});

test('Owner can teach a language alias with natural language', async () => {
  const {
    detectOwnerCommand,
    OWNER_COMMANDS
  } = require('../services/ownerCommandService');

  const parsed = detectOwnerCommand(
    'ELAN, cuando digo superbase quiero decir Supabase.'
  );

  assert.equal(parsed?.type, OWNER_COMMANDS.LANGUAGE_LEARN);
  assert.equal(parsed?.spoken, 'superbase');
  assert.equal(parsed?.canonical, 'supabase');
});

test('Owner can teach an alias from a likely voice transcription', async () => {
  const {
    detectOwnerCommand,
    OWNER_COMMANDS
  } = require('../services/ownerCommandService');

  const parsed = detectOwnerCommand(
    'elan aprende que cotisame significa cotizame'
  );

  assert.equal(parsed?.type, OWNER_COMMANDS.LANGUAGE_LEARN);
  assert.equal(parsed?.spoken, 'cotisame');
  assert.equal(parsed?.canonical, 'cotizame');
});

test('learned alias is persisted and reused', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-learn-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await learnAlias({
    spoken: 'bentas',
    canonical: 'ventas',
    env
  });

  const normalized = await normalizeOwnerLanguage(
    'modo bentas',
    env
  );

  assert.equal(normalized, 'modo ventas');
});

test('rejects learning aliases that could modify numeric values', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-protected-number-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await assert.rejects(
    learnAlias({
      spoken: '300',
      canonical: '500',
      env
    }),
    error =>
      error?.code ===
      'OWNER_LANGUAGE_ALIAS_PROTECTED_VALUE'
  );
});

test('rejects learning aliases that contain percentages or monetary symbols', async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'elan-language-protected-money-')
  );

  const env = {
    OWNER_LANGUAGE_PROFILE_STORE_PATH:
      path.join(dir, 'profile.json')
  };

  await assert.rejects(
    learnAlias({
      spoken: '60%',
      canonical: '40%',
      env
    }),
    error =>
      error?.code ===
      'OWNER_LANGUAGE_ALIAS_PROTECTED_VALUE'
  );

  await assert.rejects(
    learnAlias({
      spoken: '$300',
      canonical: '$500',
      env
    }),
    error =>
      error?.code ===
      'OWNER_LANGUAGE_ALIAS_PROTECTED_VALUE'
  );
});
