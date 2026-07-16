import { PROJECT_EVENT_TYPES } from '../../modules/quoteCore/quoteProjectContract.js';

export function createProjectEvent(input = {}) {
  if (!PROJECT_EVENT_TYPES.includes(input.type)) {
    throw new Error(`Tipo de evento no permitido: ${input.type || 'vacío'}`);
  }
  if (!input.projectId && !input.quotationId) {
    throw new Error('El evento requiere projectId o quotationId');
  }

  return {
    eventId: input.eventId || crypto.randomUUID(),
    projectId: input.projectId || '',
    quotationId: input.quotationId || '',
    type: input.type,
    actorType: input.actorType || 'user',
    actorId: input.actorId || '',
    actorRole: input.actorRole || '',
    platformId: input.platformId || 'ELANVISUAL',
    payload: input.payload || {},
    occurredAt: input.occurredAt || new Date().toISOString()
  };
}

export function summarizeProjectEvents(events = []) {
  return [...events]
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .map((event) => ({
      type: event.type,
      occurredAt: event.occurredAt,
      actorId: event.actorId,
      payload: event.payload
    }));
}
