'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORE_PATH = '/var/lib/elankav/orchestrator/operator-modes.json';

const MODES = Object.freeze({
  OWNER_GENERAL: 'OWNER_GENERAL',
  VENTAS: 'VENTAS',
  FINANZAS: 'FINANZAS',
  PRODUCCION: 'PRODUCCION',
  COMPRAS: 'COMPRAS',
  ADMINISTRACION: 'ADMINISTRACION',
  PROGRAMADOR: 'PROGRAMADOR'
});

const ROLE_PROFILES = Object.freeze({
  OWNER: Object.freeze({
    role: 'OWNER',
    defaultMode: MODES.OWNER_GENERAL,
    allowedModes: Object.freeze(Object.values(MODES)),
    canChangeMode: true,
    capabilities: Object.freeze(['*'])
  }),
  VENDEDOR: Object.freeze({
    role: 'VENDEDOR',
    defaultMode: MODES.VENTAS,
    allowedModes: Object.freeze([MODES.VENTAS]),
    canChangeMode: false,
    capabilities: Object.freeze([
      'business.customer.read',
      'business.customer.create',
      'business.quotation.read',
      'business.quotation.calculate',
      'business.quotation.create',
      'business.quotation.send-whatsapp',
      'business.pricing.read',
      'business.price-authorization.use',
      'business.commission.self.read',
      'business.task.self.read'
    ])
  }),
  PRODUCCION: Object.freeze({
    role: 'PRODUCCION',
    defaultMode: MODES.PRODUCCION,
    allowedModes: Object.freeze([MODES.PRODUCCION]),
    canChangeMode: false,
    capabilities: Object.freeze([
      'business.work-order.read',
      'business.production.read',
      'business.production.update',
      'business.inventory.read',
      'business.requirement.read'
    ])
  }),
  COMPRAS: Object.freeze({
    role: 'COMPRAS',
    defaultMode: MODES.COMPRAS,
    allowedModes: Object.freeze([MODES.COMPRAS]),
    canChangeMode: false,
    capabilities: Object.freeze([
      'business.supplier.read',
      'business.logistics.read',
      'business.purchase-order.read',
      'business.purchase-order.create'
    ])
  })
});

const TECHNICAL_OWNER_OPS_CAPABILITIES = Object.freeze([
  'production.audit',
  'server.summary',
  'service.status',
  'service.logs',
  'git.status',
  'file.inspect',
  'test.run',
  'service.restart',
  'git.publish-prepared',
  'repository.deploy'
]);

const MODE_TECHNICAL_CAPABILITIES = Object.freeze({
  [MODES.OWNER_GENERAL]: Object.freeze([]),
  [MODES.VENTAS]: Object.freeze([]),
  [MODES.FINANZAS]: Object.freeze([]),
  [MODES.PRODUCCION]: Object.freeze([]),
  [MODES.COMPRAS]: Object.freeze([]),
  [MODES.ADMINISTRACION]: Object.freeze([]),
  [MODES.PROGRAMADOR]: TECHNICAL_OWNER_OPS_CAPABILITIES
});

const MODE_ALIASES = Object.freeze({
  general: MODES.OWNER_GENERAL,
  'asistente general': MODES.OWNER_GENERAL,
  ventas: MODES.VENTAS,
  vendedor: MODES.VENTAS,
  vendedora: MODES.VENTAS,
  'asistente de ventas': MODES.VENTAS,
  finanzas: MODES.FINANZAS,
  financiero: MODES.FINANZAS,
  produccion: MODES.PRODUCCION,
  'jefe de produccion': MODES.PRODUCCION,
  compras: MODES.COMPRAS,
  'jefe de compras': MODES.COMPRAS,
  administracion: MODES.ADMINISTRACION,
  administrador: MODES.ADMINISTRACION,
  programador: MODES.PROGRAMADOR,
  programacion: MODES.PROGRAMADOR
});

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function resolveMode(value) {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (Object.values(MODES).includes(String(value || '').trim().toUpperCase())) {
    return String(value).trim().toUpperCase();
  }
  return MODE_ALIASES[normalized] || null;
}

