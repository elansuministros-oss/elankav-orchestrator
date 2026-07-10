const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(
  __dirname,
  '..',
  'config',
  'github.json'
);

function getRepositories() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');

  const repositories = JSON.parse(raw);

  if (!Array.isArray(repositories)) {
    throw new Error('config/github.json debe contener un arreglo');
  }

  return repositories;
}

module.exports = {
  getRepositories
};
