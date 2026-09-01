const JOB_TYPES = Object.freeze({
  CODE: 'code',
  CONTEXT_SYNC: 'context_sync',
});

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const CODE_JOB_STEPS = Object.freeze([
  'github',
  'workspace',
  'openai',
  'codex',
  'changes',
  'qa',
  'publish',
  'pr',
]);

const CONTEXT_SYNC_STEPS = Object.freeze([
  'documentation',
  'git',
  'context',
]);

function getJobSteps(type) {
  return type === JOB_TYPES.CONTEXT_SYNC
    ? [...CONTEXT_SYNC_STEPS]
    : [...CODE_JOB_STEPS];
}

module.exports = {
  JOB_TYPES,
  JOB_STATUS,
  JOB_STEPS: CODE_JOB_STEPS,
  CODE_JOB_STEPS,
  CONTEXT_SYNC_STEPS,
  getJobSteps,
};
