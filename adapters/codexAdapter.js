const { spawn } = require('node:child_process');
const { readFile, unlink } = require('node:fs/promises');
const crypto = require('node:crypto');
const config = require('../config/codex.json');

async function executeCodex({ prompt, cwd }) {
  if (!prompt) throw new Error('prompt requerido');

  const outputFile = `/tmp/codex-${crypto.randomUUID()}.txt`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      config.binary,
      [
        'exec',
        '--model', config.model,
        '--skip-git-repo-check',
        '--ephemeral',
        '--color', 'never',
        '--output-last-message', outputFile,
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

    const timer = setTimeout(() => {
      if (!finished) {
        child.kill('SIGTERM');
        reject(new Error(`Codex excedió ${config.timeout_ms} ms`));
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
      reject(error);
    });

    child.on('close', async code => {
      finished = true;
      clearTimeout(timer);

      let lastMessage = '';

      try {
        lastMessage = (await readFile(outputFile, 'utf8')).trim();
      } catch {}

      await unlink(outputFile).catch(() => {});

      if (code !== 0) {
        return reject(
          new Error(stderr.trim() || `Codex terminó con código ${code}`)
        );
      }

      resolve({
        success: true,
        model: config.model,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        lastMessage
      });
    });

    child.stdin.end(prompt);
  });
}

module.exports = {
  executeCodex,
};
