'use strict';

const { buildContext } = require('./contextBuilder');

async function routeContext(input, next) {
  if (typeof next !== 'function') {
    throw new TypeError('ContextRouter requiere una función next');
  }

  const context = buildContext(input);

  // ORCH-031A es deliberadamente transparente.
  // Los resolvers posteriores recibirán este contexto sin cambiar el contrato actual.
  return next(context);
}

module.exports = {
  routeContext
};
