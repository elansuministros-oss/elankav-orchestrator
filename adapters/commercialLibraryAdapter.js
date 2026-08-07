'use strict';

/**
 * ELANKAV CORE commercial-library integration removed.
 *
 * Commercial knowledge is now sourced through ELANKAV CONNECT by
 * services/connectPlatformKnowledgeService.js.
 *
 * This compatibility shim remains temporarily because
 * services/commercialContextService.js still imports fetchCommercialOffer().
 * It performs no HTTP request and cannot reach ELANKAV CORE.
 */
async function fetchCommercialOffer() {
  return null;
}

module.exports = {
  fetchCommercialOffer
};
