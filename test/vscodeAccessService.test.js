const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COOKIE_NAME,
  createVscodeSession,
  verifyVscodeSession
} = require('../services/vscodeAccessService');

test('crea y valida sesión firmada para Owner', () => {
  const previous = process.env.VSCODE_SESSION_SECRET;
  process.env.VSCODE_SESSION_SECRET = 'test-secret-vsc-001c';

  try {
    const now = 1783860000000;
    const created = createVscodeSession('50588388940', now);
    const cookieValue = created.cookie
      .split(';')[0]
      .slice(`${COOKIE_NAME}=`.length);

    const req = {
      headers: {
        cookie: `${COOKIE_NAME}=${cookieValue}`
      }
    };

    const verified = verifyVscodeSession(req, now + 1000);

    assert.equal(verified.actor, '50588388940');
    assert.equal(verified.expiresAt, created.expiresAt);
  } finally {
    if (previous === undefined) {
      delete process.env.VSCODE_SESSION_SECRET;
    } else {
      process.env.VSCODE_SESSION_SECRET = previous;
    }
  }
});

test('rechaza sesión alterada o expirada', () => {
  const previous = process.env.VSCODE_SESSION_SECRET;
  process.env.VSCODE_SESSION_SECRET = 'test-secret-vsc-001c';

  try {
    const now = 1783860000000;
    const created = createVscodeSession('50588388940', now);
    const raw = decodeURIComponent(
      created.cookie.split(';')[0].slice(`${COOKIE_NAME}=`.length)
    );

    const alteredReq = {
      headers: {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(raw.replace('50588388940', '50578828089'))}`
      }
    };

    const validReq = {
      headers: {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(raw)}`
      }
    };

    assert.equal(verifyVscodeSession(alteredReq, now + 1000), null);
    assert.equal(
      verifyVscodeSession(validReq, created.expiresAt + 1),
      null
    );
  } finally {
    if (previous === undefined) {
      delete process.env.VSCODE_SESSION_SECRET;
    } else {
      process.env.VSCODE_SESSION_SECRET = previous;
    }
  }
});