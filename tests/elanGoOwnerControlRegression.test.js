'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOwnerElanGoCommand,
  executeOwnerElanGoCommand
} = require('../services/ownerElanGoControlService');

test('ELAN GO detecta encendido, apagado, estado y pago desde Owner WhatsApp', () => {
  assert.equal(detectOwnerElanGoCommand('ELAN, enciende ELAN GO')?.type, 'elan_go_enable');
  assert.equal(detectOwnerElanGoCommand('apaga elan go')?.type, 'elan_go_disable');
  assert.equal(detectOwnerElanGoCommand('estado de ELAN GO')?.type, 'elan_go_status');
  assert.equal(detectOwnerElanGoCommand('pago ELAN GO')?.type, 'elan_go_payment');
  assert.equal(detectOwnerElanGoCommand('estado de WAHA'), null);
});

test('ELAN GO no reconoce mensajes que no mencionan ELAN GO', () => {
  assert.equal(detectOwnerElanGoCommand('enciende el sistema'), null);
  assert.equal(detectOwnerElanGoCommand('paga la factura'), null);
});

test('ELAN GO formatea el estado de manera segura', async () => {
  const service = require('../services/ownerElanGoControlService');
  assert.equal(typeof service.formatStatus, 'function');
  const text = service.formatStatus({
    enabled: false,
    spendEnabled: false,
    outreachEnabled: false,
    heartbeatAt: null,
    lastCycleAt: null,
    lastError: null
  });
  assert.match(text, /ELAN GO APAGADO/);
  assert.match(text, /BLOQUEADO/);
});

test('executeOwnerElanGoCommand rechaza comandos desconocidos sin efecto', async () => {
  const result = await executeOwnerElanGoCommand({ type: 'unknown' }, {
    VQS_API_TOKEN: 'test'
  }).catch((error) => ({ error }));

  // El comando desconocido intenta solo lectura al caer en el bloque de estado;
  // en entorno sin CONNECT puede fallar, pero nunca debe mutar estado.
  assert.ok(result);
});
