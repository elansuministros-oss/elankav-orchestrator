'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JOB_TYPES,
  getJobSteps
} = require('../services/jobs/jobTypes');

test('code prepare jobs stop before publish and PR', () => {
  const steps = getJobSteps(JOB_TYPES.CODE_PREPARE);

  assert.deepEqual(steps, [
    'github',
    'workspace',
    'openai',
    'codex',
    'changes',
    'qa'
  ]);
  assert.equal(steps.includes('publish'), false);
  assert.equal(steps.includes('pr'), false);
});
