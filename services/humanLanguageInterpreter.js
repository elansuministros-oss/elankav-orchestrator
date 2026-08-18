'use strict';

const EXACT_ALIASES = new Map(Object.entries({
  escrivele: 'escribile',
  escribele: 'escribile',
  escribile: 'escribile',
  escribale: 'escribile',
  actualisa: 'actualiza',
  actualisale: 'actualizale',
  actualizale: 'actualizale',
  actualize: 'actualiza',
  actuliza: 'actualiza',
  infornacion: 'informacion',
  informasion: 'informacion',
  infomacion: 'informacion',
  agraga: 'agrega',
  agragale: 'agregale',
  agragalo: 'agregalo',
  agragala: 'agregala',
  wasap: 'whatsapp',
  wassap: 'whatsapp',
  whatsap: 'whatsapp',
  watsapp: 'whatsapp',
  whatsaap: 'whatsapp',
  venddor: 'vendedor',
  vendedor: 'vendedor',
  vendedro: 'vendedor',
  vendedr: 'vendedor',
  contrasena: 'contrasena',
  correo: 'correo',
  coreo: 'correo',
  elimna: 'elimina',
  elimin: 'elimina',
  desactiba: 'desactiva',
  confimar: 'confirmar',
  confrimar: 'confirmar',
  mostrame: 'mostrame',
  mostrane: 'mostrame'
}));

const FUZZY_CANONICAL = [
  'escribile', 'actualiza', 'actualizale', 'informacion', 'agrega', 'agregale',
  'agregalo', 'agregala', 'whatsapp', 'vendedor', 'vendedora', 'correo',
  'elimina', 'desactiva', 'confirmar', 'cancelar', 'corregir', 'mostrame',
  'buscar', 'ventas'
];

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = row[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return row[right.length];
}

function uniqueFuzzyCanonical(token) {
  const folded = fold(token);
  if (folded.length < 5) return '';
  const threshold = folded.length >= 8 ? 2 : 1;
  const candidates = FUZZY_CANONICAL
    .map(canonical => ({ canonical, distance: levenshtein(folded, canonical) }))
    .filter(item => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return '';
  if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) return '';
  return candidates[0].canonical;
}

function normalizeOperationalToken(token) {
  const folded = fold(token);
  if (EXACT_ALIASES.has(folded)) return EXACT_ALIASES.get(folded);
  return uniqueFuzzyCanonical(folded) || token;
}

function normalizeHumanMessage(value) {
  const raw = String(value || '');
  if (!raw.trim()) return raw;
  const normalized = raw.replace(/\p{L}+/gu, word => normalizeOperationalToken(word));
  return normalized.replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function cleanTarget(value) {
  return String(value || '')
    .trim()
    .replace(/^elan\s*[,;:\-]?\s*/i, '')
    .replace(/[,:;.]+$/g, '')
    .trim();
}

function detectSellerFieldUpdate(message) {
  const raw = normalizeHumanMessage(message);
  const action = '(?:agrega|agregale|agregalo|cambia|cambiale|actualiza|actualizale|modifica|modificale|ponele|ponle)';
  const field = '(whatsapp|telefono|celular|correo|email|zona|territorio)';

  let match = raw.match(new RegExp(`\\b${action}\\s+(?:a\\s+)?(.+?)\\s+(?:(?:el|la|su)\\s+)?${field}\\s*(?:a|por|es|:|=)?\\s*(.+?)\\s*$`, 'i'));
  let target;
  let fieldName;
  let value;

  if (match) {
    target = cleanTarget(match[1]);
    fieldName = fold(match[2]);
    value = String(match[3] || '').trim().replace(/[.!]+$/, '').trim();
  } else {
    match = raw.match(new RegExp(`\\b${action}\\s+(?:(?:el|la|su)\\s+)?${field}\\s+(?:a|de)\\s+(.+?)\\s+(?:a|por|es|:|=)\\s*(.+?)\\s*$`, 'i'));
    if (!match) return null;
    fieldName = fold(match[1]);
    target = cleanTarget(match[2]);
    value = String(match[3] || '').trim().replace(/[.!]+$/, '').trim();
  }

  if (!target || !value) return null;
  const data = {};
  if (['whatsapp', 'telefono', 'celular'].includes(fieldName)) {
    const phone = normalizePhone(value);
    if (!phone) return null;
    const formatted = `+${phone}`;
    if (fieldName === 'whatsapp') data.whatsapp = formatted;
    else data.phone = formatted;
    if (fieldName === 'whatsapp' || fieldName === 'celular') {
      data.whatsapp = formatted;
      data.phone = formatted;
    }
  } else if (['correo', 'email'].includes(fieldName)) {
    const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
    if (!email) return null;
    data.email = email;
  } else {
    data.zone = value;
  }

  return {
    sellerPreview: true,
    action: 'edit',
    query: target,
    data,
    tool: 'previsualizar_editar_vendedor',
    humanLanguageIntent: 'SELLER_UPDATE_FIELD'
  };
}

module.exports = {
  detectSellerFieldUpdate,
  fold,
  levenshtein,
  normalizeHumanMessage,
  normalizeOperationalToken,
  normalizePhone
};
