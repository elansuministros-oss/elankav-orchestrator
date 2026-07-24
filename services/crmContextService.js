'use strict';

const {
  fetchCrmDashboard
} = require('../adapters/crmContextAdapter');

const COMMERCIAL_CORE = Object.freeze({
  id: 'elankav-connect',
  name: 'ELANKAV CONNECT',
  role: 'COMMERCIAL_CORE',
  lifecycle: 'ACTIVE',
  official: true
});

function compactIdentity(identity) {
  return {
    canonicalId: identity?.canonical_id || null,
    displayName: identity?.display_name || null,
    entityType: identity?.entity_type || null
  };
}

async function loadCrmContext() {
  try {
    const dashboard = await fetchCrmDashboard();

    return {
      available: true,
      source: dashboard.source || 'ELANKAV_CONNECT',
      commercialCore: COMMERCIAL_CORE,
      status: dashboard.status || 'READY',
      version: dashboard.version || null,
      counts: {
        identities: Number(dashboard.counts?.identities || 0),
        conversations: Number(dashboard.counts?.conversations || 0),
        messages: Number(dashboard.counts?.messages || 0),
        businesses: Number(dashboard.counts?.businesses || 0),
        leads: Number(dashboard.counts?.leads || 0),
        opportunities: Number(dashboard.counts?.opportunities || 0),
        quotes: Number(dashboard.counts?.quotes || 0),
        orders: Number(dashboard.counts?.orders || 0)
      },
      recentIdentities: Array.isArray(dashboard.identities)
        ? dashboard.identities.slice(0, 10).map(compactIdentity)
        : [],
      commercial: dashboard.commercial && typeof dashboard.commercial === 'object'
        ? dashboard.commercial
        : null
    };
  } catch (error) {
    console.error('ELANKAV CONNECT context read error:', {
      code: error.code || null,
      status: error.status || null,
      message: error.message
    });

    return {
      available: false,
      source: 'ELANKAV_CONNECT',
      commercialCore: COMMERCIAL_CORE,
      status: 'UNAVAILABLE',
      error: error.code || error.message || 'CONNECT_CONTEXT_ERROR',
      message: 'ELANKAV CONNECT no estuvo disponible para esta consulta.',
      counts: {
        identities: 0,
        conversations: 0,
        messages: 0,
        businesses: 0,
        leads: 0,
        opportunities: 0,
        quotes: 0,
        orders: 0
      },
      recentIdentities: [],
      commercial: null
    };
  }
}

module.exports = {
  COMMERCIAL_CORE,
  compactIdentity,
  loadCrmContext
};