const fs = require('node:fs');
const path = require('node:path');
const { get } = require('./httpClient');

const CONFIG_FILE = path.join(
  __dirname,
  '..',
  'config',
  'github.json'
);

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL_MS = 60_000;

let cache = {
  expiresAt: 0,
  data: null
};

function getRepositories() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const repositories = JSON.parse(raw);

  if (!Array.isArray(repositories)) {
    throw new Error('config/github.json debe contener un arreglo');
  }

  return repositories;
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function requestJson(url) {
  const result = await get(url, {
    timeout: 10_000,
    headers: githubHeaders()
  });

  if (result.status === null) {
    return {
      ok: false,
      status: null,
      elapsed: result.elapsed,
      error: result.error?.message || 'No fue posible conectar con GitHub'
    };
  }

  let data = null;

  try {
    data = await result.response.json();
  } catch {
    return {
      ok: false,
      status: result.status,
      elapsed: result.elapsed,
      error: 'GitHub devolvió una respuesta no JSON'
    };
  }

  return {
    ok: result.ok,
    status: result.status,
    elapsed: result.elapsed,
    data,
    rateLimit: {
      limit: Number(result.response.headers.get('x-ratelimit-limit')) || null,
      remaining: Number(result.response.headers.get('x-ratelimit-remaining')) || null,
      reset: result.response.headers.get('x-ratelimit-reset')
        ? new Date(
            Number(result.response.headers.get('x-ratelimit-reset')) * 1000
          ).toISOString()
        : null
    }
  };
}

function normalizeCommit(commitData) {
  if (!commitData?.sha) {
    return null;
  }

  return {
    sha: commitData.sha,
    short_sha: commitData.sha.slice(0, 7),
    message: commitData.commit?.message || null,
    author:
      commitData.commit?.author?.name ||
      commitData.author?.login ||
      null,
    author_login: commitData.author?.login || null,
    date: commitData.commit?.author?.date || null,
    url: commitData.html_url || null
  };
}

async function getRepositoryStatus(repository) {
  const owner = encodeURIComponent(repository.owner);
  const repo = encodeURIComponent(repository.repo);
  const branch = encodeURIComponent(repository.branch);

  const repositoryUrl = `${GITHUB_API}/repos/${owner}/${repo}`;
  const commitUrl =
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${branch}`;

  const [repositoryResult, commitResult] = await Promise.all([
    requestJson(repositoryUrl),
    requestJson(commitUrl)
  ]);

  if (!repositoryResult.ok) {
    return {
      ...repository,
      available: false,
      healthy: false,
      status: repositoryResult.status,
      error:
        repositoryResult.data?.message ||
        repositoryResult.error ||
        'No fue posible consultar el repositorio',
      response_time_ms: repositoryResult.elapsed,
      checked_at: new Date().toISOString()
    };
  }

  const metadata = repositoryResult.data;

  return {
    id: repository.id,
    owner: repository.owner,
    repo: repository.repo,
    full_name: metadata.full_name,
    branch: repository.branch,
    default_branch: metadata.default_branch,
    branch_matches_default:
      repository.branch === metadata.default_branch,

    available: true,
    healthy: commitResult.ok,
    status: repositoryResult.status,

    private: metadata.private,
    visibility: metadata.visibility,
    archived: metadata.archived,
    disabled: metadata.disabled,

    language: metadata.language,
    open_issues: metadata.open_issues_count,

    html_url: metadata.html_url,
    homepage: metadata.homepage,

    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    pushed_at: metadata.pushed_at,

    last_commit: commitResult.ok
      ? normalizeCommit(commitResult.data)
      : null,

    commit_error: commitResult.ok
      ? null
      : commitResult.data?.message ||
        commitResult.error ||
        'No fue posible consultar el último commit',

    response_time_ms:
      repositoryResult.elapsed + commitResult.elapsed,

    rate_limit:
      commitResult.rateLimit || repositoryResult.rateLimit || null,

    checked_at: new Date().toISOString()
  };
}

async function getGithubData(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (
    !forceRefresh &&
    cache.data &&
    cache.expiresAt > now
  ) {
    return {
      ...cache.data,
      cached: true
    };
  }

  const repositories = getRepositories();

  const results = await Promise.all(
    repositories.map(getRepositoryStatus)
  );

  const available = results.filter(
    repository => repository.available
  ).length;

  const healthy = results.filter(
    repository => repository.healthy
  ).length;

  const response = {
    available: available > 0,
    total: results.length,
    online: available,
    offline: results.length - available,
    healthy: healthy === results.length,
    healthy_repositories: healthy,
    repositories: results,
    authenticated: Boolean(process.env.GITHUB_TOKEN),
    cached: false,
    cache_ttl_seconds: CACHE_TTL_MS / 1000,
    checked_at: new Date().toISOString()
  };

  cache = {
    data: response,
    expiresAt: now + CACHE_TTL_MS
  };

  return response;
}

module.exports = {
  getRepositories,
  getRepositoryStatus,
  getGithubData
};
