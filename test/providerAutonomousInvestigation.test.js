'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN =
  process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN || 'test-provider-token';

const {
  autonomousInvestigationEnabled,
  runCommand
} = require('../services/ownerProviderRecruitmentMessagePatch');

const {
  isAutonomousInitialPending,
  processDueItem
} = require('../services/providerRecruitmentFollowupWorkerService');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(){ return body; }
  };
}

test('feature flag autónomo es opt-in y default deny', () => {
  assert.equal(autonomousInvestigationEnabled({}), false);
  assert.equal(autonomousInvestigationEnabled({
    PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED: 'true'
  }), true);
});

test('investiga con autonomía: intake -> web research -> preflight -> un solo primer contacto', async () => {
  const calls = [];
  const sent = [];

  const fetchImpl = async (url, options={}) => {
    const path = String(url);
    const method = options.method || 'GET';
    calls.push({ path, method });

    if (path.endsWith('/api/v1/providers/recruitment/intake') && method === 'POST') {
      return response(200,{
        provider:{ id:'provider-auto-1', tradeName:'Proveedor Auto' },
        recruitment:{ recruitmentStatus:'CONTACT_PENDING', contactVerified:true },
        created:true,
        nextQuestion:'¿Qué productos ofrecen actualmente?'
      });
    }

    if (path.endsWith('/api/v1/providers/provider-auto-1/recruitment/autonomous-research') && method === 'POST') {
      return response(200,{
        provider:{ id:'provider-auto-1', tradeName:'Proveedor Auto' },
        recruitment:{
          recruitmentStatus:'CONTACT_PENDING',
          contactVerified:true,
          source:{ autonomousInvestigation:true }
        },
        nextQuestion:'¿Qué productos ofrecen actualmente?',
        autonomousResearch:{
          matched:true,
          verifiedBusinessPhones:['50578865582'],
          preferredVerifiedContact:'50578865582',
          sourceCount:1
        }
      });
    }

    if (path.endsWith('/api/v1/providers/provider-auto-1/recruitment/contact-preflight?mode=autonomous') && method === 'GET') {
      return response(200,{
        provider:{ id:'provider-auto-1', tradeName:'Proveedor Auto' },
        recruitment:{ recruitmentStatus:'CONTACT_PENDING', contactVerified:true },
        contact:'50578865582',
        nextQuestion:'¿Qué productos ofrecen actualmente?'
      });
    }

    if (path.endsWith('/api/v1/providers/provider-auto-1/recruitment/contact-attempts') && method === 'POST') {
      return response(200,{
        recruitment:{ recruitmentStatus:'CONTACTED' }
      });
    }

    throw new Error('URL inesperada '+method+' '+path);
  };

  const delivery = {
    async sendText({phone,text}) {
      sent.push({phone,text});
      return { messageId:'wa-auto-1' };
    }
  };

  const result = await runCommand('investigate',{
    message:'ELAN investiga este proveedor Proveedor Auto 7886 5582',
    phone:'50588388940',
    metadata:{ messageId:'owner-auto-1' }
  },{
    fetchImpl,
    delivery,
    env:{ PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED:'true' },
    withinContactWindowImpl:()=>true,
    now:()=>new Date('2026-09-01T16:00:00Z')
  });

  assert.equal(sent.length,1);
  assert.equal(sent[0].phone,'50578865582');
  assert.match(sent[0].text,/soy ELAN/i);
  assert.match(sent[0].text,/inteligencia artificial/i);
  assert.match(result.reply,/Primer contacto enviado automáticamente/);
  assert.equal(result.command.type,'investigate');
  assert.equal(calls.filter(x=>x.path.includes('/autonomous-research')).length,1);
  assert.equal(calls.filter(x=>x.path.includes('contact-preflight?mode=autonomous')).length,1);
});

