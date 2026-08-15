'use strict';

const { getJob } = require('./jobs/jobEngine');
const { JOB_TYPES } = require('./jobs/jobTypes');
const { publishJobChanges } = require('./gitPublishService');
const { openJobPullRequest } = require('./pullRequestService');

function findStep(job, name) {
  return Array.isArray(job?.result?.steps)
    ? job.result.steps.find(step => step?.step === name) || null
    : null;
}

async function publishPreparedJob(jobId) {
  const job = await getJob(jobId);

  if (!job) {
    const error = new Error('PREPARED_JOB_NOT_FOUND');
    error.code = 'PREPARED_JOB_NOT_FOUND';
    throw error;
  }

  if (job.type !== JOB_TYPES.CODE_PREPARE) {
    const error = new Error('JOB_NOT_PREPARE_ONLY');
    error.code = 'JOB_NOT_PREPARE_ONLY';
    throw error;
  }

  if (job.status !== 'completed' || job.result?.mode !== 'prepare-only') {
    const error = new Error('PREPARED_JOB_NOT_READY');
    error.code = 'PREPARED_JOB_NOT_READY';
    throw error;
  }

  const workspace = findStep(job, 'workspace');
  const changes = findStep(job, 'changes');
  const qa = findStep(job, 'qa');

  if (!workspace?.healthy || !workspace.workspacePath) {
    throw Object.assign(new Error('PREPARED_WORKSPACE_INVALID'), { code: 'PREPARED_WORKSPACE_INVALID' });
  }
  if (!changes?.healthy || !changes.changed) {
    throw Object.assign(new Error('PREPARED_CHANGES_INVALID'), { code: 'PREPARED_CHANGES_INVALID' });
  }
  if (!qa?.healthy) {
    throw Object.assign(new Error('PREPARED_QA_INVALID'), { code: 'PREPARED_QA_INVALID' });
  }

  const publish = await publishJobChanges({ job, workspace, changes, qa });
  if (!publish?.healthy || !publish?.pushed) {
    throw Object.assign(new Error('PREPARED_PUBLISH_FAILED'), { code: 'PREPARED_PUBLISH_FAILED' });
  }

  const pullRequest = await openJobPullRequest({ job, workspace, publish, qa });
  if (!pullRequest?.healthy) {
    throw Object.assign(new Error('PREPARED_PR_FAILED'), { code: 'PREPARED_PR_FAILED' });
  }

  return {
    capability: 'git.publish-prepared',
    jobId: job.id,
    platform: job.platform,
    branch: job.branch,
    commitSha: publish.commitSha || null,
    pullRequestUrl: pullRequest.url || null,
    healthy: true
  };
}

module.exports = {
  findStep,
  publishPreparedJob
};
