'use strict';

/**
 * Reversible bootstrap for Voice Pipeline V2.
 *
 * This file does not modify the legacy webhook module. When the feature flag is
 * true, it preloads the V2 handler under the legacy module path before loading
 * server.js. When false, server.js loads the original handler normally.
 */

const enabled = String(process.env.VOICE_PIPELINE_V2_ENABLED || '').toLowerCase() === 'true';

// Patch Owner business customer formatting before ownerCommandService is loaded,
// so WhatsApp can honor requested official customer profile fields.
require('./services/ownerBusinessCustomerFieldsPatch');

// Preload the OWNER OPS supervisor bridge before any webhook/message service is
// required so WhatsApp Owner commands can use the external supervisor safely.
require('./services/ownerOpsSupervisorCommandPatch');

if (enabled) {
  const legacyModulePath = require.resolve('./api/wahaWebhookApi');
  const v2Exports = require('./api/wahaWebhookApiV2');

  require.cache[legacyModulePath] = {
    id: legacyModulePath,
    filename: legacyModulePath,
    loaded: true,
    exports: v2Exports,
    children: [],
    paths: module.paths
  };

  console.log('[VOICE_PIPELINE_V2]', {
    stage: 'BOOTSTRAP_ENABLED',
    handler: 'api/wahaWebhookApiV2.js'
  });
} else {
  console.log('[VOICE_PIPELINE_V2]', {
    stage: 'BOOTSTRAP_DISABLED',
    handler: 'api/wahaWebhookApi.js'
  });
}

require('./server');
