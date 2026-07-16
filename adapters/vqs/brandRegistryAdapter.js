const {
  VQS_PLATFORM_REGISTRY_VERSION,
  platforms
} = require('../../config/vqsPlatforms');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPlatformBrand(platformId) {
  const key = String(platformId || '').trim().toUpperCase();
  const platform = platforms[key];

  if (!platform || platform.active !== true) {
    return null;
  }

  return clone({
    registryVersion: VQS_PLATFORM_REGISTRY_VERSION,
    ...platform,
    paymentAccounts: platform.paymentAccounts
      .filter((account) => account.active === true)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  });
}

function listActivePlatforms() {
  return Object.values(platforms)
    .filter((platform) => platform.active === true)
    .map((platform) => ({
      platformId: platform.platformId,
      displayName: platform.displayName,
      website: platform.website,
      active: platform.active
    }));
}

module.exports = {
  getPlatformBrand,
  listActivePlatforms
};
