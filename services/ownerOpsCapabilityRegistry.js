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
  'channels.audit': Object.freeze({ id: 'channels.audit', risk: RISK.READ, description: 'Comprueba el puente interno CONNECT ↔ ORCHESTRATOR y estados multicanal sin enviar mensajes ni revelar secretos.' }),
  'channels.email-test': Object.freeze({ id: 'channels.email-test', risk: RISK.LOW_RISK, description: 'Envía una prueba controlada únicamente a la misma identidad visual@elankav.com o go@elankav.com.' }),
  'server.summary': Object.freeze({ id: 'server.summary', risk: RISK.READ, description: 'Resumen de uptime, memoria, disco y estado de servicios ELANKAV.' }),
  'service.status': Object.freeze({ id: 'service.status', risk: RISK.READ, description: 'Consulta si un servicio autorizado está activo.' }),
  'service.logs': Object.freeze({ id: 'service.logs', risk: RISK.READ, description: 'Lee logs recientes de un servicio autorizado.' }),
  'git.status': Object.freeze({ id: 'git.status', risk: RISK.READ, description: 'Consulta rama, commit, cambios locales y diff stat de un repositorio autorizado.' }),
  'file.inspect': Object.freeze({ id: 'file.inspect', risk: RISK.READ, description: 'Lee archivos operativos explícitamente autorizados sin revelar archivos secretos ni aceptar rutas arbitrarias.' }),
  'test.run': Object.freeze({ id: 'test.run', risk: RISK.READ, description: 'Ejecuta suites de pruebas explícitamente registradas sin aceptar comandos shell arbitrarios.' }),
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
  'business.logistics.rule.write': Object.freeze({ id: 'business.logistics.rule.write', risk: RISK.LOW_RISK, description: 'Registra una regla logística proporcionada por Owner sin crear transacciones financieras.' }),
  'business.customer.update': Object.freeze({ id: 'business.customer.update', risk: RISK.LOW_RISK, description: 'Actualiza o desactiva un cliente en la autoridad oficial.' }),
  'business.provider.read': Object.freeze({ id: 'business.provider.read', risk: RISK.READ, description: 'Consulta proveedores oficiales mediante CONNECT.' }),
  'business.provider.create': Object.freeze({ id: 'business.provider.create', risk: RISK.LOW_RISK, description: 'Crea un proveedor oficial mediante CONNECT.' }),
  'business.provider.update': Object.freeze({ id: 'business.provider.update', risk: RISK.LOW_RISK, description: 'Actualiza o desactiva un proveedor oficial.' }),
  'business.seller.read': Object.freeze({ id: 'business.seller.read', risk: RISK.READ, description: 'Consulta vendedores oficiales y sus plataformas.' }),
  'business.seller.create': Object.freeze({ id: 'business.seller.create', risk: RISK.CONFIRM_REQUIRED, description: 'Registra un vendedor y acceso comercial.' }),
  'business.seller.update': Object.freeze({ id: 'business.seller.update', risk: RISK.CONFIRM_REQUIRED, description: 'Actualiza o desactiva un vendedor.' }),
  'business.seller.delete': Object.freeze({ id: 'business.seller.delete', risk: RISK.CONFIRM_REQUIRED, description: 'Elimina un vendedor cuando la política lo permite.' }),
  'business.seller.platforms.write': Object.freeze({ id: 'business.seller.platforms.write', risk: RISK.CONFIRM_REQUIRED, description: 'Administra plataformas permitidas de un vendedor.' }),
  'business.family.read': Object.freeze({ id: 'business.family.read', risk: RISK.READ, description: 'Consulta integrantes familiares registrados.' }),
  'business.family.create': Object.freeze({ id: 'business.family.create', risk: RISK.CONFIRM_REQUIRED, description: 'Registra un integrante familiar.' }),
  'business.family.update': Object.freeze({ id: 'business.family.update', risk: RISK.CONFIRM_REQUIRED, description: 'Actualiza o desactiva un integrante familiar.' }),
  'business.contact.read': Object.freeze({ id: 'business.contact.read', risk: RISK.READ, description: 'Busca contactos oficiales en CONNECT.' }),
  'business.price.read': Object.freeze({ id: 'business.price.read', risk: RISK.READ, description: 'Consulta catálogo y precios oficiales autorizados.' }),
  'business.price.resolve': Object.freeze({ id: 'business.price.resolve', risk: RISK.READ, description: 'Resuelve precio oficial aplicable para una solicitud.' }),
  'business.quotation.update': Object.freeze({ id: 'business.quotation.update', risk: RISK.LOW_RISK, description: 'Actualiza una cotización oficial.' }),
  'business.quotation.media.update': Object.freeze({ id: 'business.quotation.media.update', risk: RISK.LOW_RISK, description: 'Administra imágenes de una cotización oficial.' }),
  'business.payment.read': Object.freeze({ id: 'business.payment.read', risk: RISK.READ, description: 'Consulta pagos oficiales de una cotización.' }),
  'business.design.read': Object.freeze({ id: 'business.design.read', risk: RISK.READ, description: 'Consulta estado de solicitudes de diseño.' }),
  'business.design.create': Object.freeze({ id: 'business.design.create', risk: RISK.LOW_RISK, description: 'Crea una solicitud de diseño oficial.' }),
  'business.design.update': Object.freeze({ id: 'business.design.update', risk: RISK.LOW_RISK, description: 'Revisa o actualiza una solicitud de diseño.' }),
  'business.design.send-whatsapp': Object.freeze({ id: 'business.design.send-whatsapp', risk: RISK.CONFIRM_REQUIRED, description: 'Envía un diseño por WhatsApp.' }),
  'business.whatsapp.send': Object.freeze({ id: 'business.whatsapp.send', risk: RISK.CONFIRM_REQUIRED, description: 'Envía un mensaje WhatsApp desde el gateway oficial.' })
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
