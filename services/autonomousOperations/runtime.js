'use strict';

const { AutonomousOperationService } = require('./autonomousOperationService');
const { MemoryOperationRepository } = require('./memoryOperationRepository');

const repository = new MemoryOperationRepository();
const service = new AutonomousOperationService({ repository });

function getAutonomousOperationService() {
  return service;
}

function getAutonomousOperationRepository() {
  return repository;
}

module.exports = {
  getAutonomousOperationService,
  getAutonomousOperationRepository
};
