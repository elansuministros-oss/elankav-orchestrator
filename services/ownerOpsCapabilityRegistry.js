'use strict';

const RISK = Object.freeze({
  READ: 'READ',
  LOW_RISK: 'LOW_RISK',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  DENIED: 'DENIED'
});

const SERVICES = Object.freeze({
  connect: 'elankav-connect.service',
  orchestrator: 'elankav-orchestrator.service'
});

const REPOSITORIES = Object.freeze({
  connect: '/opt/elankav/connect',
  orchestrator: '/opt/elankav/orchestrator'
});

const CAPABILITIES = Object.freeze({
  'production.audit': Object.freeze({ id: 'production.audit', risk: RISK.READ, description: 'Auditoría integral de producción: servidor, servicios, Git y presencia de configuración sin revelar secretos.' }),
  'server.summary': Object.freeze({ id: 'server.summary', risk: RISK.READ, description: 'Resumen de uptime, memoria, disco y estado de servicios ELANKAV.' }),
  'service.status': Object.freeze({ id: 'service.status', risk: RISK.READ, description: 'Consulta si un servicio autorizado está activo.' }),
  'service.logs': Object.freeze({ id: 'service.logs', risk: RISK.READ, description: 'Lee logs recientes de un servicio autorizado.' }),
  'git.status': Object.freeze({ id: 'git.status', risk: RISK.READ, description: 'Consulta rama, commit, cambios locales y diff stat de un repositorio autorizado.' }),
  'service.restart': Object.freeze({ id: 'service.restart', risk: RISK.CONFIRM_REQUIRED, description: 'Reinicia un servicio explícitamente autorizado y verifica que vuelva a estado active.' }),
  'git.publish-prepared': Object.freeze({ id: 'git.publish-prepared', risk: RISK.CONFIRM_REQUIRED, description: 'Publica una rama local preparada y validada, y crea Pull Request sin merge ni deploy.' }),
  'repository.deploy': Object.freeze({ id: 'repository.deploy', risk: RISK.CONFIRM_REQUIRED, description: 'Actualiza un repositorio autorizado mediante fast-forward a un commit remoto exacto, crea backup y verifica el servicio.' }),

  'business.customer.read': Object.freeze({ id: 'business.customer.read', risk: RISK.READ, description: 'Consulta clientes oficiales mediante CONNECT.' }),
  'business.customer.create': Object.freeze({ id: 'business.customer.create', risk: RISK.LOW_RISK, description: 'Crea un cliente en la autoridad oficial de CONNECT.' }),
  'business.quotation.read': Object.freeze({ id: 'business.quotation.read', risk: RISK.READ, description: 'Consulta cotizaciones oficiales.' }),
  'business.quotation.calculate': Object.freeze({ id: 'business.quotation.calculate', risk: RISK.READ, description: 'Calcula una propuesta usando biblioteca oficial, logística y autorizaciones vigentes.' }),
  'business.quotation.create': Object.freeze({ id: 'business.quotation.create', risk: RISK.LOW_RISK, description: 'Crea una cotización oficial en CONNECT sin enviarla externamente.' }),
  'business.quotation.send-whatsapp': Object.freeze({ id: 'business.quotation.send-whatsapp', risk: RISK.CONFIRM_REQUIRED, description: 'Envía una cotización oficial al cliente por WhatsApp.' }),
  'business.quotation.approve': Object.freeze({ id: 'business.quotation.approve', risk: RISK.LOW_RISK, description: 'Registra aprobación comercial de una cotización oficial.' }),
  'business.payment.prepare': Object.freeze({ id: 'business.payment.prepare', risk: RISK.READ, description: 'Extrae y valida comprobante antes de registrar dinero.' }),
  'business.payment.apply': Object.freeze({ id: 'business.payment.apply', risk: RISK.CONFIRM_REQUIRED, description: 'Registra un movimiento financiero oficial y genera su recibo.' }),
  'business.receipt.read': Object.freeze({ id: 'business.receipt.read', risk: RISK.READ, description: 'Consulta recibos oficiales.' }),
  'business.work-order.read': Object.freeze({ id: 'business.work-order.read', risk: RISK.READ, description: 'Consulta órdenes de trabajo oficiales.' }),
  'business.work-order.create': Object.freeze({ id: 'business.work-order.create', risk: RISK.LOW_RISK, description: 'Crea una orden de trabajo oficial vinculada a la operación.' }),
  'business.purchase-order.create': Object.freeze({ id: 'business.purchase-order.create', risk: RISK.CONFIRM_REQUIRED, description: 'Crea una orden de compra con compromiso económico.' }),
  'business.price-authorization.read': Object.freeze({ id: 'business.price-authorization.read', risk: RISK.READ, description: 'Consulta excepciones de precio autorizadas por Owner.' }),
  'business.price-authorization.create': Object.freeze({ id: 'business.price-authorization.create', risk: RISK.CONFIRM_REQUIRED, description: 'Crea una excepción comercial de precio autorizada por Owner.' }),
  'business.price-authorization.revoke': Object.freeze({ id: 'business.price-authorization.revoke', risk: RISK.CONFIRM_REQUIRED, description: 'Revoca una autorización comercial de precio vigente.' }),
  'business.logistics.read': Object.freeze({ id: 'business.logistics.read', risk: RISK.READ, description: 'Consulta reglas, rutas y tarifas logísticas oficiales.' }),
  'business.logistics.rule.write': Object.freeze({ id: 'business.logistics.rule.write', risk: RISK.LOW_RISK, description: 'Registra una regla logística proporcionada por Owner sin crear transacciones financieras.' })
});

function getCapability(id) {
  return CAPABILITIES[id] || null;
}

function resolveService(alias) {
  return SERVICES[String(alias || '').toLowerCase()] || null;
}

function resolveRepository(alias) {
  return REPOSITORIES[String(alias || '').toLowerCase()] || null;
}

function listCapabilities() {
  return Object.values(CAPABILITIES);
}

module.exports = {
  CAPABILITIES,
  RISK,
  getCapability,
  listCapabilities,
  resolveRepository,
  resolveService
};
