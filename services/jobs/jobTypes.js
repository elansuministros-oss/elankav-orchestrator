const JOB_TYPES = Object.freeze({
  CODE: 'code',
});

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const JOB_STEPS = Object.freeze([
  'github',
  'workspace',
  'openai',
  'codex',
  'changes',
  'qa',
  'pr',
]);

module.exports = {
  JOB_TYPES,
  JOB_STATUS,
  JOB_STEPS,
};
