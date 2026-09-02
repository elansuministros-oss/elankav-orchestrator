'use strict';

const { randomUUID } = require('node:crypto');
const {
  requestProspecting,
  resolveInternalToken
} = require('./ownerProspectingCommandService');
const { createChannelDeliveryService } = require('./channelDeliveryService');

const COMMAND_TYPE = 'business_owner_template_approval';

class OwnerTemplateApprovalError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message || code);
    this.name = 'OwnerTemplateApprovalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function extractDirectTarget(raw) {
  const text = String(raw || '');
  const emailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phoneCandidates = text.match(/(?:\+?505[\s().-]*)?(?:\d[\s().-]*){8,11}/g) || [];
  let phone = null;
  for (const candidate of phoneCandidates) {
    const digits = String(candidate).replace(/\D/g, '');
    if (digits.length === 8) { phone = `505${digits}`; break; }
    if (digits.length === 11 && digits.startsWith('505')) { phone = digits; break; }
  }
  return {
    email: emailMatch ? emailMatch[0] : null,
    phone
  };
}

function detectOwnerTemplateApproval(message) {
  const raw = String(message || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
  const value = normalize(raw);
  if (!raw) return null;

  const template = /\b(plantilla|plantillas|template|templates|correo de prueba|mensaje de prueba|presentacion|presentaciones)\b/.test(value);
  if (!template) return null;

  const target = extractDirectTarget(raw);
  const directSend = /\b(envia|enviar|enviale|manda|mandar|mandale|comparti|compartir)\b/.test(value) &&
    /\b(contacto|persona|cliente|prospecto|proveedor|correo|email|whatsapp|numero|telefono)\b/.test(value) &&
    Boolean(target.email || target.phone);

  const approval = /\b(apruebo|aprobar|aproba|aprobala|aprobalo|aprobada|aprobado|autorizo|autorizar|autoriza|dale aprobala)\b/.test(value);
  const preview = /\b(enviame|envia|enviar|mandame|manda|mandar|prueba|probar|validar|valida|revisar|revisa|mostrar|mostrame|ver)\b/.test(value) &&
    /\b(prueba|plantilla|template|presentacion|correo|whatsapp|validar|revisar|ver)\b/.test(value);

  if (!directSend && !approval && !preview) return null;

  return {
    type: COMMAND_TYPE,
    input: {
      action: directSend ? 'direct_send' : approval ? 'approve' : 'preview',
      raw,
      normalized: value,
      supplier: /\b(proveedor|proveedores|supplier|suppliers)\b/.test(value),
      client: /\b(cliente|clientes|client|clients)\b/.test(value),
      prospect: /\b(prospecto|prospectos|prospect|prospects)\b/.test(value),
      key: (raw.match(/\belanvisual-[a-z0-9._-]+\b/i) || [])[0] || null,
      email: target.email,
      phone: target.phone
    }
  };
}

function hasCompletedEvidence(review) {
  const evidence = Array.isArray(review?.evidence) ? review.evidence : [];
  return ['email', 'whatsapp'].every(channel => evidence.some(item =>
    item?.channel === channel && ['sent', 'delivered'].includes(String(item?.status || ''))
  ));
}

function matchesAudience(row, input) {
  const haystack = [row?.template?.key, row?.template?.name, row?.template?.segment, row?.template?.metadata?.audience]
    .join(' ');
  if (input?.supplier && !/supplier|proveedor/i.test(haystack)) return false;
  if (input?.client && !/client|cliente/i.test(haystack)) return false;
  if (input?.prospect && /supplier|proveedor|client|cliente/i.test(haystack)) return false;
  return true;
}

function chooseReview(reviews, input, { requireEvidence = true, approvedOnly = false } = {}) {
  let rows = (Array.isArray(reviews) ? reviews : []).filter(row => approvedOnly ? row?.approved === true : !row?.approved);
  if (requireEvidence) rows = rows.filter(hasCompletedEvidence);
  if (input?.key) rows = rows.filter(row => String(row?.template?.key || '').toLowerCase() === String(input.key).toLowerCase());
  rows = rows.filter(row => matchesAudience(row, input));
  return rows.length === 1 ? rows[0] : null;
}

function renderTemplateValue(value, variables) {
  return String(value || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_full, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : ''
  );
}

function renderDirectTemplate(template) {
  const servicesText = 'Rotulación, impresión, señalización y soluciones de publicidad visual.';
  const variables = {
    company_name: 'su empresa',
    contact_name: 'Contacto',
    services_text: servicesText,
    services_html: `<span>${servicesText}</span>`,
    landing_url: 'https://visual.elankav.com',
    whatsapp_url: 'https://wa.me/50578828089',
    hero_image_url: '',
    prospect_logo_url: ''
  };
  return {
    subject: renderTemplateValue(template?.subjectTemplate || 'Presentación ELANVISUAL', variables),
    html: renderTemplateValue(template?.htmlTemplate || '', variables),
    text: renderTemplateValue(template?.textTemplate || 'Conocé ELANVISUAL: https://visual.elankav.com', variables)
  };
}

function inlineImage(html) {
  const matches = [...String(html || '').matchAll(/data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)/gi)];
  if (!matches.length) return null;
  matches.sort((a, b) => String(b[2]).length - String(a[2]).length);
  const mimeType = String(matches[0][1]).toLowerCase();
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
  return { bytes: Buffer.from(String(matches[0][2]), 'base64'), mimeType, extension };
}

