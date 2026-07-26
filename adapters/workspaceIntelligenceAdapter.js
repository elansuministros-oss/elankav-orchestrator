'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const repositories = require('../config/github.json');
const {
  policy,
  workspaceError,
  assertAllowedTextPath,
  resolveInside,
  assertTextBuffer,
  redactSecrets,
  isBlocked
} = require('../services/workspaceSecurityService');

const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    env: process.env,
    timeout: policy.timeoutMs,
    maxBuffer: policy.maxResponseBytes
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

function configuredRepositoryId(remoteUrl = '') {
  const normalized = remoteUrl.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  const found = repositories.find(item => normalized.endsWith(`${item.owner}/${item.repo}`));
  return found?.id || null;
}

async function inspectWorkspaceDirectory(workspacePath, directoryName) {
  try {
    const remote = (await runGit(['config', '--get', 'remote.origin.url'], workspacePath)).stdout;
    const branch = (await runGit(['branch', '--show-current'], workspacePath)).stdout;
    const headSha = (await runGit(['rev-parse', 'HEAD'], workspacePath)).stdout;
    const status = (await runGit(['status', '--porcelain=v1'], workspacePath)).stdout;
    const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    return {
      id: configuredRepositoryId(remote) || directoryName,
      directoryName,
      repository: match ? `${match[1]}/${match[2]}` : null,
      branch,
      headSha,
      clean: !status,
      status
    };
  } catch {
    return null;
  }
}

async function listWorkspaces() {
  let entries;
  try {
    entries = await fs.readdir(policy.root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const inspected = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => {
    return inspectWorkspaceDirectory(path.join(policy.root, entry.name), entry.name);
  }));
  return inspected.filter(Boolean);
}

async function resolveWorkspace(workspaceId) {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(item => item.id === workspaceId || item.directoryName === workspaceId || item.repository === workspaceId);
  if (!workspace) throw workspaceError('WORKSPACE_NOT_FOUND', 'Workspace no encontrado');
  return { ...workspace, workspacePath: path.join(policy.root, workspace.directoryName) };
}

async function readTextFile(workspaceId, relativePath, startLine = 1, endLine = policy.maxReadLines) {
  const workspace = await resolveWorkspace(workspaceId);
  const safePath = assertAllowedTextPath(relativePath);
  const { candidateReal } = await resolveInside(workspace.workspacePath, safePath);
  const stat = await fs.stat(candidateReal);
  if (!stat.isFile()) throw workspaceError('WORKSPACE_NOT_A_FILE', 'El recurso no es un archivo');
  if (stat.size > policy.maxFileBytes) throw workspaceError('WORKSPACE_FILE_TOO_LARGE', 'Archivo excede el límite permitido');
  const buffer = await fs.readFile(candidateReal);
  assertTextBuffer(buffer);
  const lines = redactSecrets(buffer.toString('utf8')).split(/\r?\n/);
  const from = Math.max(1, Number(startLine) || 1);
  const to = Math.min(lines.length, from + Math.min(policy.maxReadLines, Math.max(1, Number(endLine) - from + 1)) - 1);
  return { path: safePath, startLine: from, endLine: to, totalLines: lines.length, content: lines.slice(from - 1, to).join('\n'), truncated: to < lines.length };
}

async function searchText(workspaceId, query, searchPaths = ['.'], limit = policy.maxSearchResults) {
  const workspace = await resolveWorkspace(workspaceId);
  const term = String(query || '').trim();
  if (!term || term.length > 200) throw workspaceError('WORKSPACE_QUERY_INVALID', 'Consulta de búsqueda inválida');
  const paths = searchPaths.slice(0, policy.maxSearchPaths).map(value => value === '.' ? '.' : assertAllowedTextPath(value));
  const args = ['grep', '-n', '-I', '--no-color', '--', term, ...paths];
  let stdout = '';
  try { stdout = (await runGit(args, workspace.workspacePath)).stdout; } catch (error) {
    if (error.code !== 1 && !String(error.stderr || '').includes('exit code 1')) throw error;
  }
  const matches = stdout.split('\n').filter(Boolean).map(line => {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match || isBlocked(match[1])) return null;
    return { path: match[1], line: Number(match[2]), preview: redactSecrets(match[3]).slice(0, 300) };
  }).filter(Boolean).slice(0, Math.min(limit, policy.maxSearchResults));
  return { query: term, matches, truncated: matches.length >= Math.min(limit, policy.maxSearchResults) };
}

async function getDiff(workspaceId, relativePath) {
  const workspace = await resolveWorkspace(workspaceId);
  const args = ['diff', '--no-ext-diff'];
  if (relativePath) args.push('--', assertAllowedTextPath(relativePath));
  const output = (await runGit(args, workspace.workspacePath)).stdout;
  return { path: relativePath || null, content: redactSecrets(output).slice(0, policy.maxResponseBytes), truncated: output.length > policy.maxResponseBytes };
}

async function readPackageManifest(workspaceId) {
  const file = await readTextFile(workspaceId, 'package.json', 1, policy.maxReadLines);
  const manifest = JSON.parse(file.content);
  return {
    name: manifest.name || null,
    version: manifest.version || null,
    packageManager: manifest.packageManager || (manifest.engines?.npm ? 'npm' : null),
    scripts: manifest.scripts || {},
    dependencies: Object.keys(manifest.dependencies || {}),
    devDependencies: Object.keys(manifest.devDependencies || {})
  };
}

module.exports = { listWorkspaces, resolveWorkspace, readTextFile, searchText, getDiff, readPackageManifest };
