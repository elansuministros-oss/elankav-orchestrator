const { generateText } = require('../openaiService');

async function openaiHealth() {
  try {
    const response = await generateText({
      input: 'Responder únicamente: OK',
      instructions: 'Prueba técnica de conectividad. No agregues explicación.'
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
