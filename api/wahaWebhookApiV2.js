'use strict';

/**
 * Voice Pipeline V2 adapter.
 *
 * The production webhook contract remains owned by wahaWebhookApi.js. That
 * implementation already provides text and voice handling, deduplication,
 * CONNECT conversation publication, Owner Mode and customer delivery governed
 * exclusively by the published CONNECT runtime.
 *
 * This V2 module must not implement an independent automation switch. It only
 * delegates to the canonical handler so Runtime.execution.shouldRespond is the
 * single source of truth.
 */

const canonicalWebhook = require('./wahaWebhookApi');

async function handleWahaWebhookApiV2(options) {
  return canonicalWebhook.handleWahaWebhookApi(options);
}

module.exports = {
  ...canonicalWebhook,
  handleWahaWebhookApi: handleWahaWebhookApiV2,
  handleWahaWebhookApiV2
};
