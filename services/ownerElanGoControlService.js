'use strict';

const {
  getElanGoControl,
  updateElanGoControl
} = require('./ownerBusinessConnectClient');

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function detectOwnerElanGoCommand(message) {
  const text = normalize(message);
  if (!/\belan go\b/.test(text)) return null;

  if (/\b(enciende|encender|activa|activar|arranca|inicia)\b/.test(text)) {
    return { type: 'elan_go_enable' };
  }
  if (/\b(apaga|apagar|desactiva|desactivar|deten|detener)\b/.test(text)) {
    return { type: 'elan_go_disable' };
  }
  if (/\b(estado|estatus|status|como esta|verifica|revisa)\b/.test(text)) {
    return { type: 'elan_go_status' };
  }
  if (/\b(paga|pagar|recarga|recargar|saldo|pago)\b/.test(text)) {
    return { type: 'elan_go_payment' };
  }
  return null;
}

function formatStatus(control) {
  const enabled = control?.enabled === true;
  const spend = control?.spendEnabled === true;
  const outreach = control?.outreachEnabled === true;
  return [
    enabled ? '🟢 ELAN GO ENCENDIDO' : '🔴 ELAN GO APAGADO',
    '',
    `Búsqueda / gasto: ${spend ? 'PERMITIDO' : 'BLOQUEADO'}`,
    `Contacto comercial: ${outreach ? 'PERMITIDO' : 'BLOQUEADO'}`,
    control?.lastCycleAt ? `Último ciclo: ${control.lastCycleAt}` : 'Último ciclo: sin registro',
    control?.heartbeatAt ? `Heartbeat: ${control.heartbeatAt}` : 'Heartbeat: sin registro',
    control?.lastError ? `Último error: ${control.lastError}` : 'Último error: ninguno'
  ].join('\n');
}

async function executeOwnerElanGoCommand(command, env = process.env) {
  if (command?.type === 'elan_go_enable') {
    const control = await updateElanGoControl({
      enabled: true,
      spendEnabled: true,
      outreachEnabled: true
    }, env);
    return {
      handled: true,
      outputText: [
        '✅ ELAN GO ENCENDIDO.',
        '',
        'ELAN queda autorizado para buscar oportunidades, usar recursos de búsqueda y contactar vendedor/comprador.',
        '',
        formatStatus(control)
      ].join('\n'),
      control
    };
  }

  if (command?.type === 'elan_go_disable') {
    const control = await updateElanGoControl({
      enabled: false,
      spendEnabled: false,
      outreachEnabled: false
    }, env);
    return {
      handled: true,
      outputText: ['✅ ELAN GO APAGADO.', '', formatStatus(control)].join('\n'),
      control
    };
  }

  const control = await getElanGoControl(env);

  if (command?.type === 'elan_go_payment') {
    return {
      handled: true,
      outputText: control?.paymentUrl
        ? ['💳 Pago / recarga ELAN GO', '', control.paymentUrl].join('\n')
        : '💳 ELAN GO todavía no tiene un portal de pago configurado.',
      control
    };
  }

  if (command?.type === 'elan_go_status') {
    return {
      handled: true,
      outputText: formatStatus(control),
      control
    };
  }

  return { handled: false, outputText: '', control: null };
}

module.exports = {
  detectOwnerElanGoCommand,
  executeOwnerElanGoCommand,
  formatStatus
};