async function uploadInlineImage(image, template, env = process.env, fetchImpl = globalThis.fetch) {
  const baseUrl = String(env.CONNECT_BASE_URL || 'https://connect.elankav.com').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new OwnerTemplateApprovalError('CONNECT_BASE_URL_INVALID', 'CONNECT_BASE_URL no es válido.', 503);
  const token = resolveInternalToken(env);
  const bundleId = randomUUID();
  const fileName = `owner-direct-${String(template?.key || 'elanvisual')}-v${Number(template?.version || 1)}.${image.extension}`;
  const params = new URLSearchParams({ name: fileName, bundleId });
  const response = await fetchImpl(`${baseUrl}/console/api/prospecting/template-assets?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': image.mimeType,
      'X-Elankav-Internal-Token': token,
      'X-Elankav-Actor-Type': 'owner',
      'X-Elankav-Actor-Role': 'owner',
      'X-Elankav-Actor-Id': 'owner-whatsapp',
      'X-Elankav-Platform': 'ELANVISUAL',
      'X-Elankav-Source': 'OWNER_WHATSAPP'
    },
    body: image.bytes
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.publicUrl) {
    throw new OwnerTemplateApprovalError(
      String(payload?.error?.code || 'OWNER_DIRECT_PRESENTATION_IMAGE_UPLOAD_FAILED'),
      String(payload?.error?.message || 'No fue posible preparar la imagen pública de WhatsApp.'),
      response.status || 502
    );
  }
  return { publicUrl: String(payload.publicUrl), fileName, mimeType: image.mimeType };
}

async function sendDirectPresentation({ review, input, requestImpl, delivery, env, fetchImpl }) {
  const template = await requestImpl(
    '/console/api/prospecting/templates/' + encodeURIComponent(review.template.id),
    { method: 'GET' }
  );
  const rendered = renderDirectTemplate(template);
  const deliveries = [];

  if (input.email) {
    const email = await delivery.deliver({
      channel: 'email',
      to: input.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      fromIdentity: 'elanvisual'
    });
    deliveries.push({ channel: 'email', status: email.status, externalRef: email.externalRef || null });
  }

  if (input.phone) {
    const image = inlineImage(rendered.html);
    if (!image) {
      throw new OwnerTemplateApprovalError(
        'OWNER_DIRECT_PRESENTATION_WHATSAPP_IMAGE_REQUIRED',
        'La plantilla aprobada no contiene una imagen oficial reutilizable para WhatsApp. No envié el WhatsApp.',
        409
      );
    }
    const uploaded = await uploadInlineImage(image, template, env, fetchImpl);
    const waImage = await delivery.deliver({
      channel: 'whatsapp',
      phone: input.phone,
      text: 'Imagen de presentación ELANVISUAL',
      messageType: 'image',
      imageUrl: uploaded.publicUrl,
      mimeType: uploaded.mimeType,
      fileName: uploaded.fileName,
      caption: ''
    });
    const waText = await delivery.deliver({
      channel: 'whatsapp',
      phone: input.phone,
      text: rendered.text
    });
    deliveries.push({ channel: 'whatsapp', status: 'SENT', externalRef: `${waImage.externalRef || ''}|${waText.externalRef || ''}` });
  }

  return { template, rendered, deliveries };
}

async function executeOwnerTemplateApproval(
  command,
  {
    requestImpl = requestProspecting,
    delivery = createChannelDeliveryService(),
    env = process.env,
    fetchImpl = globalThis.fetch
  } = {}
) {
  if (!command || command.type !== COMMAND_TYPE) return { handled: false, outputText: null, result: null };
  const input = command.input || {};
  const reviews = await requestImpl('/api/v1/prospecting/owner-template-reviews', { method: 'GET' });

  if (input.action === 'direct_send') {
    const review = chooseReview(reviews, input, { requireEvidence: true, approvedOnly: true });
    if (!review) {
      throw new OwnerTemplateApprovalError(
        'OWNER_DIRECT_PRESENTATION_APPROVED_TEMPLATE_REQUIRED',
        'No encontré una única plantilla aprobada para ese tipo de contacto. Primero validá y aprobá la plantilla, o indicá su clave exacta.'
      );
    }
    const sent = await sendDirectPresentation({ review, input, requestImpl, delivery, env, fetchImpl });
    const channels = sent.deliveries.map(item => item.channel === 'email' ? 'correo' : 'WhatsApp').join(' + ');
    return {
      handled: true,
      outputText: `✅ Presentación enviada por ${channels}. Usé ${review.template.name} · v${review.template.version}. Esta orden fue solo para el contacto indicado y no activó ninguna campaña.`,
      result: sent
    };
  }

  if (input.action === 'preview') {
    const review = chooseReview(reviews, input, { requireEvidence: false });
    if (!review) {
      throw new OwnerTemplateApprovalError(
        'OWNER_TEMPLATE_PREVIEW_TARGET_AMBIGUOUS',
        'No encontré una única plantilla pendiente para esa descripción. Indicá si es de proveedores, prospectos o clientes, o escribí la clave exacta de la plantilla.'
      );
    }
    const tested = await requestImpl(
      '/console/api/prospecting/templates/' + encodeURIComponent(review.template.id) + '/owner-test',
      { method: 'POST' }
    );
    return {
      handled: true,
      outputText: `✅ Prueba Owner enviada: ${review.template.name} · v${review.template.version}. Revisá tu correo y tu WhatsApp. No queda aprobada hasta que vos lo ordenés.`,
      result: tested
    };
  }

  const review = chooseReview(reviews, input, { requireEvidence: true });
  if (!review) {
    throw new OwnerTemplateApprovalError(
      'OWNER_TEMPLATE_APPROVAL_TARGET_AMBIGUOUS',
      'No encontré una única plantilla pendiente con prueba de correo y WhatsApp registrada. Indicá la clave exacta de la plantilla.'
    );
  }
  const approved = await requestImpl(
    '/api/v1/prospecting/templates/' + encodeURIComponent(review.template.id) + '/owner-approve',
    { method: 'POST', body: { approvedBy: 'owner-whatsapp' } }
  );
  return {
    handled: true,
    outputText: `✅ Plantilla aprobada: ${approved?.template?.name || review.template.name} · v${approved?.template?.version || review.template.version}. Queda habilitada únicamente esta versión.`,
    result: approved
  };
}

module.exports = {
  COMMAND_TYPE,
  OwnerTemplateApprovalError,
  chooseReview,
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval,
  extractDirectTarget,
  hasCompletedEvidence,
  inlineImage,
  matchesAudience,
  renderDirectTemplate,
  renderTemplateValue,
  sendDirectPresentation,
  uploadInlineImage
};
