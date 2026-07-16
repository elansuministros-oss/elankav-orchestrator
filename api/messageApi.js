const { handleVqsProjectApi } = require('./vqsProjectApi');
const { handleMessageApi: handleLegacyMessageApi } = require('./messageApiLegacy');

async function handleMessageApi({ req, res, sendJson }) {
  const vqsProjectHandled = await handleVqsProjectApi({ req, res, sendJson });
  if (vqsProjectHandled) return true;
  return handleLegacyMessageApi({ req, res, sendJson });
}

module.exports = {
  handleMessageApi
};
