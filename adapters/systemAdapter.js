const {
  getSystemData
} = require('../services/systemService');

async function getSystemStatus() {
  return getSystemData();
}

module.exports = {
  getSystemStatus
};
