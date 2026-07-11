const { generateText } = require('./openaiService');

const DEFAULT_INSTRUCTIONS = [
  'Sos el asistente técnico del ELANKAV Orchestrator.',
  'Respondé en español.',
  'Sé claro, directo y preciso.',
  'No inventes información.',
  'No ejecutes cambios ni acciones externas.',
  'Respondé únicamente al mensaje recibido.'
].join(' ');

function normalizeMessage(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

async function processMessage({
  message,
  instructions
}) {
  const normalizedMessage =
    normalizeMessage(message);

  if (!normalizedMessage) {
    const error = new Error(
      'message es obligatorio'
    );

    error.code = 'MESSAGE_REQUIRED';
    throw error;
  }

  const normalizedInstructions =
    normalizeMessage(instructions);

  const response = await generateText({
    input: normalizedMessage,
    instructions:
      normalizedInstructions ||
      DEFAULT_INSTRUCTIONS
  });

  return {
    message: normalizedMessage,
    reply: response.outputText.trim(),
    provider: 'openai',
    model: response.model,
    responseId: response.id,
    status: response.status,
    usage: response.usage,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  processMessage
};
