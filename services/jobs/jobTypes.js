const JOB_TYPES = Object.freeze({
  CODE: 'code',
  CODE_PREPARE: 'code_prepare',
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

const CODE_PREPARE_STEPS = Object.freeze([
  'github',
  'workspace',
  'openai',
  'codex',
  'changes',
  'qa',
]);

const CONTEXT_SYNC_STEPS = Object.freeze([
  'documentation',
  'git',
  'context',
]);

function getJobSteps(type) {
  if (type === JOB_TYPES.CONTEXT_SYNC) return [...CONTEXT_SYNC_STEPS];
  if (type === JOB_TYPES.CODE_PREPARE) return [...CODE_PREPARE_STEPS];
  return [...CODE_JOB_STEPS];
}

module.exports = {
  JOB_TYPES,
  JOB_STATUS,
  JOB_STEPS: CODE_JOB_STEPS,
  CODE_JOB_STEPS,
  CODE_PREPARE_STEPS,
  CONTEXT_SYNC_STEPS,
  getJobSteps,
};
