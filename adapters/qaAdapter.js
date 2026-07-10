const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runCommand({
  command,
  args,
  cwd,
  timeoutMs = 600000
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        cwd,
        env: {
  ...process.env,
  CI: 'true',
  NODE_ENV: 'development'
},
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');

      reject(
        new Error(
          `${command} excedió ${timeoutMs} ms`
        )
      );
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      const result = {
        command: [command, ...args].join(' '),
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };

      if (code !== 0) {
        const error = new Error(
          stderr.trim() ||
          stdout.trim() ||
          `${command} terminó con código ${code}`
        );

        error.result = result;
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function readPackageJson(workspacePath) {
  const packagePath = path.join(
    workspacePath,
    'package.json'
  );

  if (!fs.existsSync(packagePath)) {
    throw new Error(
      `package.json no encontrado en ${workspacePath}`
    );
  }

  return JSON.parse(
    fs.readFileSync(packagePath, 'utf8')
  );
}

function detectPackageManager(workspacePath) {
  if (
    fs.existsSync(
      path.join(workspacePath, 'pnpm-lock.yaml')
    )
  ) {
    return {
      name: 'pnpm',
      install: ['install', '--frozen-lockfile']
    };
  }

  if (
    fs.existsSync(
      path.join(workspacePath, 'yarn.lock')
    )
  ) {
    return {
      name: 'yarn',
      install: ['install', '--frozen-lockfile']
    };
  }

  if (
    fs.existsSync(
      path.join(workspacePath, 'package-lock.json')
    )
  ) {
    return {
      name: 'npm',
      install: ['ci']
    };
  }

  return {
    name: 'npm',
    install: ['install']
  };
}

async function executeWorkspaceQa({
  workspacePath
}) {
  if (!workspacePath) {
    throw new Error('workspacePath requerido');
  }

  const packageJson =
    readPackageJson(workspacePath);

  const packageManager =
    detectPackageManager(workspacePath);

  const results = [];

  results.push(
    await runCommand({
      command: 'git',
      args: ['diff', '--check'],
      cwd: workspacePath,
      timeoutMs: 60000
    })
  );

  results.push(
    await runCommand({
      command: packageManager.name,
      args: packageManager.install,
      cwd: workspacePath,
      timeoutMs: 600000
    })
  );

  const scripts = packageJson.scripts || {};

  if (!scripts.build) {
    throw new Error(
      'El repositorio no tiene script build'
    );
  }

  results.push(
    await runCommand({
      command: packageManager.name,
      args:
        packageManager.name === 'yarn'
          ? ['build']
          : ['run', 'build'],
      cwd: workspacePath,
      timeoutMs: 600000
    })
  );

  if (scripts.test) {
    results.push(
      await runCommand({
        command: packageManager.name,
        args:
          packageManager.name === 'yarn'
            ? ['test']
            : ['test', '--', '--runInBand'],
        cwd: workspacePath,
        timeoutMs: 600000
      }).catch(async error => {
        if (
          packageManager.name === 'npm' &&
          String(error.message).includes(
            'runInBand'
          )
        ) {
          return runCommand({
            command: 'npm',
            args: ['test'],
            cwd: workspacePath,
            timeoutMs: 600000
          });
        }

        throw error;
      })
    );
  }

  return {
    healthy: true,
    packageManager: packageManager.name,
    buildScript: scripts.build,
    testScript: scripts.test || null,
    results,
    finishedAt: new Date().toISOString()
  };
}

module.exports = {
  executeWorkspaceQa
};
