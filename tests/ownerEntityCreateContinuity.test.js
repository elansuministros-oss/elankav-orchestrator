'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  handleOwnerEntityCreateContinuity,
  clearPendingEntityCreate
} = require('../services/ownerEntityCreateContinuityService');
const { readContext } = require('../services/ownerBusinessContextService');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-owner-entity-continuity-'));
  const env = {
    OWNER_BUSINESS_CONTEXT_STORE_PATH: path.join(dir, 'context.json'),
    OWNER_ENTITY_CREATE_PENDING_TTL_MS: '900000'
  };
  return {
    env,
    cleanup: () => fs.rm(dir, { recursive: true, force: true })
  };
}

test('family create keeps intent when ELAN asks for the missing name', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const first = await handleOwnerEntityCreateContinuity({
    message: 'ELAN agrega a un familiar',
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T03:40:00Z')
  });

  assert.equal(first.handled, true);
  assert.equal(first.command, undefined);
  assert.match(first.reply, /nombre del familiar/i);

  const stored = await readContext(env);
  assert.equal(stored.pendingEntityCreate.type, 'family');
  assert.equal(stored.pendingEntityCreate.actorKey, '50588388940');

  const second = await handleOwnerEntityCreateContinuity({
    message: 'Vicky Lulu.',
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T03:41:00Z')
  });

  assert.equal(second.handled, true);
  assert.equal(second.command.tool, 'crear_familiar');
  assert.equal(second.command.arguments.data.displayName, 'Vicky Lulu');
  assert.deepEqual(second.command.arguments.data.platforms, ['ELANVISUAL']);
});

test('generic person data can be completed by a later Como familia reply', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const first = await handleOwnerEntityCreateContinuity({
    message: 'Quiero que registre a: Meylin Cano Brenes +505 7507 9846',
    actorKey: 'owner@c.us',
    env,
    now: new Date('2026-08-21T03:45:00Z')
  });

  assert.equal(first.handled, true);
  assert.equal(first.command, undefined);
  assert.match(first.reply, /cliente, proveedor o familiar/i);

  const pending = (await readContext(env)).pendingEntityCreate;
  assert.equal(pending.type, null);
  assert.equal(pending.data.name, 'Meylin Cano Brenes');
  assert.equal(pending.data.phone, '+50575079846');

  const second = await handleOwnerEntityCreateContinuity({
    message: 'Cómo familia',
    actorKey: 'owner@c.us',
    env,
    now: new Date('2026-08-21T03:46:00Z')
  });

  assert.equal(second.handled, true);
  assert.equal(second.command.tool, 'crear_familiar');
  assert.deepEqual(second.command.arguments.data, {
    displayName: 'Meylin Cano Brenes',
    phone: '+50575079846',
    whatsapp: '+50575079846',
    platforms: ['ELANVISUAL']
  });
});

test('explicit complete family create stays on the existing canonical parser', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const result = await handleOwnerEntityCreateContinuity({
    message: 'ELAN registra familiar Meylin Cano Brenes',
    actorKey: '50588388940',
    env
  });

  assert.equal(result.handled, false);
  assert.equal((await readContext(env)).pendingEntityCreate, undefined);
});

test('seller registration is never hijacked by generic entity continuity', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const result = await handleOwnerEntityCreateContinuity({
    message: 'ELAN registra vendedor Valentina Ramos',
    actorKey: '50588388940',
    env
  });

  assert.equal(result.handled, false);
});

test('unrelated ELAN operational command does not become a family name', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  await handleOwnerEntityCreateContinuity({
    message: 'ELAN agrega a un familiar',
    actorKey: '50588388940',
    env
  });

  const result = await handleOwnerEntityCreateContinuity({
    message: 'ELAN actívate',
    actorKey: '50588388940',
    env
  });

  assert.equal(result.handled, false);
  assert.equal((await readContext(env)).pendingEntityCreate.type, 'family');
});

test('pending entity create can be cancelled without writing anything', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  await handleOwnerEntityCreateContinuity({
    message: 'ELAN agrega a un familiar',
    actorKey: '50588388940',
    env
  });

  const result = await handleOwnerEntityCreateContinuity({
    message: 'cancelalo',
    actorKey: '50588388940',
    env
  });

  assert.equal(result.handled, true);
  assert.equal(result.cancelled, true);
  assert.match(result.reply, /No hice cambios en CONNECT/i);
  assert.equal((await readContext(env)).pendingEntityCreate, null);
});

test('expired pending transaction does not intercept a later message', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);
  env.OWNER_ENTITY_CREATE_PENDING_TTL_MS = '60000';

  await handleOwnerEntityCreateContinuity({
    message: 'ELAN agrega a un familiar',
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T03:40:00Z')
  });

  const result = await handleOwnerEntityCreateContinuity({
    message: 'Vicky Lulu',
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T03:42:00Z')
  });

  assert.equal(result.handled, false);
  assert.equal((await readContext(env)).pendingEntityCreate, null);
});

test('pending transaction is scoped to the owner actor that started it', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  await handleOwnerEntityCreateContinuity({
    message: 'ELAN agrega a un familiar',
    actorKey: 'owner-one',
    env
  });

  const otherOwner = await handleOwnerEntityCreateContinuity({
    message: 'Vicky Lulu',
    actorKey: 'owner-two',
    env
  });

  assert.equal(otherOwner.handled, false);

  const originalOwner = await handleOwnerEntityCreateContinuity({
    message: 'Vicky Lulu',
    actorKey: 'owner-one',
    env
  });

  assert.equal(originalOwner.command.tool, 'crear_familiar');
  await clearPendingEntityCreate(env);
});
