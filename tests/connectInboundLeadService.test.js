const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhone,
  synchronizeInboundWhatsappLead
} = require('../services/connectInboundLeadService');

test('normaliza teléfonos de Nicaragua', () => {
  assert.equal(normalizePhone('7882-8089'), '50578828089');
  assert.equal(normalizePhone('+505 7882 8089'), '50578828089');
});

test('omite owner mode y canales distintos de WhatsApp', async () => {
  const owner = await synchronizeInboundWhatsappLead({
    channel: 'whatsapp',
    ownerMode: true,
    phone: '78828089'
  });
  assert.equal(owner.reason, 'OWNER_MODE');

  const web = await synchronizeInboundWhatsappLead({
    channel: 'web',
    ownerMode: false,
    phone: '78828089'
  });
  assert.equal(web.reason, 'NOT_WHATSAPP');
});

test('crea Lead y Opportunity para el primer mensaje entrante', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes('/api/v1/leads?')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith('/api/v1/leads')) {
      return new Response(JSON.stringify({
        id: '59b59246-57a5-4cb5-9303-af853264b306',
        name: 'Cliente WhatsApp',
        whatsapp: '50578828089'
      }), { status: 201 });
    }
    if (url.includes('/api/v1/opportunities?')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith('/api/v1/opportunities')) {
      return new Response(JSON.stringify({
        id: '69b59246-57a5-4cb5-9303-af853264b307',
        leadId: '59b59246-57a5-4cb5-9303-af853264b306'
      }), { status: 201 });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const result = await synchronizeInboundWhatsappLead({
    message: 'Necesito una cotización',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    phone: '+505 7882 8089',
    ownerMode: false,
    metadata: { contactName: 'Cliente WhatsApp' },
    fetchFn
  });

  assert.equal(result.skipped, false);
  assert.equal(result.lead.id, '59b59246-57a5-4cb5-9303-af853264b306');
  assert.equal(result.opportunity.id, '69b59246-57a5-4cb5-9303-af853264b307');
  assert.equal(calls.filter(call => call.url.endsWith('/api/v1/leads')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/api/v1/opportunities')).length, 1);
});

test('reutiliza Lead y Opportunity existentes para no duplicar conversaciones', async () => {
  const lead = {
    id: '59b59246-57a5-4cb5-9303-af853264b306',
    name: 'Cliente existente',
    whatsapp: '50578828089'
  };
  const opportunity = {
    id: '69b59246-57a5-4cb5-9303-af853264b307',
    leadId: lead.id
  };
  const posts = [];

  const fetchFn = async (url, options = {}) => {
    if (options.method === 'POST') posts.push(url);
    if (url.includes('/api/v1/leads?')) {
      return new Response(JSON.stringify([lead]), { status: 200 });
    }
    if (url.includes('/api/v1/opportunities?')) {
      return new Response(JSON.stringify([opportunity]), { status: 200 });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const result = await synchronizeInboundWhatsappLead({
    message: 'Segundo mensaje',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    phone: '78828089',
    ownerMode: false,
    fetchFn
  });

  assert.equal(result.lead.id, lead.id);
  assert.equal(result.opportunity.id, opportunity.id);
  assert.deepEqual(posts, []);
});
