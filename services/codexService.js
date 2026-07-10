const path = require('node:path');

const {
  executeCodex
} = require('../adapters/codexAdapter');

async function runCodexTask({
  task,
  cwd = path.resolve(__dirname, '..')
}) {
  if (!task) {
    throw new Error('task requerida');
  }

  return executeCodex({
    cwd,
    sandbox: 'read-only',
    prompt: [
      'Trabajá únicamente en modo análisis.',
      'No modifiques archivos.',
      'No ejecutes comandos destructivos.',
      'No hagas commit ni push.',
      'Respondé únicamente: CODEX_OK',
      `Tarea: ${task}`
    ].join('\n')
  });
}

async function runCodexWorkspaceTask({
  task,
  cwd
}) {
  if (!task) {
    throw new Error('task requerida');
  }

  if (!cwd) {
    throw new Error('cwd requerido');
  }

  return executeCodex({
    cwd,
    sandbox: 'workspace-write',
    prompt: [
      'Trabajá exclusivamente dentro del repositorio actual.',
      'La rama activa es temporal y está aislada.',
      'Podés modificar archivos únicamente para cumplir la tarea.',
      'No cambies de rama.',
      'No ejecutes git commit.',
      'No ejecutes git push.',
      'No abras Pull Requests.',
      'No modifiques archivos fuera del workspace.',
      'No leas ni muestres secretos o variables de entorno.',
      'No elimines archivos salvo que la tarea lo requiera explícitamente.',
      'Al finalizar, resumí brevemente los archivos modificados.',
      `Tarea: ${task}`
    ].join('\n')
  });
}

module.exports = {
  runCodexTask,
  runCodexWorkspaceTask
};
