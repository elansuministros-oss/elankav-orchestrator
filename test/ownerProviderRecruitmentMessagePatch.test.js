'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commandKind,
  extractProviderQuery,
  initialMessage,
  rememberPendingMedia,
  consumePendingMedia,
  clearPendingOwnerMedia,
  runCommand
} = require('../services/ownerProviderRecruitmentMessagePatch');

process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN = process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN || 'test-provider-token';

test('detecta comandos Owner de reclutamiento sin confundir consultas generales', () => {
  assert.equal(commandKind('ELAN recluta este proveedor', { media: { url: 'https://waha.test/file' } }), 'recruit');
  assert.equal(commandKind('ELAN registra este proveedor', { media: { url: 'https://waha.test/file' } }), 'register');
  assert.equal(commandKind('ELAN investiga este proveedor', { media: { url: 'https://waha.test/file' } }), 'investigate');
  assert.equal(commandKind('ELAN contacta este proveedor 8888 9999'), 'contact');
  assert.equal(commandKind('ELAN solicita tarifario a este proveedor'), 'request_price_list');
  assert.equal(commandKind('ELAN estado proveedor Vargas Centro'), 'status');
  assert.equal(commandKind('ELAN proveedores pendientes'), 'pending');
  assert.equal(commandKind('ELAN proveedores sin tarifario'), 'missing_price_list');
  assert.equal(commandKind('ELAN muéstrame lo que respondió este proveedor'), 'show_response');
  assert.equal(commandKind('ELAN agrega este catálogo al proveedor', { media: { url: 'https://waha.test/catalog.pdf' } }), 'add_catalog');
  assert.equal(commandKind('mostrame clientes pendientes'), null);
});

test('mensaje externo identifica inequívocamente a ELAN como IA', () => {
  const recruitOpening = initialMessage('recruit');
  assert.match(recruitOpening, /soy ELAN/i);
  assert.match(recruitOpening, /inteligencia artificial/i);
  assert.match(recruitOpening, /catálogo o tarifario vigente/i);
  const opening = initialMessage('contact', '¿Qué productos ofrecen?');
  assert.match(opening, /soy ELAN/i);
  assert.match(opening, /inteligencia artificial/i);
  assert.match(opening, /¿Qué productos ofrecen\?/);
});

test('extrae referencia humana del proveedor sin conservar ruido del comando', () => {
  assert.equal(extractProviderQuery('ELAN estado proveedor Vargas Centro'), 'Vargas Centro');
  assert.equal(extractProviderQuery('ELAN solicita tarifario a proveedor LED Solutions'), 'LED Solutions');
});


test('asocia el siguiente archivo del Owner con el comando previo de proveedor', () => {
  clearPendingOwnerMedia();
  const base = { phone: '50588388940', externalUserId: '50588388940@c.us', metadata: {} };
  rememberPendingMedia({ ...base, message: 'ELAN registra este proveedor' }, 'register');
  assert.equal(consumePendingMedia({ ...base, metadata: {} }), null);
  const pending = consumePendingMedia({
    ...base,
    message: '[Archivo recibido: proveedor.jpg]',
    metadata: { media: { url: 'https://waha.test/proveedor.jpg' }, messageType: 'image' }
  });
  assert.equal(pending.kind, 'register');
  assert.equal(pending.originalMessage, 'ELAN registra este proveedor');
  assert.equal(consumePendingMedia({
    ...base,
    metadata: { media: { url: 'https://waha.test/otro.jpg' } }
  }), null);
});


test('recluta en un solo comando: registra, valida y contacta por WhatsApp', async () => {
  const calls = [];
  const sent = [];
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json(){ return body; }
  });
  const fetchImpl = async (url, options={}) => {
    calls.push({ url:String(url), method:options.method || 'GET' });
    if(String(url).endsWith('/api/v1/providers/recruitment/intake')) {
      return response(200,{
        provider:{ id:'provider-jpm', tradeName:'JPM Publicidad' },
        recruitment:{ recruitmentStatus:'CONTACT_PENDING', contactVerified:true },
        created:true,
        nextQuestion:'¿Podrían compartir su catálogo?'
      });
    }
    if(String(url).endsWith('/api/v1/providers/provider-jpm/recruitment/contact-preflight')) {
      return response(200,{
        provider:{ id:'provider-jpm', tradeName:'JPM Publicidad' },
        recruitment:{ recruitmentStatus:'CONTACT_PENDING', contactVerified:true },
        contact:'50578865582',
        nextQuestion:'¿Podrían compartir su catálogo?'
      });
    }
    if(String(url).endsWith('/api/v1/providers/provider-jpm/recruitment/contact-attempts')) {
      return response(200,{ recruitment:{ recruitmentStatus:'CONTACTED' } });
    }
    throw new Error('URL inesperada '+url);
  };
  const delivery = {
    async sendText({phone,text}) {
      sent.push({phone,text});
      return { messageId:'wa-test-1' };
    }
  };
  const result = await runCommand('recruit',{
    message:'ELAN recluta este proveedor 7886 5582',
    phone:'50588889999',
    metadata:{ messageId:'owner-msg-1' }
  },{fetchImpl,delivery});

  assert.equal(sent.length,1);
  assert.equal(sent[0].phone,'50578865582');
  assert.match(sent[0].text,/soy ELAN/i);
  assert.match(sent[0].text,/inteligencia artificial/i);
  assert.match(sent[0].text,/catálogo o tarifario vigente/i);
  assert.match(result.reply,/Primer contacto enviado automáticamente/);
  assert.equal(result.command.type,'recruit');
  assert.equal(result.command.providerId,'provider-jpm');
  assert.equal(calls.some(x=>x.url.endsWith('/contact-preflight')),true);
  assert.equal(calls.some(x=>x.url.endsWith('/contact-attempts')),true);
});

test('recluta de forma segura: no escribe si CONNECT no verifica el contacto', async () => {
  let sends = 0;
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json(){ return body; }
  });
  const fetchImpl = async (url) => {
    if(String(url).endsWith('/api/v1/providers/recruitment/intake')) {
      return response(200,{
        provider:{ id:'provider-dudoso', tradeName:'Proveedor Dudoso' },
        recruitment:{ recruitmentStatus:'DISCOVERED', contactVerified:false },
        created:true
      });
    }
    if(String(url).endsWith('/api/v1/providers/provider-dudoso/recruitment/contact-preflight')) {
      return response(409,{ error:{ code:'PROVIDER_CONTACT_NOT_VERIFIED', message:'Contacto no verificado.' } });
    }
    throw new Error('URL inesperada '+url);
  };
  const delivery = { async sendText(){ sends += 1; return {messageId:'never'}; } };
  const result = await runCommand('recruit',{
    message:'ELAN recluta este proveedor 7777 0000',
    phone:'50588889999',
    metadata:{ messageId:'owner-msg-2' }
  },{fetchImpl,delivery});

  assert.equal(sends,0);
  assert.match(result.reply,/No envié ningún mensaje todavía/);
  assert.match(result.reply,/no está suficientemente vinculado/i);
  assert.equal(result.command.errorCode,'PROVIDER_CONTACT_NOT_VERIFIED');
});
