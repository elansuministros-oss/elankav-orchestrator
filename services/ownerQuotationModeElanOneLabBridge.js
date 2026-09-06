'use strict';

const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');

const LAB_SERVICE_PATH =
  '/opt/elankav-new-lab/orchestrator-provider-service-lab/services/ownerQuotationModeService.js';
const LAB_ENV_PATH =
  '/etc/elan-one-connect-quotation-lab.env';

function readLabVqsToken() {
  const raw = readFileSync(LAB_ENV_PATH, 'utf8');
  const line = raw
    .split(/\r?\n/)
    .find(value => value.startsWith('VQS_API_TOKEN='));

  const token = line
    ? line.slice('VQS_API_TOKEN='.length).trim()
    : '';

  if (!token) {
    const error = new Error('ELAN_ONE_LAB_VQS_TOKEN_REQUIRED');
    error.code = 'ELAN_ONE_LAB_VQS_TOKEN_REQUIRED';
    throw error;
  }

  return token;
}

function labEnv() {
  return {
    ...process.env,
    CONNECT_BASE_URL: 'http://127.0.0.1:8102',
    ELAN_ONE_CONNECT_BASE_URL: 'http://127.0.0.1:8102',
    VQS_API_TOKEN: readLabVqsToken(),
    OWNER_QUOTATION_MODE_STORE_PATH:
      '/var/lib/elankav-new-lab/owner-quotation-mode-whatsapp.json',
    OWNER_BUSINESS_CONTEXT_STORE_PATH:
      '/var/lib/elankav-new-lab/owner-business-context-whatsapp.json'
  };
}

const CHILD_SCRIPT = [
  "console.log=()=>{};",
  "const service=require(process.argv[1]);",
  "const method=process.argv[2];",
  "const payload=JSON.parse(Buffer.from(process.argv[3],'base64').toString('utf8'));",
  "(async()=>{",
  "let result;",
  "if(method==='getState') result=await service.getState(payload.identity||payload);",
  "else result=await service[method](payload);",
  "process.stdout.write(JSON.stringify(result??null));",
  "})().catch(error=>{",
  "process.stderr.write(String(error&&error.stack||error));",
  "process.exit(1);",
  "});"
].join('');

function runLab(method, payload) {
  const encoded = Buffer
    .from(JSON.stringify(payload || {}), 'utf8')
    .toString('base64');

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['-e', CHILD_SCRIPT, LAB_SERVICE_PATH, method, encoded],
      {
        env: labEnv(),
        timeout: 30000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const wrapped = new Error(
            String(stderr || error.message || 'ELAN_ONE_QUOTATION_LAB_FAILED').trim()
          );
          wrapped.code = 'ELAN_ONE_QUOTATION_LAB_FAILED';
          reject(wrapped);
          return;
        }

        try {
          resolve(JSON.parse(String(stdout || 'null')));
        } catch (parseError) {
          parseError.code = 'ELAN_ONE_QUOTATION_LAB_RESPONSE_INVALID';
          reject(parseError);
        }
      }
    );
  });
}

async function getState(identity) {
  return runLab('getState', { identity });
}

async function processQuotationModeText(input) {
  return runLab('processQuotationModeText', input);
}

async function processQuotationModeImage(input) {
  return runLab('processQuotationModeImage', input);
}

module.exports = {
  getState,
  processQuotationModeImage,
  processQuotationModeText
};
