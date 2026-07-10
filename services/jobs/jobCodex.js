const {
  runCodexTask,
  runCodexWorkspaceTask
} = require('../codexService');

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
      sandbox: result.sandbox,
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

async function codexModifyWorkspace({
  task,
  workspacePath
}) {
  if (!task) {
    throw new Error('task requerida para Codex');
  }

  if (!workspacePath) {
    throw new Error(
      'workspacePath requerido para Codex'
    );
  }

  try {
    const result = await runCodexWorkspaceTask({
      task,
      cwd: workspacePath
    });

    const output = [
      result.lastMessage,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n');

    return {
      available: true,
      healthy: Boolean(result.success),
      model: result.model,
      sandbox: result.sandbox,
      workspacePath,
      output
    };
  } catch (error) {
    return {
      available: false,
      healthy: false,
      workspacePath,
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
  codexModifyWorkspace,
  codexHealth
};
