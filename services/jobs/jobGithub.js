const { getGithubData } = require('../githubService');

async function githubHealth() {
  return getGithubData();
}

module.exports = {
  githubHealth,
};
