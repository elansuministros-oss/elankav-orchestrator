'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../services/messageService.js');
const source = fs.readFileSync(target, 'utf8');
let next = source;

const importBefore = "const { generateText } = require('./openaiService');";
const importAfter = "const { generateText } = require('./openaiService');\nconst { resolveAccessPolicy } = require('./accessPolicyService');";

if (!next.includes("require('./accessPolicyService')")) {
  if (!next.includes(importBefore)) {
    throw new Error('No se encontró import de openaiService');
  }
  next = next.replace(importBefore, importAfter);
  console.log('✓ accessPolicyService importado');
} else {
  console.log('✓ accessPolicyService ya estaba importado');
}

const ownerBefore = "      const ownerMode = Boolean(context.owner?.isOwner);";
const ownerAfter = `      const ownerMode = Boolean(context.owner?.isOwner);\n      const access = resolveAccessPolicy({\n        isOwner: ownerMode,\n        delegatedScopes: Array.isArray(context.metadata?.delegatedScopes)\n          ? context.metadata.delegatedScopes\n          : []\n      });`;

if (!next.includes('const access = resolveAccessPolicy')) {
  if (!next.includes(ownerBefore)) {
    throw new Error('No se encontró resolución ownerMode');
  }
  next = next.replace(ownerBefore, ownerAfter);
  console.log('✓ política de acceso resuelta por mensaje');
} else {
  console.log('✓ política de acceso ya estaba resuelta');
}

next = next.replace(
  "      const ownerCommand = ownerMode\n        ? detectOwnerCommand(normalizedMessage)\n        : null;",
  "      const ownerCommand = access.fullAccess\n        ? detectOwnerCommand(normalizedMessage)\n        : null;"
);

next = next.replace(
  '      if (ownerMode) {\n        const crmConversation',
  '      if (access.fullAccess) {\n        const crmConversation'
);

next = next.replace(
  '      const [crm, ecosystem] = ownerMode\n',
  '      const [crm, ecosystem] = access.fullAccess\n'
);

const contextBefore = `          ownerMode,\n          ownerName: ownerMode ? 'Erick Cano' : null,`;
const contextAfter = `          ownerMode,\n          ownerName: ownerMode ? 'Erick Cano' : null,\n          access,`;

if (!next.includes('          access,\n          externalUserId')) {
  if (!next.includes(contextBefore)) {
    throw new Error('No se encontró contexto OpenAI ownerName');
  }
  next = next.replace(contextBefore, contextAfter);
  console.log('✓ política incluida en contexto OpenAI');
}

const responseBefore = `      ownerMode: Boolean(resolvedContext?.owner?.isOwner)\n    },`;
const responseAfter = `      ownerMode: Boolean(resolvedContext?.owner?.isOwner),\n      access: resolveAccessPolicy({\n        isOwner: Boolean(resolvedContext?.owner?.isOwner),\n        delegatedScopes: Array.isArray(resolvedContext?.metadata?.delegatedScopes)\n          ? resolvedContext.metadata.delegatedScopes\n          : []\n      })\n    },`;

if (!next.includes('      access: resolveAccessPolicy({\n        isOwner: Boolean(resolvedContext?.owner?.isOwner)')) {
  if (!next.includes(responseBefore)) {
    throw new Error('No se encontró bloque context de respuesta');
  }
  next = next.replace(responseBefore, responseAfter);
  console.log('✓ política incluida en respuesta técnica');
}

if (next === source) {
  console.log('Sin cambios pendientes.');
  process.exit(0);
}

const backup = `${target}.bak.sec-owner-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, next, 'utf8');

console.log(`✓ Respaldo: ${backup}`);
console.log(`✓ Archivo actualizado: ${target}`);
