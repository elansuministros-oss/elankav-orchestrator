'use strict';

class StorageAdapterError extends Error {
  constructor(message, {
    code = 'STORAGE_ADAPTER_ERROR',
    operation = null,
    bucket = null,
    path = null,
    status = null,
    details = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);

    this.name = 'StorageAdapterError';
    this.code = code;
    this.operation = operation;
    this.bucket = bucket;
    this.path = path;
    this.status = status;
    this.details = details;

    if (cause && !this.cause) {
      this.cause = cause;
    }
  }
}

module.exports = {
  StorageAdapterError
};
