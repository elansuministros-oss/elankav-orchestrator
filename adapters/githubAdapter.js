const {
  getGithubData
} = require('../services/githubService');

async function getGithubStatus() {
  return getGithubData();
}

module.exports = {
  getGithubStatus
};
