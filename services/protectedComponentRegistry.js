'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, '..', 'config', 'protected-components.json');
const ALLOWED_TARGETS = new Set(['orchestrator', 'connect']);
const ALLOWED_CONTRACTS = new Set([
  'owner_whatsapp_core',
  'owner_prospecting_bridge',
  'provider_recruitment_orchestrator',
  'prospecting_research_connect',
  'provider_recruitment_connect',
  'elan_go_control_connect'
]);

function loadProtectedComponentRegistry(filePath = REGISTRY_PATH) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed?.components)) {
    const error = new Error('PROTECTED_COMPONENT_REGISTRY_INVALID');
    error.code = 'PROTECTED_COMPONENT_REGISTRY_INVALID';
    throw error;
  }

  const ids = new Set();
  const components = parsed.components.map(item => {
    const id = String(item?.id || '').trim();
    const target = String(item?.target || '').trim();
    const contract = String(item?.contract || '').trim();

    if (!/^[A-Z0-9_]+$/.test(id)) {
      const error = new Error('PROTECTED_COMPONENT_ID_INVALID');
      error.code = 'PROTECTED_COMPONENT_ID_INVALID';
      throw error;
    }
    if (ids.has(id)) {
      const error = new Error('PROTECTED_COMPONENT_ID_DUPLICATE');
      error.code = 'PROTECTED_COMPONENT_ID_DUPLICATE';
      throw error;
    }
    if (!ALLOWED_TARGETS.has(target)) {
      const error = new Error('PROTECTED_COMPONENT_TARGET_INVALID');
      error.code = 'PROTECTED_COMPONENT_TARGET_INVALID';
      throw error;
    }
    if (!ALLOWED_CONTRACTS.has(contract)) {
      const error = new Error('PROTECTED_COMPONENT_CONTRACT_DENIED');
      error.code = 'PROTECTED_COMPONENT_CONTRACT_DENIED';
      throw error;
    }

    ids.add(id);
    return Object.freeze({
      id,
      target,
      contract,
      critical: item?.critical !== false,
      description: String(item?.description || '').trim()
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    policy: String(parsed.policy || '').trim(),
    components: Object.freeze(components)
  });
}

function getProtectedComponentsForTarget(target, registry = loadProtectedComponentRegistry()) {
  const normalized = String(target || '').trim();
  return registry.components.filter(component => component.target === normalized);
}

module.exports = {
  ALLOWED_CONTRACTS,
  ALLOWED_TARGETS,
  REGISTRY_PATH,
  getProtectedComponentsForTarget,
  loadProtectedComponentRegistry
};
