'use strict';

const normalize = value => String(value || '').trim();

function normalizeWhatsappE164(value, defaultCountryCode = '505') {
  const raw = normalize(value);
  if (!raw) return '';

  const compact = raw.replace(/[\s().-]/g, '');
  let digits = compact.replace(/\D/g, '');

  if (compact.startsWith('00')) {
    digits = compact.slice(2).replace(/\D/g, '');
  } else if (!compact.startsWith('+')) {
    if (digits.length === 8) {
      digits = `${defaultCountryCode}${digits}`;
    } else if (!(defaultCountryCode === '505' && digits.length === 11 && digits.startsWith('505'))) {
      return '';
    }
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
  return `+${digits}`;
}

module.exports = { normalizeWhatsappE164 };
