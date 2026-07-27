'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = Object.freeze({ domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 });

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function atLocalHour(date, hour = 9) {
  const resolved = new Date(date);
  resolved.setHours(hour, 0, 0, 0);
  return resolved;
}

function nextWeekday(now, weekday) {
  const date = atLocalHour(now);
  let delta = (weekday - date.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function resolveRelativeDate(text, now = new Date()) {
  const value = normalizeText(text);
  if (/\bmañana\b/.test(value)) return atLocalHour(new Date(now.getTime() + DAY_MS));
  if (/\bpasado mañana\b/.test(value)) return atLocalHour(new Date(now.getTime() + (2 * DAY_MS)));
  if (/\bla próxima semana\b|\bla proxima semana\b/.test(value)) return atLocalHour(new Date(now.getTime() + (7 * DAY_MS)));

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(value)) return nextWeekday(now, weekday);
  }

  const monthMatch = value.match(/\ben\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/);
  if (monthMatch) {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const month = months.indexOf(monthMatch[1]);
    const year = month <= now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, 1, 9, 0, 0, 0);
  }

  return null;
}

function detectCommitmentType(text) {
  const value = normalizeText(text);
  if (/\b(deposito|deposito|pago|transfiero|abono|cancelo)\b/.test(value)) return 'PAYMENT';
  if (/\b(confirmo|te aviso|respondo|reviso)\b/.test(value)) return 'DECISION';
  if (/\b(hablo|hablar[eé]|consulto|consultar[eé]).*(socio|esposa|esposo|jefe|equipo)\b/.test(value)) return 'THIRD_PARTY_REVIEW';
  if (/\bcuando cobre\b/.test(value)) return 'FUNDS_AVAILABILITY';
  return 'GENERAL_FOLLOW_UP';
}

function detectFollowUpCommitment({ message, now = new Date() }) {
  const value = normalizeText(message);
  const dueAt = resolveRelativeDate(value, now);
  const commitmentSignal = /\b(deposito|deposito|pago|transfiero|abono|confirmo|te aviso|respondo|reviso|cuando cobre|hablar[eé]|consultar[eé])\b/.test(value);
  const softDelaySignal = /\b(d[eé]jame revisar|lo voy a pensar|te confirmo|la próxima semana|la proxima semana|en agosto)\b/.test(value);

  if (!commitmentSignal && !softDelaySignal) {
    return Object.freeze({ detected: false, confidence: 0, dueAt: null, reason: null, priority: null });
  }

  const confidence = dueAt ? 0.94 : 0.72;
  return Object.freeze({
    detected: true,
    confidence,
    dueAt: dueAt ? dueAt.toISOString() : null,
    reason: detectCommitmentType(value),
    priority: /\b(deposito|deposito|pago|transfiero|abono)\b/.test(value) ? 'HIGH' : 'NORMAL',
    sourceText: String(message || '').trim()
  });
}

module.exports = {
  detectFollowUpCommitment,
  nextWeekday,
  resolveRelativeDate
};
