'use strict';

const {
  fetchCrmDashboard
} = require('../adapters/crmContextAdapter');

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
      status: dashboard.status || 'READY',
      version: dashboard.version || null,
      counts: {
        identities: Number(dashboard.counts?.identities || 0),
        conversations: Number(dashboard.counts?.conversations || 0),
        messages: Number(dashboard.counts?.messages || 0)
      },
      recentIdentities: Array.isArray(dashboard.identities)
        ? dashboard.identities.slice(0, 10).map(compactIdentity)
        : []
    };
  } catch (error) {
    console.error('CRM Context read error:', {
      code: error.code || null,
      status: error.status || null,
      message: error.message
    });

    return {
      available: false,
      status: 'UNAVAILABLE',
      error: error.code || error.message || 'CRM_CONTEXT_ERROR',
      counts: {
        identities: 0,
        conversations: 0,
        messages: 0
      },
      recentIdentities: []
    };
  }
}

module.exports = {
  loadCrmContext
};
