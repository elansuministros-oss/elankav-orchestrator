'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ORCHESTRATOR_REPO = '/opt/elankav/orchestrator';
const OS_REPO = '/opt/elankav/elankav-os';
const DOC_ROOT = path.join(
  OS_REPO,
  'ELAN_ORCHESTRATOR_DOCUMENTACION'
);

const CONTEXT_FILES = Object.freeze({
  currentState: 'CONTEXT/CURRENT_STATE.md',
  nextTask: 'CONTEXT/NEXT_TASK.md',
  decisions: 'CONTEXT/DECISIONS.md',
  changelog: 'CHANGELOG.md',
  continuityContract: 'CONTRATO_DE_CONTINUIDAD.md'
});

async function readContextFile(relativePath) {
  const absolutePath = path.join(DOC_ROOT, relativePath);

  try {
    return {
      path: absolutePath,
      available: true,
      content: (await fs.readFile(absolutePath, 'utf8')).trim()
    };
  } catch (error) {
    return {
      path: absolutePath,
      available: false,
      content: null,
      error: error.code || error.message
    };
  }
}

async function readGitState(repositoryPath) {
  async function git(args) {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repositoryPath, ...args],
      { maxBuffer: 1024 * 1024 }
    );

    return stdout.trim();
  }

  try {
    const [branch, commit, status] = await Promise.all([
      git(['branch', '--show-current']),
      git(['log', '-1', '--oneline', '--decorate']),
      git(['status', '--short'])
    ]);

    return {
      repositoryPath,
      available: true,
      branch,
      commit,
      clean: status.length === 0,
      status: status || null
    };
  } catch (error) {
    return {
      repositoryPath,
      available: false,
      error: error.message
    };
  }
}

async function runContextSyncJob(job) {
  const entries = await Promise.all(
    Object.entries(CONTEXT_FILES).map(async ([key, relativePath]) => {
      return [key, await readContextFile(relativePath)];
    })
  );

  const [orchestratorGit, osGit] = await Promise.all([
    readGitState(ORCHESTRATOR_REPO),
    readGitState(OS_REPO)
  ]);

  const documents = Object.fromEntries(entries);
  const missingDocuments = Object.entries(documents)
    .filter(([, document]) => !document.available)
    .map(([key]) => key);

  return {
    jobId: job.id,
    type: job.type,
    mode: 'read-only',
    healthy: missingDocuments.length === 0,
    generatedAt: new Date().toISOString(),
    sources: {
      documentationRoot: DOC_ROOT,
      orchestratorRepository: ORCHESTRATOR_REPO,
      osRepository: OS_REPO
    },
    documents,
    git: {
      orchestrator: orchestratorGit,
      elankavOs: osGit
    },
    missingDocuments
  };
}

module.exports = {
  CONTEXT_FILES,
  runContextSyncJob
};
