'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  handleOwnerEntityCreateContinuity
} = require('../services/ownerEntityCreateContinuityService');
const { readContext } = require('../services/ownerBusinessContextService');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-owner-provider-structured-'));
  const env = {
    OWNER_BUSINESS_CONTEXT_STORE_PATH: path.join(dir, 'context.json'),
    OWNER_ENTITY_CREATE_PENDING_TTL_MS: '900000'
  };
  return {
    env,
    cleanup: () => fs.rm(dir, { recursive: true, force: true })
  };
}

test('structured provider create accepts Empresa and preserves supported CONNECT fields', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const result = await handleOwnerEntityCreateContinuity({
    message: [
      'ELAN, registrá este proveedor en CONNECT.',
      'Empresa: Más Publicidad',
      'Contacto: Katy',
      'WhatsApp / Teléfono: +505 8285 0298',
      'País: Nicaragua',
      'Plataforma: ELANVISUAL',
      'Tipo: Materiales y productos',
      'Categoría: Publicidad / promocionales / impresión'
    ].join('\n'),
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T16:12:00Z')
  });

  assert.equal(result.handled, true);
  assert.equal(result.command.tool, 'crear_proveedor');
  assert.deepEqual(result.command.arguments.data, {
    tradeName: 'Más Publicidad',
    phone: '+50582850298',
    whatsapp: '+50582850298',
    contactName: 'Katy',
    type: 'Materiales y productos',
    country: 'Nicaragua',
    platforms: ['ELANVISUAL'],
    kinds: ['materials_products'],
    categories: ['Publicidad / promocionales / impresión']
  });
});

test('provider continuity retains contact country category platform and type while asking only for missing name', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const first = await handleOwnerEntityCreateContinuity({
    message: [
      'ELAN, registrá este proveedor en CONNECT.',
      'Contacto: Katy',
      'WhatsApp: +505 8285 0298',
      'País: Nicaragua',
      'Plataforma: ELANVISUAL',
      'Tipo: Materiales y productos',
      'Categoría: Publicidad / promocionales / impresión'
    ].join('\n'),
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T16:13:00Z')
  });

  assert.equal(first.handled, true);
  assert.equal(first.command, undefined);
  assert.match(first.reply, /nombre del proveedor/i);

  const pending = (await readContext(env)).pendingEntityCreate;
  assert.equal(pending.type, 'provider');
  assert.equal(pending.data.contactName, 'Katy');
  assert.equal(pending.data.phone, '+50582850298');
  assert.equal(pending.data.country, 'Nicaragua');
  assert.equal(pending.data.type, 'Materiales y productos');
  assert.deepEqual(pending.data.platforms, ['ELANVISUAL']);
  assert.deepEqual(pending.data.kinds, ['materials_products']);
  assert.deepEqual(pending.data.categories, ['Publicidad / promocionales / impresión']);

  const second = await handleOwnerEntityCreateContinuity({
    message: 'Más Publicidad',
    actorKey: '50588388940',
    env,
    now: new Date('2026-08-21T16:14:00Z')
  });

  assert.equal(second.handled, true);
  assert.equal(second.command.tool, 'crear_proveedor');
  assert.deepEqual(second.command.arguments.data, {
    tradeName: 'Más Publicidad',
    phone: '+50582850298',
    whatsapp: '+50582850298',
    contactName: 'Katy',
    type: 'Materiales y productos',
    country: 'Nicaragua',
    platforms: ['ELANVISUAL'],
    kinds: ['materials_products'],
    categories: ['Publicidad / promocionales / impresión']
  });
});

test('Owner WhatsApp structured provider accepts Nombre, Cargo, Facebook and inline ELANVISUAL', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const result = await handleOwnerEntityCreateContinuity({
    message: [
      'ELAN, registra este proveedor para ELANVISUAL.',
      '',
      'Nombre: Impresiones Vida',
      'Contacto: Marvin',
      'Cargo: propietario',
      'WhatsApp: +505 8196 0104',
      'Facebook: https://www.facebook.com/ImpresionesVidaNic',
      'Tipo: proveedor de materiales y servicios de impresión/rotulación.'
    ].join('\n'),
    actorKey: '50588388940',
    env,
    now: new Date('2026-09-05T17:30:00Z')
  });

  assert.equal(result.handled, true);
  assert.equal(result.command.tool, 'crear_proveedor');
  assert.deepEqual(result.command.arguments.data, {
    tradeName: 'Impresiones Vida',
    phone: '+50581960104',
    whatsapp: '+50581960104',
    contactName: 'Marvin',
    contactRole: 'propietario',
    facebook: 'https://www.facebook.com/ImpresionesVidaNic',
    type: 'proveedor de materiales y servicios de impresión/rotulación.',
    platforms: ['ELANVISUAL'],
    kinds: ['materials_products', 'services_subcontracting']
  });
});

test('existing natural complete provider create remains delegated to canonical parser', async t => {
  const { env, cleanup } = await fixture();
  t.after(cleanup);

  const result = await handleOwnerEntityCreateContinuity({
    message: 'ELAN registra proveedor ACME Nicaragua',
    actorKey: '50588388940',
    env
  });

  assert.equal(result.handled, false);
});
