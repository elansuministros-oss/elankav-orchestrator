const { JOB_STATUS } = require('./jobTypes');

function prepareJob(job) {
  if (!job) {
    throw new Error('job requerido');
  }

  return {
    ...job,
    status: JOB_STATUS.PENDING,
  };
}

module.exports = {
  prepareJob,
};
