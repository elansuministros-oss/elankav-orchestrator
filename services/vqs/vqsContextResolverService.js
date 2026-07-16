class VqsContextResolverService {
  constructor({ adapter } = {}) {
    if (!adapter || typeof adapter.search !== 'function') {
      throw new Error('VqsContextResolverService requiere un adapter válido');
    }
    this.adapter = adapter;
  }

  async search({ query, type = 'all', limit = 30, actor = {} } = {}) {
    const cleanQuery = String(query || '').trim();
    if (cleanQuery.length < 2) {
      const error = new Error('La búsqueda requiere al menos 2 caracteres');
      error.code = 'VQS_CONTEXT_QUERY_TOO_SHORT';
      throw error;
    }

    const allowedTypes = ['customer', 'design', 'store'];
    const types = type === 'all' ? allowedTypes : [String(type || '').toLowerCase()];
    if (types.some((entry) => !allowedTypes.includes(entry))) {
      const error = new Error('Tipo de búsqueda no soportado');
      error.code = 'VQS_CONTEXT_TYPE_INVALID';
      throw error;
    }

    const boundedLimit = Math.max(1, Math.min(Number(limit) || 30, 50));
    const results = await this.adapter.search(cleanQuery, { types, limit: boundedLimit });

    return {
      query: cleanQuery,
      type,
      count: results.length,
      results,
      access: {
        gateway: 'orchestrator',
        actorType: String(actor.type || 'user'),
        platformId: String(actor.platformId || 'ELANVISUAL').toUpperCase(),
        role: String(actor.role || '')
      }
    };
  }
}

module.exports = { VqsContextResolverService };
