const { runCodexTask } = require('../codexService');

async function codexAnalyze(task) {
  if (!task) {
    throw new Error('task requerida para Codex');
  }

  try {
    const result = await runCodexTask({ task });

    const output = [
      result.lastMessage,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n');

    return {
      available: true,
      healthy: Boolean(result.success),
      model: result.model,
      output
    };
  } catch (error) {
    return {
      available: false,
      healthy: false,
      error: error.message
    };
  }
}

async function codexHealth() {
  return codexAnalyze(
    'Validar conexión con ELANKAV Orchestrator'
  );
}

module.exports = {
  codexAnalyze,
  codexHealth
};