test('investiga fuera de horario: investiga y encola, pero no envía', async () => {
  const calls = [];
  let sends = 0;

  const fetchImpl = async (url, options={}) => {
    const path=String(url), method=options.method||'GET';
    calls.push({path,method,body:options.body});

    if(path.endsWith('/api/v1/providers/recruitment/intake') && method==='POST'){
      return response(200,{
        provider:{id:'provider-auto-2',tradeName:'Proveedor Noche'},
        recruitment:{recruitmentStatus:'CONTACT_PENDING',contactVerified:true}
      });
    }
    if(path.endsWith('/api/v1/providers/provider-auto-2/recruitment/autonomous-research') && method==='POST'){
      return response(200,{
        provider:{id:'provider-auto-2',tradeName:'Proveedor Noche'},
        recruitment:{
          recruitmentStatus:'CONTACT_PENDING',
          contactVerified:true,
          source:{autonomousInvestigation:true}
        },
        nextQuestion:'¿Tienen catálogo?',
        autonomousResearch:{matched:true,verifiedBusinessPhones:['50570000000']}
      });
    }
    if(path.endsWith('/api/v1/providers/provider-auto-2/recruitment') && method==='PATCH'){
      const body=JSON.parse(String(options.body||'{}'));
      assert.match(body.nextFollowupAt,/^2026-09-02T02:00:00\.000Z$/);
      return response(200,{recruitment:{recruitmentStatus:'CONTACT_PENDING'}});
    }
    throw new Error('URL inesperada '+method+' '+path);
  };

  const result=await runCommand('investigate',{
    message:'ELAN investiga este proveedor Proveedor Noche 7000 0000',
    phone:'50588388940',
    metadata:{messageId:'owner-auto-2'}
  },{
    fetchImpl,
    delivery:{async sendText(){sends+=1;return{messageId:'never'};}},
    env:{PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED:'true'},
    withinContactWindowImpl:()=>false,
    now:()=>new Date('2026-09-02T02:00:00.000Z')
  });

  assert.equal(sends,0);
  assert.equal(result.command.queued,true);
  assert.match(result.reply,/siguiente ventana permitida/i);
  assert.equal(calls.some(x=>x.method==='PATCH'),true);
});

test('investiga con flag OFF conserva comportamiento anterior sin research ni envío', async () => {
  const calls=[];
  let sends=0;

  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if(String(url).endsWith('/api/v1/providers/recruitment/intake')){
      return response(200,{
        provider:{id:'provider-safe-old',tradeName:'Proveedor Legacy'},
        recruitment:{recruitmentStatus:'DISCOVERED',contactVerified:false},
        nextQuestion:'¿Qué productos ofrecen?'
      });
    }
    throw new Error('No debía llamar '+url);
  };

  const result=await runCommand('investigate',{
    message:'ELAN investiga este proveedor Proveedor Legacy 7111 2222',
    phone:'50588388940',
    metadata:{messageId:'owner-auto-3'}
  },{
    fetchImpl,
    delivery:{async sendText(){sends+=1;return{};}},
    env:{PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED:'false'}
  });

  assert.equal(sends,0);
  assert.equal(calls.length,1);
  assert.match(result.reply,/Proveedor analizado/);
});

test('worker convierte CONTACT_PENDING autónomo en primer contacto dentro de horario', async () => {
  const calls=[];
  const sent=[];
  const env={
    PROVIDER_AUTONOMOUS_INVESTIGATION_ENABLED:'true',
    CONNECT_PROVIDER_INTELLIGENCE_TOKEN:'test-provider-token'
  };
  const item={
    provider:{id:'provider-queue-1',tradeName:'Proveedor Queue'},
    recruitment:{
      providerId:'provider-queue-1',
      recruitmentStatus:'CONTACT_PENDING',
      contactVerified:true,
      lastContactAt:null,
      followupAttempts:0,
      source:{autonomousInvestigation:true}
    },
    nextQuestion:'¿Tienen catálogo vigente?'
  };

  assert.equal(isAutonomousInitialPending(item,env),true);

  const fetchImpl=async(url,options={})=>{
    const path=String(url),method=options.method||'GET';
    calls.push({path,method});
    if(path.endsWith('/api/v1/providers/provider-queue-1/recruitment/contact-preflight?mode=autonomous')){
      return response(200,{contact:'50576665555'});
    }
    if(path.endsWith('/api/v1/providers/provider-queue-1/recruitment/contact-attempts') && method==='POST'){
      return response(200,{recruitment:{recruitmentStatus:'CONTACTED'}});
    }
    throw new Error('URL inesperada '+method+' '+path);
  };

  const result=await processDueItem(item,{
    env,
    fetchImpl,
    delivery:{
      async sendText({phone,text}){
        sent.push({phone,text});
        return{messageId:'wa-queue-1'};
      }
    }
  });

  assert.equal(result.action,'INITIAL_SENT');
  assert.equal(sent.length,1);
  assert.equal(sent[0].phone,'50576665555');
  assert.match(sent[0].text,/soy ELAN/i);
  assert.match(sent[0].text,/inteligencia artificial/i);
  assert.equal(calls.some(x=>x.path.includes('/followups') && x.method==='POST'),false);
});
