'use strict';

const vscode = require('vscode');
const { OrchestratorClient } = require('./orchestratorClient');

const TOKEN_SECRET_KEY = 'elankav.orchestratorToken';

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function createClient(context) {
  const configuration = vscode.workspace.getConfiguration('elankav');
  const baseUrl = configuration.get('orchestratorUrl');
  const timeoutMs = configuration.get('requestTimeoutMs');

  return context.secrets.get(TOKEN_SECRET_KEY).then(token => new OrchestratorClient({
    baseUrl,
    token: token || '',
    timeoutMs
  }));
}

async function showJsonDocument(title, data) {
  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: stringify(data)
  });

  await vscode.window.showTextDocument(document, {
    preview: true
  });

  vscode.window.setStatusBarMessage(`ELANKAV: ${title} actualizado`, 4000);
}

async function runOperation(context, operation, title) {
  try {
    const client = await createClient(context);
    const data = await client.request(operation);
    await showJsonDocument(title, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`ELANKAV: ${message}`);
  }
}

async function configureConnection(context) {
  const configuration = vscode.workspace.getConfiguration('elankav');
  const currentUrl = configuration.get('orchestratorUrl');

  const baseUrl = await vscode.window.showInputBox({
    title: 'ELANKAV Orchestrator',
    prompt: 'URL del Orchestrator o del túnel SSH local',
    value: currentUrl,
    ignoreFocusOut: true,
    validateInput(value) {
      try {
        new URL(value);
        return null;
      } catch {
        return 'Ingresá una URL válida.';
      }
    }
  });

  if (!baseUrl) return;

  await configuration.update(
    'orchestratorUrl',
    baseUrl.replace(/\/+$/, ''),
    vscode.ConfigurationTarget.Global
  );

  const token = await vscode.window.showInputBox({
    title: 'Token ELANKAV',
    prompt: 'Token de acceso. En VSC-001 puede dejarse vacío usando túnel SSH.',
    password: true,
    ignoreFocusOut: true
  });

  if (token === undefined) return;

  if (token.trim()) {
    await context.secrets.store(TOKEN_SECRET_KEY, token.trim());
  } else {
    await context.secrets.delete(TOKEN_SECRET_KEY);
  }

  void vscode.window.showInformationMessage('ELANKAV: conexión guardada de forma segura.');
}

function activate(context) {
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  statusItem.text = '$(server) ELANKAV';
  statusItem.tooltip = 'Consultar salud del ELANKAV Orchestrator';
  statusItem.command = 'elankav.showHealth';
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand(
      'elankav.configureConnection',
      () => configureConnection(context)
    ),
    vscode.commands.registerCommand(
      'elankav.showHealth',
      () => runOperation(context, 'health', 'Salud')
    ),
    vscode.commands.registerCommand(
      'elankav.showDashboard',
      () => runOperation(context, 'dashboard', 'Dashboard')
    ),
    vscode.commands.registerCommand(
      'elankav.showProjects',
      () => runOperation(context, 'projects', 'Proyectos')
    ),
    vscode.commands.registerCommand(
      'elankav.showEcosystem',
      () => runOperation(context, 'ecosystem', 'Ecosistema')
    ),
    vscode.commands.registerCommand(
      'elankav.showGithub',
      () => runOperation(context, 'github', 'GitHub')
    ),
    vscode.commands.registerCommand(
      'elankav.showDocker',
      () => runOperation(context, 'docker', 'Docker')
    )
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
