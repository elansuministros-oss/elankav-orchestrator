const { createResponse } = require('../openaiService');

async function openaiHealth() {
  try {
    const response = await createResponse({
      input: 'Responder únicamente: OK'
    });

    return {
      available: true,
      healthy: true,
      response
    };
  } catch (error) {
    return {
      available: false,
      healthy: false,
      error: error.message
    };
  }
}

module.exports = {
  openaiHealth,
};
