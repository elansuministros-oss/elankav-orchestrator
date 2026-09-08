'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function clean(value) {
  return String(value || '').trim();
}

function isLocalVoiceEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(clean(env.ELAN_LOCAL_VOICE_ENABLED).toLowerCase());
}

function localVoiceConfig(env = process.env) {
  const root = clean(env.ELAN_LOCAL_VOICE_ROOT);
  if (!root) {
    const error = new Error('ELAN_LOCAL_VOICE_ROOT_REQUIRED');
    error.code = 'ELAN_LOCAL_VOICE_ROOT_REQUIRED';
    throw error;
  }
  return {
    root,
    python: clean(env.ELAN_LOCAL_VOICE_PYTHON) || '/usr/bin/python3',
    sttScript: clean(env.ELAN_LOCAL_STT_SCRIPT) || path.join(root, 'stt', 'transcribe.py'),
    ttsScript: clean(env.ELAN_LOCAL_TTS_SCRIPT) || path.join(root, 'tts', 'synthesize.py')
  };
}
function runProcess(command, args, { input = '', timeoutMs = 90_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error('LOCAL_VOICE_TIMEOUT');
      error.code = 'LOCAL_VOICE_TIMEOUT';
      reject(error);
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      const error = new Error(stderr.trim() || `LOCAL_VOICE_EXIT_${code}`);
      error.code = 'LOCAL_VOICE_PROCESS_FAILED';
      reject(error);
    });
    child.stdin.end(input);
  });
}
function audioExtension(mimeType = '', filename = '') {
  const nameExt = path.extname(String(filename || '')).toLowerCase();
  if (['.ogg', '.opus', '.mp3', '.wav', '.webm', '.m4a', '.mp4'].includes(nameExt)) return nameExt;
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('opus')) return '.opus';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('m4a') || mime.includes('mp4')) return '.m4a';
  return '.audio';
}

async function transcribeAudioLocal({ audio, mimeType, filename, env = process.env, spawnImpl } = {}) {
  if (!audio?.length) {
    const error = new Error('LOCAL_STT_AUDIO_REQUIRED');
    error.code = 'LOCAL_STT_AUDIO_REQUIRED';
    throw error;
  }
  const config = localVoiceConfig(env);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-stt-'));
  const audioPath = path.join(dir, `input${audioExtension(mimeType, filename)}`);
  try {
    await fs.writeFile(audioPath, audio, { mode: 0o600 });
    const result = await runProcess(config.python, [config.sttScript, audioPath, '--language', 'es'], { spawnImpl });
    if (!result.stdout) throw Object.assign(new Error('LOCAL_STT_EMPTY'), { code: 'LOCAL_STT_EMPTY' });
    return result.stdout;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
async function synthesizeSpeechLocal({ text, env = process.env, spawnImpl } = {}) {
  const normalizedText = clean(text);
  if (!normalizedText) {
    const error = new Error('LOCAL_TTS_TEXT_REQUIRED');
    error.code = 'LOCAL_TTS_TEXT_REQUIRED';
    throw error;
  }
  const config = localVoiceConfig(env);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'elan-tts-'));
  const outputPath = path.join(dir, 'output.wav');
  try {
    await runProcess(config.python, [config.ttsScript, outputPath], {
      input: normalizedText,
      timeoutMs: 60_000,
      spawnImpl
    });
    const buffer = await fs.readFile(outputPath);
    if (buffer.length <= 44) throw Object.assign(new Error('LOCAL_TTS_EMPTY'), { code: 'LOCAL_TTS_EMPTY' });
    return { data: buffer.toString('base64'), mimeType: 'audio/wav' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  audioExtension,
  isLocalVoiceEnabled,
  localVoiceConfig,
  runProcess,
  synthesizeSpeechLocal,
  transcribeAudioLocal
};
