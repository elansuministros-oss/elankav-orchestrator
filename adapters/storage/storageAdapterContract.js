'use strict';

const STORAGE_ADAPTER_METHODS = Object.freeze([
  'uploadObject',
  'objectExists',
  'getObjectMetadata',
  'createDelivery',
  'deleteObject'
]);

function assertStorageAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Storage Adapter debe ser un objeto');
  }

  const missingMethods = STORAGE_ADAPTER_METHODS.filter(
    (method) => typeof adapter[method] !== 'function'
  );

  if (missingMethods.length > 0) {
    throw new TypeError(
      `Storage Adapter incompleto. Faltan métodos: ${missingMethods.join(', ')}`
    );
  }

  return adapter;
}

module.exports = {
  STORAGE_ADAPTER_METHODS,
  assertStorageAdapter
};
