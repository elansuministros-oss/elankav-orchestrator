const path = require('node:path');
const { executeCodex } = require('../adapters/codexAdapter');

async function runCodexTask({ task }) {
  if (!task) {
    throw new Error('task requerida');
  }

  return executeCodex({
    cwd: path.resolve(__dirname, '..'),
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

module.exports = {
  runCodexTask,
};
