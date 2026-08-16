'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { generateText } = require('./openaiService');

const execFileAsync = promisify(execFile);

const MAX_CONTEXT_FILES = 24;
const MAX_CONTEXT_CHARS = 100000;
const MAX_WRITES = 12;
const MAX_FILE_CHARS = 120000;

const ALWAYS_INCLUDE = [
  'package.json',
  'services/jobs/jobPipeline.js',
  'services/jobs/jobExecutor.js',
  'services/repositoryChangeService.js',
  'services/qaService.js'
];

const TEXT_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.json', '.md', '.sql', '.yml', '.yaml', '.toml',
  '.css', '.html', '.txt'
]);

const SENSITIVE_SEGMENTS = [
  '.env', 'auth.json', 'credentials', 'credential',
  'secret', 'private_key', 'id_rsa', 'id_ed25519'
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function taskTokens(task) {
  return [...new Set(
    normalize(task)
      .split(/[^a-z0-9_.-]+/)
      .filter(token => token.length >= 3)
  )];
}

function isSensitivePath(relativePath) {
  const normalized = normalize(relativePath);
  return SENSITIVE_SEGMENTS.some(segment => normalized.includes(segment));
}

function isAllowedTextPath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  if (relativePath.includes('..')) return false;
  if (isSensitivePath(relativePath)) return false;

  const ext = path.extname(relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || path.basename(relativePath) === 'package.json';
}

async function gitLsFiles(workspacePath) {
  const { stdout } = await execFileAsync('git', ['ls-files'], {
    cwd: workspacePath,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });

  return stdout
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean);
}

function scorePath(relativePath, tokens) {
  const normalizedPath = normalize(relativePath);
  let score = ALWAYS_INCLUDE.includes(relativePath) ? 100 : 0;

  for (const token of tokens) {
    if (normalizedPath.includes(token)) score += 10;
  }

  if (normalizedPath.includes('/tests/') || normalizedPath.startsWith('tests/')) {
    score += 2;
  }

  if (normalizedPath.includes('/services/') || normalizedPath.startsWith('services/')) {
    score += 2;
  }

  return score;
}

async function buildRepositoryContext({ task, workspacePath }) {
  const files = await gitLsFiles(workspacePath);
  const tokens = taskTokens(task);

  const candidates = files
    .filter(isAllowedTextPath)
    .map(relativePath => ({
      relativePath,
      score: scorePath(relativePath, tokens)
    }))
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));

  const selected = [];
  let totalChars = 0;

  for (const candidate of candidates) {
    if (selected.length >= MAX_CONTEXT_FILES) break;

    const absolutePath = path.join(workspacePath, candidate.relativePath);

    let content;
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }

    if (!content || content.length > MAX_FILE_CHARS) continue;
    if (totalChars + content.length > MAX_CONTEXT_CHARS) continue;

    selected.push({
      path: candidate.relativePath,
      content
    });
    totalChars += content.length;
  }

  return {
    trackedFiles: files.filter(isAllowedTextPath),
    selected,
    totalChars
  };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('ELAN Native Code no devolvió contenido');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');

    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }

    throw new Error('ELAN Native Code devolvió JSON inválido');
  }
}

async function validateWriteTarget({ workspacePath, relativePath }) {
  if (!isAllowedTextPath(relativePath)) {
    throw new Error(`Ruta no permitida: ${relativePath}`);
  }

  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Ruta fuera del workspace: ${relativePath}`);
  }

  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink no permitido: ${relativePath}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return target;
}

async function applyNativeEdits({ workspacePath, payload }) {
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error('Respuesta de ELAN Native Code sin files');
  }

  if (!payload.files.length) {
    throw new Error('ELAN Native Code no propuso cambios');
  }

  if (payload.files.length > MAX_WRITES) {
    throw new Error(`Demasiados archivos propuestos: ${payload.files.length}`);
  }

  const changedFiles = [];

  for (const edit of payload.files) {
    const relativePath = String(edit?.path || '').trim();
    const content = typeof edit?.content === 'string' ? edit.content : null;

    if (!relativePath || content === null) {
      throw new Error('Edición inválida: path/content requeridos');
    }

    if (content.length > MAX_FILE_CHARS) {
      throw new Error(`Archivo demasiado grande: ${relativePath}`);
    }

    const target = await validateWriteTarget({ workspacePath, relativePath });

    let before = null;
    try {
      before = await fs.readFile(target, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (before === content) continue;

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    changedFiles.push(relativePath);
  }

  if (!changedFiles.length) {
    throw new Error('ELAN Native Code no produjo cambios efectivos');
  }

  return changedFiles;
}

async function modifyWorkspaceWithNativeAI({ task, workspacePath }) {
  if (!task) throw new Error('task requerida');
  if (!workspacePath) throw new Error('workspacePath requerido');

  const context = await buildRepositoryContext({ task, workspacePath });

  const input = [
    `TAREA: ${task}`,
    '',
    'ARCHIVOS DISPONIBLES EN EL REPOSITORIO:',
    context.trackedFiles.join('\n'),
    '',
    'CONTEXTO DE ARCHIVOS SELECCIONADOS:',
    ...context.selected.map(file => [
      `--- FILE: ${file.path} ---`,
      file.content,
      `--- END FILE: ${file.path} ---`
    ].join('\n'))
  ].join('\n');

  const instructions = [
    'Sos ELAN Native Code Executor dentro de un workspace Git aislado.',
    'Tu única función es proponer cambios de código para cumplir la tarea.',
    'NO ejecutes comandos. NO hagas commit, push, merge, PR ni deploy.',
    'NO solicites ni expongas secretos, tokens, variables de entorno o credenciales.',
    'NO modifiques archivos .env, auth.json, credenciales, llaves privadas ni secretos.',
    'NO elimines archivos.',
    'Preferí cambios mínimos y reutilizá la arquitectura existente.',
    'Incluí pruebas cuando la tarea cambie comportamiento.',
    'Respondé SOLO JSON válido, sin markdown, con esta forma exacta:',
    '{"summary":"resumen breve","files":[{"path":"ruta/relativa","content":"contenido COMPLETO del archivo"}]}',
    `Máximo ${MAX_WRITES} archivos.`
  ].join('\n');

  const response = await generateText({ input, instructions });
  const payload = extractJson(response.outputText);
  const changedFiles = await applyNativeEdits({
    workspacePath,
    payload
  });

  return {
    healthy: true,
    engine: 'elan-native-openai',
    model: response.model,
    responseId: response.id,
    usage: response.usage,
    changedFiles,
    summary: String(payload.summary || '').trim(),
    contextFiles: context.selected.map(file => file.path),
    contextChars: context.totalChars
  };
}

module.exports = {
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_CHARS,
  MAX_WRITES,
  isAllowedTextPath,
  extractJson,
  buildRepositoryContext,
  applyNativeEdits,
  modifyWorkspaceWithNativeAI
};
