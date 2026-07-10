const { spawn } = require('node:child_process');
const { readFile, unlink } = require('node:fs/promises');
const crypto = require('node:crypto');
const config = require('../config/codex.json');

const ALLOWED_SANDBOXES = new Set([
  'read-only',
  'workspace-write'
]);

async function executeCodex({
  prompt,
  cwd,
  sandbox = 'read-only'
}) {
  if (!prompt) {
    throw new Error('prompt requerido');
  }

  if (!cwd) {
    throw new Error('cwd requerido');
  }

  if (!ALLOWED_SANDBOXES.has(sandbox)) {
    throw new Error(
      `Sandbox Codex no permitido: ${sandbox}`
    );
  }

  const outputFile =
    `/tmp/codex-${crypto.randomUUID()}.txt`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      config.binary,
      [
        'exec',
        '--model',
        config.model,
        '--sandbox',
        sandbox,
        '--skip-git-repo-check',
        '--ephemeral',
        '--color',
        'never',
        '--output-last-message',
        outputFile,
        '-'
      ],
      {
        cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    let finished = false;
    let settled = false;

    function rejectOnce(error) {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    }

    function resolveOnce(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }

    const timer = setTimeout(() => {
      if (!finished) {
        child.kill('SIGTERM');

        rejectOnce(
          new Error(
            `Codex excedió ${config.timeout_ms} ms`
          )
        );
      }
    }, config.timeout_ms);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      clearTimeout(timer);
      rejectOnce(error);
    });

    child.on('close', async code => {
      finished = true;
      clearTimeout(timer);

      let lastMessage = '';

      try {
        lastMessage = (
          await readFile(outputFile, 'utf8')
        ).trim();
      } catch {}

      await unlink(outputFile).catch(() => {});

      if (code !== 0) {
        rejectOnce(
          new Error(
            stderr.trim() ||
            `Codex terminó con código ${code}`
          )
        );

        return;
      }

      resolveOnce({
        success: true,
        model: config.model,
        sandbox,
        cwd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        lastMessage
      });
    });

    child.stdin.end(prompt);
  });
}

module.exports = {
  executeCodex
};
