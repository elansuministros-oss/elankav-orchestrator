const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isOwnerCredential,
  renderAccessPage
} = require('../api/vscodeApi');

test('entrada web acepta únicamente Owner con token correcto', () => {
  const previous = process.env.VSCODE_ACCESS_TOKEN;
  process.env.VSCODE_ACCESS_TOKEN = 'token-seguro';

  try {
    assert.equal(
      isOwnerCredential('50588388940', 'token-seguro'),
      true
    );
    assert.equal(
      isOwnerCredential('50578828089', 'token-seguro'),
      false
    );
    assert.equal(
      isOwnerCredential('50588388940', 'token-incorrecto'),
      false
    );
  } finally {
    if (previous === undefined) {
      delete process.env.VSCODE_ACCESS_TOKEN;
    } else {
      process.env.VSCODE_ACCESS_TOKEN = previous;
    }
  }
});

test('página de acceso no expone secretos ni acceso directo', () => {
  const html = renderAccessPage();

  assert.match(html, /VS Code Web/);
  assert.match(html, /action="\/api\/vscode\/access"/);
  assert.doesNotMatch(html, /VSCODE_ACCESS_TOKEN/);
  assert.doesNotMatch(html, /ORCHESTRATOR_APPROVAL_TOKEN/);
  assert.doesNotMatch(html, /3001/);
});
