'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

function clean(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripHtml(html) {
  return normalizeText(
    decodeHtml(
      clean(html)
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function extractMeta(html, keys = []) {
  const tags = clean(html).match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const propertyMatch = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    const key = normalizeText(propertyMatch?.[1] || '');

    if (contentMatch && keys.some((candidate) => key === normalizeText(candidate))) {
      return decodeHtml(contentMatch[1]);
    }
  }

  return '';
}

function extractImageUrls(html, baseUrl) {
  const candidates = [];

  const push = (value) => {
    const raw = clean(value);
    if (!raw) return;
    const absolute = absoluteHttps(raw, baseUrl);
    if (!absolute) return;

    const lowered = absolute.toLowerCase();
    if (
      lowered.includes('logo') ||
      lowered.includes('icon') ||
      lowered.includes('avatar') ||
      lowered.includes('sprite') ||
      lowered.endsWith('.svg')
    ) {
      return;
    }

    if (!candidates.includes(absolute)) candidates.push(absolute);
  };

  for (const tag of clean(html).match(/<meta\b[^>]*>/gi) || []) {
    const propertyMatch = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    const key = normalizeText(propertyMatch?.[1] || '');

    if (
      contentMatch &&
      ['og:image','og:image:url','twitter:image','twitter:image:src']
        .includes(key)
    ) {
      push(decodeHtml(contentMatch[1]));
    }
  }

  const jsonImagePattern = /["']image["']\s*:\s*(\[[\s\S]*?\]|["'][^"']+["'])/gi;
  for (const match of clean(html).matchAll(jsonImagePattern)) {
    const raw = clean(match[1]);
    for (const urlMatch of raw.matchAll(/https?:\\?\/\\?\/[^"'\s\\\]]+/gi)) {
      push(urlMatch[0].replace(/\\\//g, '/'));
    }
  }

  for (const tag of clean(html).match(/<img\b[^>]*>/gi) || []) {
    const srcsetMatch = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
      for (const part of srcsetMatch[1].split(',')) {
        push(part.trim().split(/\s+/)[0]);
      }
    }

    const srcMatch = tag.match(/\b(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) push(srcMatch[1]);

    if (candidates.length >= 20) break;
  }

  return candidates.slice(0, 20);
}

function titleTokens(value) {
  const stop = new Set([
    'para','desde','hasta','venta','vende','vendo','alquiler','renta',
    'nicaragua','managua','oferta','nuevo','nueva','usado','usada',
    'con','sin','del','las','los','una','uno','por'
  ]);

  return [...new Set(
    normalizeText(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length >= 4 && !stop.has(token))
  )];
}

function titleConfirmed(candidateTitle, pageTitle, pageText) {
  const tokens = titleTokens(candidateTitle);
  if (!tokens.length) return false;

  const haystack = normalizeText(`${pageTitle} ${pageText.slice(0, 8000)}`);
  const matched = tokens.filter((token) => haystack.includes(token));

  return matched.length >= Math.min(2, tokens.length) &&
    matched.length / tokens.length >= 0.4;
}

function priceConfirmed(amount, pageText) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return false;

  const integer = String(Math.round(value));
  const normalized = clean(pageText)
    .replace(/(?<=\d)[,.](?=\d{3}\b)/g, '')
    .replace(/\s+/g, ' ');

  return normalized.includes(integer);
}

function locationConfirmed(location, pageText) {
  if (!location || typeof location !== 'object') return false;

  const candidates = [
    location.locality,
    location.municipality,
    location.department
  ]
    .map(normalizeText)
    .filter((value) => value.length >= 3);

  if (!candidates.length) return false;

  const haystack = normalizeText(pageText);
  return candidates.some((value) => haystack.includes(value));
}

function contactConfirmed(contact, pageText) {
  const raw = clean(contact);
  if (!raw) return false;

  const email = raw.includes('@') ? normalizeText(raw) : '';
  if (email && normalizeText(pageText).includes(email)) return true;

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 7) {
    return pageText.replace(/\D/g, '').includes(digits);
  }

  return normalizeText(pageText).includes(normalizeText(raw));
}

function isPrivateIp(address) {
  if (!address) return true;

  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return true;
}

async function assertPublicHostname(hostname) {
  const name = clean(hostname).toLowerCase();
  if (!name || name === 'localhost' || name.endsWith('.local')) {
    throw Object.assign(new Error('SOURCE_HOST_NOT_PUBLIC'), {
      code: 'SOURCE_HOST_NOT_PUBLIC'
    });
  }

  if (net.isIP(name)) {
    if (isPrivateIp(name)) {
      throw Object.assign(new Error('SOURCE_HOST_PRIVATE'), {
        code: 'SOURCE_HOST_PRIVATE'
      });
    }
    return;
  }

  const results = await dns.lookup(name, { all: true, verbatim: true });
  if (!results.length || results.some((item) => isPrivateIp(item.address))) {
    throw Object.assign(new Error('SOURCE_DNS_PRIVATE'), {
      code: 'SOURCE_DNS_PRIVATE'
    });
  }
}

async function fetchPublicHtml(sourceUrl, env = process.env) {
  const timeoutMs = Math.max(
    3000,
    Number(env.ELAN_MARKETPLACE_SOURCE_VERIFY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  );

  let current = new URL(sourceUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (current.protocol !== 'https:') {
      throw Object.assign(new Error('SOURCE_HTTPS_REQUIRED'), {
        code: 'SOURCE_HTTPS_REQUIRED'
      });
    }

    await assertPublicHostname(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'ELAN-GO/1.0 (+https://go.elankav.com)'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw Object.assign(new Error('SOURCE_REDIRECT_INVALID'), {
          code: 'SOURCE_REDIRECT_INVALID'
        });
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw Object.assign(new Error(`SOURCE_HTTP_${response.status}`), {
        code: 'SOURCE_HTTP_ERROR',
        statusCode: response.status
      });
    }

    const contentType = clean(response.headers.get('content-type')).toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw Object.assign(new Error('SOURCE_NOT_HTML'), {
        code: 'SOURCE_NOT_HTML'
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw Object.assign(new Error('SOURCE_BODY_UNAVAILABLE'), {
        code: 'SOURCE_BODY_UNAVAILABLE'
      });
    }

    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error('SOURCE_HTML_TOO_LARGE'), {
          code: 'SOURCE_HTML_TOO_LARGE'
        });
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      html: new TextDecoder().decode(bytes),
      finalUrl: current.toString(),
      statusCode: response.status
    };
  }

  throw Object.assign(new Error('SOURCE_REDIRECT_LIMIT'), {
    code: 'SOURCE_REDIRECT_LIMIT'
  });
}

function absoluteHttps(value, baseUrl) {
  const raw = clean(value);
  if (!raw) return null;

  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function verifyDiscoverySource(discovery = {}, env = process.env) {
  const sourceUrl = clean(discovery.sourceUrl);
  if (!/^https:\/\//i.test(sourceUrl)) {
    return {
      verified: false,
      code: 'SOURCE_URL_INVALID'
    };
  }

  try {
    const fetched = await fetchPublicHtml(sourceUrl, env);
    const pageText = stripHtml(fetched.html);
    const pageTitle =
      extractMeta(fetched.html, ['og:title', 'twitter:title']) ||
      decodeHtml((fetched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');

    const titleOk = titleConfirmed(discovery.title, pageTitle, pageText);
    if (!titleOk) {
      return {
        verified: false,
        code: 'SOURCE_TITLE_MISMATCH',
        statusCode: fetched.statusCode,
        finalUrl: fetched.finalUrl
      };
    }

    const candidateHasPrice =
      Number.isFinite(Number(discovery.priceAmount)) &&
      Number(discovery.priceAmount) > 0;

    const priceOk = candidateHasPrice
      ? priceConfirmed(discovery.priceAmount, pageText)
      : false;

    const candidateHasLocation =
      discovery.location &&
      typeof discovery.location === 'object' &&
      Boolean(
        clean(discovery.location.locality) ||
        clean(discovery.location.municipality) ||
        clean(discovery.location.department)
      );

    const locationOk = candidateHasLocation
      ? locationConfirmed(discovery.location, pageText)
      : false;

    const candidateHasContact = Boolean(clean(discovery.contactHint));
    const contactOk = candidateHasContact
      ? contactConfirmed(discovery.contactHint, pageText)
      : false;

    const imageUrls = extractImageUrls(fetched.html, fetched.finalUrl);
    const imageUrl = imageUrls[0] || null;

    const sourceDescription = extractMeta(
      fetched.html,
      ['og:description', 'description', 'twitter:description']
    );

    return {
      verified: true,
      code: 'SOURCE_CONFIRMED',
      statusCode: fetched.statusCode,
      finalUrl: fetched.finalUrl,
      pageTitle: clean(pageTitle).slice(0, 220),
      sourceDescription: clean(sourceDescription).slice(0, 10000),
      imageUrl,
      imageUrls,
      priceConfirmed: priceOk,
      locationConfirmed: locationOk,
      contactConfirmed: contactOk,
      verifiedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      verified: false,
      code: clean(error?.code) || 'SOURCE_VERIFY_FAILED',
      statusCode: Number(error?.statusCode) || null
    };
  }
}

module.exports = {
  absoluteHttps,
  assertPublicHostname,
  contactConfirmed,
  extractImageUrls,
  extractMeta,
  fetchPublicHtml,
  isPrivateIp,
  locationConfirmed,
  normalizeText,
  priceConfirmed,
  stripHtml,
  titleConfirmed,
  titleTokens,
  verifyDiscoverySource
};
