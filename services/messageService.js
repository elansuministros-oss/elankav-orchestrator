const { generateText } = require('./openaiService');
const { routeContext } = require('./context/index');

const DEFAULT_INSTRUCTIONS = [
  'Sos el asistente técnico del ELANKAV Orchestrator.',
  'Respondé en español.',
  'Sé claro, directo y preciso.',
  'No inventes información.',
  'No ejecutes cambios ni acciones externas.',
  'Respondé únicamente al mensaje recibido.'
].join(' ');

const OWNER_INSTRUCTIONS = [
  'Sos el asistente ejecutivo interno de Erick Cano.',
  'El remitente fue reconocido como Erick Cano, propietario del ecosistema ELANKAV.',
  'No lo trates como cliente, lead o prospecto.',
  'Si pregunta quién es para el sistema, respondé que es Erick Cano, propietario del ecosistema ELANKAV.',
  'No inventes datos operativos.',
  'Cuando una respuesta requiera datos internos aún no conectados, indicá claramente que la fuente operativa todavía no está disponible.',
  'Respondé en español, de forma directa y precisa.'
].join(' ');

function normalizeMessage(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

async function processMessage({
  message,
  instructions,
  platform,
  channel,
  externalUserId,
  phone,
  metadata
}) {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    const error = new Error('message es obligatorio');
    error.code = 'MESSAGE_REQUIRED';
    throw error;
  }

  const normalizedInstructions = normalizeMessage(instructions);
  let resolvedContext = null;

  const response = await routeContext(
    {
      message: normalizedMessage,
      source: 'messageService',
      platform,
      channel,
      externalUserId,
      phone,
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        instructions: normalizedInstructions || DEFAULT_INSTRUCTIONS
      }
    },
    context => {
      resolvedContext = context;
      const ownerMode = Boolean(context.owner?.isOwner);

      return generateText({
        input: normalizedMessage,
        instructions:
          normalizedInstructions ||
          (ownerMode
            ? OWNER_INSTRUCTIONS
            : DEFAULT_INSTRUCTIONS),
        context: {
          ownerMode,
          ownerName: ownerMode ? 'Erick Cano' : null,
          externalUserId: context.externalUserId || externalUserId || null,
          phone: context.phone || phone || null,
          platform: context.platform || platform || null,
          channel: context.channel || channel || null
        }
      });
    }
  );

  return {
    message: normalizedMessage,
    reply: response.outputText.trim(),
    provider: 'openai',
    model: response.model,
    responseId: response.id,
    status: response.status,
    usage: response.usage,
    context: {
      version: resolvedContext?.version || null,
      platform: resolvedContext?.platform || null,
      channel: resolvedContext?.channel || null,
      externalUserId: resolvedContext?.externalUserId || null,
      ownerMode: Boolean(resolvedContext?.owner?.isOwner)
    },
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  processMessage
};
