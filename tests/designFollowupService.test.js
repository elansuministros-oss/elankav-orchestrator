'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  processDesignFollowup
} = require('../services/designFollowupService');

function readyRow(overrides = {}) {
  return {
    id: 'request-1',
    request_code: 'DESIGN-MRMB3IOK-9210',
    status: 'ready',
    whatsapp: '50578828089',
    external_user_id: null,
    request_type: 'logo',
    installation_environment: null,
    revision_number: 1,
    workflow_stage: 'concept',
    files: [],
    result_files: [{
      kind: 'generated-logo',
      bucket: 'design-request-assets',
      path: 'DESIGN-MRMB3IOK-9210/logo.png'
    }],
    design_result: { designId: 'logo-1' },
    version_history: [],
    completed_at: '2026-07-15T10:42:00.000Z',
    ...overrides
  };
}

test('DESIGN-FOLLOWUP-01 explica cómo continuar al recibir solo el código', async () => {
  const result = await processDesignFollowup({
    message: 'DESIGN-MRMB3IOK-9210',
    phone: '+505 7882 8089',
    adapter: {
      async findRequestByCode() { return readyRow(); }
    }
  });

  assert.equal(result.handled, true);
  assert.match(result.outputText, /CAMBIOS DESIGN-MRMB3IOK-9210/);
  assert.match(result.outputText, /RENDER DESIGN-MRMB3IOK-9210/);
});

test('DESIGN-FOLLOWUP-01 crea una revisión usando el resultado anterior', async () => {
  let queued;
  const result = await processDesignFollowup({
    message: 'CAMBIOS DESIGN-MRMB3IOK-9210: fondo blanco y letras más oscuras',
    phone: '50578828089',
    adapter: {
      async findRequestByCode() { return readyRow(); },
      async queueFollowup(id, values) {
        queued = { id, values };
        return { id };
      }
    }
  });

  assert.equal(result.completed, true);
  assert.equal(queued.values.workflow_stage, 'revision');
  assert.equal(queued.values.revision_number, 2);
  assert.equal(queued.values.files[0].kind, 'reference');
  assert.match(queued.values.design_notes, /fondo blanco/);
});

test('DESIGN-FOLLOWUP-01 convierte el logo aprobado en render', async () => {
  let queued;
  const result = await processDesignFollowup({
    message: 'RENDER DESIGN-MRMB3IOK-9210: rótulo exterior 100 x 80 cm sobre pared blanca',
    phone: '50578828089',
    adapter: {
      async findRequestByCode() { return readyRow(); },
      async queueFollowup(_id, values) {
        queued = values;
        return { id: 'request-1' };
      }
    }
  });

  assert.equal(result.completed, true);
  assert.equal(queued.workflow_stage, 'render');
  assert.equal(queued.request_type, 'rotulo');
  assert.equal(queued.installation_environment, 'exterior');
  assert.equal(queued.width_cm, 100);
  assert.equal(queued.height_cm, 80);
  assert.equal(queued.files[0].kind, 'logo');
  assert.match(queued.design_notes, /exactamente el logo aprobado/);
});

test('DESIGN-FOLLOWUP-01 no permite modificar solicitudes de otro WhatsApp', async () => {
  const result = await processDesignFollowup({
    message: 'CAMBIOS DESIGN-MRMB3IOK-9210: cambiar el color',
    phone: '50500000000',
    adapter: {
      async findRequestByCode() {
        return readyRow({ external_user_id: '168999999999999' });
      },
      async queueFollowup() { throw new Error('no esperado'); }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.match(result.outputText, /No pude identificar/);
});

test('DESIGN-FOLLOWUP-01 vincula una solicitud creada con teléfono al LID de WAHA', async () => {
  let claim;
  const result = await processDesignFollowup({
    message: 'DESIGN-MRMB3IOK-9210',
    phone: '168534952960065',
    externalUserId: '168534952960065',
    adapter: {
      async findRequestByCode() {
        return readyRow({ external_user_id: '50578828089' });
      },
      async claimRequestIdentity(input) {
        claim = input;
        return readyRow({ external_user_id: input.externalUserId });
      }
    }
  });

  assert.equal(claim.previousExternalUserId, '50578828089');
  assert.equal(claim.externalUserId, '168534952960065');
  assert.equal(result.handled, true);
  assert.match(result.outputText, /CAMBIOS DESIGN-MRMB3IOK-9210/);
});
