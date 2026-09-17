#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const TARGET = '/opt/elankav-new-lab/orchestrator-core/src/server.js';
const OWNER_COMMAND_SERVICE = '/opt/elankav/orchestrator/services/ownerCommandService.js';
const UNIT = 'elan-one-orchestrator-core.service';
const MARKER = 'owner-command-protected-bridge';

const OLD_BLOCK = `            } else if (chatId === OWNER_CHAT_ID) {
              reply = 'ELAN ONE conectado';
              route = 'connectivity';
            } else {`;

const NEW_BLOCK = `            } else if (chatId === OWNER_CHAT_ID) {
              const ownerCommandService = require('/opt/elankav/orchestrator/services/ownerCommandService.js');
              const ownerCommand = ownerCommandService.detectOwnerCommand(text);

              if (ownerCommand) {
                const ownerResult = await ownerCommandService.executeOwnerCommand({
                  command: ownerCommand,
                  platform: ownerCommand?.platform || 'elanvisual'
                });
                reply = String(ownerResult?.outputText || '').trim() || 'Orden Owner procesada sin respuesta.';
                route = 'owner-command-protected-bridge';
              } else {
                reply = 'ELAN ONE conectado';
                route = 'connectivity';
              }
            } else {`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function restoreBackup(backup) {
  fs.copyFileSync(backup, TARGET);
  try { run('systemctl', ['restart', UNIT]); } catch (_) {}
}

function abort(message) {
  console.error(`ABORT:${message}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) abort('TARGET_NOT_FOUND');
if (!fs.existsSync(OWNER_COMMAND_SERVICE)) abort('OWNER_COMMAND_SERVICE_NOT_FOUND');

const ownerModule = require(OWNER_COMMAND_SERVICE);
if (typeof ownerModule.detectOwnerCommand !== 'function') abort('OWNER_DETECTOR_NOT_AVAILABLE');
if (typeof ownerModule.executeOwnerCommand !== 'function') abort('OWNER_EXECUTOR_NOT_AVAILABLE');

const before = fs.readFileSync(TARGET, 'utf8');
const beforeHash = sha256(before);
console.log(`BEFORE_SHA256=${beforeHash}`);

if (before.includes(MARKER)) {
  run('node', ['--check', TARGET]);
  console.log('OWNER_MOBILE_ROUTER_RESCUE=ALREADY_APPLIED');
  process.exit(0);
}

const occurrences = countOccurrences(before, OLD_BLOCK);
if (occurrences !== 1) abort(`EXPECTED_BLOCK_COUNT_${occurrences}`);

const backup = `${TARGET}.owner-mobile-router.${Date.now()}.bak`;
fs.copyFileSync(TARGET, backup);
fs.chmodSync(backup, 0o600);
console.log(`BACKUP=${backup}`);

const after = before.replace(OLD_BLOCK, NEW_BLOCK);
fs.writeFileSync(TARGET, after, 'utf8');

try {
  run('node', ['--check', TARGET]);
} catch (error) {
  restoreBackup(backup);
  abort('NODE_CHECK_FAILED_ROLLED_BACK');
}

try {
  run('systemctl', ['restart', UNIT]);
  const active = run('systemctl', ['is-active', UNIT]);
  if (active !== 'active') throw new Error(`SERVICE_${active}`);
} catch (error) {
  restoreBackup(backup);
  abort(`SERVICE_RESTART_FAILED_ROLLED_BACK:${error.message}`);
}

const installed = fs.readFileSync(TARGET, 'utf8');
if (!installed.includes(MARKER)) {
  restoreBackup(backup);
  abort('POSTCHECK_MARKER_MISSING_ROLLED_BACK');
}

console.log(`AFTER_SHA256=${sha256(installed)}`);
console.log(`SERVICE=${run('systemctl', ['is-active', UNIT])}`);
console.log('OWNER_MOBILE_ROUTER_RESCUE=PASS');
console.log('NEXT_TEST=Send exactly: ELAN capacidades');
