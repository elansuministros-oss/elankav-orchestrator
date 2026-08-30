'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOwnerElanGoCommand,
  formatStatus
} = require('../services/ownerElanGoControlService');
const {
  detectOwnerUnifiedCommand
} = require('../services/elanUnifiedOwnerCommandService');

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

test('ELAN GO formatea estado OFF sin exponer credenciales', () => {
  const text = formatStatus({
    enabled: false,
    spendEnabled: false,
    outreachEnabled: false,
    heartbeatAt: null,
    lastCycleAt: null,
    lastError: null
  });

  assert.match(text, /ELAN GO APAGADO/);
  assert.match(text, /BLOQUEADO/);
  assert.doesNotMatch(text, /TOKEN|SERVICE_ROLE|API_KEY/i);
});

test('ELAN GO exige mención explícita del producto para mutaciones', () => {
  assert.equal(detectOwnerElanGoCommand('activa todo'), null);
  assert.equal(detectOwnerElanGoCommand('apaga el servidor'), null);
  assert.equal(detectOwnerElanGoCommand('recarga la tarjeta'), null);
});

test('Unified Runtime prioriza ELAN GO en el camino Owner WhatsApp activo', () => {
  const enable = detectOwnerUnifiedCommand('ELAN, enciende ELAN GO');
  const disable = detectOwnerUnifiedCommand('ELAN, apaga ELAN GO');
  const status = detectOwnerUnifiedCommand('ELAN, estado ELAN GO');

  assert.equal(enable?.elanGoCommand?.type, 'elan_go_enable');
  assert.equal(disable?.elanGoCommand?.type, 'elan_go_disable');
  assert.equal(status?.elanGoCommand?.type, 'elan_go_status');
});
