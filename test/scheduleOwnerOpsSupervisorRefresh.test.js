'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const {
  buildRefreshShellCommand
} = require('../deploy/schedule-owner-ops-supervisor-refresh');

test('owner ops supervisor refresh shell is valid POSIX shell syntax', { skip: process.platform !== 'linux' }, () => {
  const script = buildRefreshShellCommand();

  assert.match(script, /while find .*; do\n/);
  assert.doesNotMatch(script, /\bdo;\b/);

  execFileSync('/bin/sh', ['-n', '-c', script], {
    stdio: 'pipe'
  });
});
