'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('server.js instala preloads protegidos antes de cargar APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const ownerOps = source.indexOf("require('./services/ownerOpsSupervisorCommandPatch')");
  const owner = source.indexOf("require('./services/ownerBusinessQuotationItemPatch')");
  const live = source.indexOf("require('./services/liveCopilotMessagePatch')");
  const seller = source.indexOf("require('./services/sellerBusinessRuntimeIntegration')");
  const wahaApi = source.indexOf("require('./api/wahaWebhookApi')");

  assert.ok(ownerOps >= 0, 'owner ops supervisor preload debe estar en server.js');
  assert.ok(owner >= 0, 'owner business preload debe estar en server.js');
  assert.ok(live >= 0, 'live copiloto preload debe estar en server.js');
  assert.ok(seller >= 0, 'seller runtime preload debe estar en server.js');
  assert.ok(wahaApi >= 0, 'wahaWebhookApi debe existir');
  assert.ok(ownerOps < owner, 'owner ops debe instalarse antes de cargar messageService por Owner Business');
  assert.ok(owner < wahaApi, 'owner preload debe instalarse antes de wahaWebhookApi');
  assert.ok(live < wahaApi, 'live preload debe instalar hook antes de wahaWebhookApi');
  assert.ok(seller < wahaApi, 'seller runtime debe instalarse antes de wahaWebhookApi');
});

test('arranque directo sin npm preload instala Owner Business Gateway', () => {
  const script = [
    "require('./services/ownerBusinessQuotationItemPatch');",
    "const messageService=require('./services/messageService');",
    "const gateway=require('./services/ownerBusinessProcessMessageGateway');",
    "const mark=Symbol.for('elankav.ownerBusinessProcessMessageGateway.installed');",
    "const exact='Buscar 500 empresas con presencia física en Nicaragua que puedan requerir servicios de ELANVISUAL, priorizando hoteles, restaurantes, comercios, clínicas, universidades, bancos, constructoras y centros comerciales. Localizar prioritariamente decisores públicos de Mercadeo o Compras.';",
    "const command=gateway.detectOwnerBusinessCommand(exact);",
    "if(!messageService[mark]) process.exit(41);",
    "if(!command || command.type!=='business_prospecting_mission_create') process.exit(42);",
    "process.stdout.write(command.type);"
  ].join('');

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /business_prospecting_mission_create/);
});


test('preload estable reconoce deploy natural de Langflow antes de cargar messageService', () => {
  const sha = 'fedcba0987654321fedcba0987654321fedcba09';
  const script = [
    "require('./services/ownerBusinessQuotationItemPatch');",
    "const owner=require('./services/ownerCommandService');",
    `const command=owner.detectOwnerCommand('ELAN despliega Langflow commit ${sha}\\nNo reinicies WAHA.');`,
    "if(!command || command.capability!=='repository.deploy') process.exit(51);",
    "if(command.target!=='langflow') process.exit(52);",
    "if(command.parameters.expectedCommit!=='fedcba0987654321fedcba0987654321fedcba09') process.exit(53);",
    "process.stdout.write(command.target);"
  ].join('');

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, 'langflow');
});
