const {
  VQS_PLATFORM_REGISTRY_VERSION,
  platforms
} = require('../../config/vqsPlatforms');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePlatformLookup(value) {
  return String(value || '')
    .trim()
    .replace(/[_\s]+/g, '')
    .toUpperCase();
}

function findPlatform(platformId) {
  const lookup = normalizePlatformLookup(platformId);
  if (!lookup) return null;

  return Object.values(platforms).find((platform) => {
    const candidates = [
      platform.platformId,
      platform.platformCode,
      platform.canonicalPlatformId
    ];
    return candidates.some((candidate) => normalizePlatformLookup(candidate) === lookup);
  }) || null;
}

function getPlatformBrand(platformId) {
  const platform = findPlatform(platformId);

  if (!platform || platform.active !== true) {
    return null;
  }

  return clone({
    registryVersion: VQS_PLATFORM_REGISTRY_VERSION,
    ...platform,
    canonicalPlatformId: platform.canonicalPlatformId || String(platform.platformId || '').toLowerCase(),
    platformCode: platform.platformCode || String(platform.platformId || '').toUpperCase(),
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
      canonicalPlatformId: platform.canonicalPlatformId || String(platform.platformId || '').toLowerCase(),
      platformCode: platform.platformCode || String(platform.platformId || '').toUpperCase(),
      displayName: platform.displayName,
      website: platform.website,
      active: platform.active
    }));
}

module.exports = {
  normalizePlatformLookup,
  findPlatform,
  getPlatformBrand,
  listActivePlatforms
};
