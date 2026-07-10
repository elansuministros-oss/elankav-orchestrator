const { runCodexTask } = require('../codexService');

async function codexHealth() {
  try {
    const result = await runCodexTask({
      task: 'Validar conexión con ELANKAV Orchestrator'
    });

    const output = [
      result.lastMessage,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n');

    return {
      available: true,
      healthy: output.includes('CODEX_OK'),
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

module.exports = {
  codexHealth,
};
