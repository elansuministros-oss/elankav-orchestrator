'use strict';

// Bootstrap Owner business extensions from a module that server.js always loads,
// including when systemd starts Orchestrator with `node server.js` and bypasses
// the npm start script.
require('../services/ownerBusinessQuotationItemPatch');

const {
  getDashboardData
} = require('../services/dashboardService');

async function getDashboardStatus() {
  return getDashboardData();
}

module.exports = {
  getDashboardStatus
};
