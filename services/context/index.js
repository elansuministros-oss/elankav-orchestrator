'use strict';

const { routeContext } = require('./contextRouter');
const { buildContext, CONTEXT_VERSION } = require('./contextBuilder');

module.exports = {
  routeContext,
  buildContext,
  CONTEXT_VERSION
};
