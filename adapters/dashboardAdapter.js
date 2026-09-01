const {
  getDashboardData
} = require('../services/dashboardService');

async function getDashboardStatus() {
  return getDashboardData();
}

module.exports = {
  getDashboardStatus
};
