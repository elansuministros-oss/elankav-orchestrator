const {
  VQS_EXECUTIVE_REGISTRY_VERSION,
  executives
} = require('../../config/vqsExecutives');

function getExecutive(executiveId, platformId) {
  const executive = executives[executiveId];
  if (!executive || !executive.active) return null;
  if (platformId && !executive.platforms.includes(platformId)) return null;

  return {
    ...executive,
    registryVersion: VQS_EXECUTIVE_REGISTRY_VERSION
  };
}

function listExecutives(platformId) {
  return Object.values(executives)
    .filter((executive) => executive.active)
    .filter((executive) => !platformId || executive.platforms.includes(platformId))
    .map((executive) => ({
      ...executive,
      registryVersion: VQS_EXECUTIVE_REGISTRY_VERSION
    }));
}

module.exports = {
  getExecutive,
  listExecutives
};