function getRoleProfile(role) {
  return ROLE_PROFILES[String(role || '').trim().toUpperCase()] || null;
}

function canUseCapability(role, capability) {
  const profile = getRoleProfile(role);
  if (!profile) return false;
  return profile.capabilities.includes('*') || profile.capabilities.includes(capability);
}

function normalizeModeKey(mode) {
  return resolveMode(mode) ||
    String(mode || '').trim().toUpperCase();
}

function getModeTechnicalCapabilities(mode) {
  const key = normalizeModeKey(mode);

  return MODE_TECHNICAL_CAPABILITIES[key] ||
    Object.freeze([]);
}

function isTechnicalOwnerOpsCapability(capability) {
  return TECHNICAL_OWNER_OPS_CAPABILITIES.includes(
    String(capability || '').trim()
  );
}

function canUseModeCapability(mode, capability) {
  const id = String(capability || '').trim();

  if (!id) return false;

  return getModeTechnicalCapabilities(mode).includes(id);
}

function getStorePath(env = process.env) {
  return String(env.OPERATOR_MODE_STORE_PATH || DEFAULT_STORE_PATH).trim() || DEFAULT_STORE_PATH;
}

async function readStore(env = process.env) {
  try {
    const raw = await fs.readFile(getStorePath(env), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store, env = process.env) {
  const storePath = getStorePath(env);
  await fs.mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, storePath);
}

async function getOperatorState({ operatorId = 'owner', role = 'OWNER', env = process.env } = {}) {
  const profile = getRoleProfile(role);
  if (!profile) {
    const error = new Error('OPERATOR_ROLE_NOT_ALLOWED');
    error.code = 'OPERATOR_ROLE_NOT_ALLOWED';
    throw error;
  }
  const store = await readStore(env);
  const current = store[operatorId] || {};
  const activeMode = profile.allowedModes.includes(current.activeMode)
    ? current.activeMode
    : profile.defaultMode;
  return Object.freeze({
    operatorId,
    role: profile.role,
    activeMode,
    canChangeMode: profile.canChangeMode,
    allowedModes: profile.allowedModes,
    activatedAt: current.activatedAt || null,
    previousMode: current.previousMode || null
  });
}

async function setOperatorMode({ operatorId = 'owner', role = 'OWNER', mode, env = process.env } = {}) {
  const profile = getRoleProfile(role);
  const targetMode = resolveMode(mode);
  if (!profile || !targetMode || !profile.allowedModes.includes(targetMode)) {
    const error = new Error('OPERATOR_MODE_NOT_ALLOWED');
    error.code = 'OPERATOR_MODE_NOT_ALLOWED';
    throw error;
  }
  if (!profile.canChangeMode) {
    const state = await getOperatorState({ operatorId, role, env });
    if (state.activeMode !== targetMode) {
      const error = new Error('OPERATOR_MODE_LOCKED');
      error.code = 'OPERATOR_MODE_LOCKED';
      throw error;
    }
    return state;
  }
  const store = await readStore(env);
  const previousMode = store[operatorId]?.activeMode || profile.defaultMode;
  const activatedAt = new Date().toISOString();
  store[operatorId] = {
    role: profile.role,
    activeMode: targetMode,
    previousMode,
    activatedAt
  };
  await writeStore(store, env);
  return getOperatorState({ operatorId, role, env });
}

function formatModeState(state) {
  return [
    `Modo activo: ${state.activeMode}`,
    `Rol: ${state.role}`,
    `Cambio de modo: ${state.canChangeMode ? 'habilitado' : 'bloqueado por perfil'}`
  ].join('\n');
}

module.exports = {
  DEFAULT_STORE_PATH,
  MODES,
  ROLE_PROFILES,
  TECHNICAL_OWNER_OPS_CAPABILITIES,
  MODE_TECHNICAL_CAPABILITIES,
  canUseCapability,
  canUseModeCapability,
  getModeTechnicalCapabilities,
  isTechnicalOwnerOpsCapability,
  formatModeState,
  getOperatorState,
  getRoleProfile,
  resolveMode,
  setOperatorMode
};
