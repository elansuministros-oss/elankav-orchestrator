const { getRepositories } = require('../services/githubService');

async function getGithubStatus() {
  const repositories = getRepositories();

  return {
    available: true,
    total: repositories.length,
    repositories,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  getGithubStatus
};
