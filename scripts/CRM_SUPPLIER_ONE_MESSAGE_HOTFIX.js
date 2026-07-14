'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(__dirname, '../services/crmConversationService.js');
const source = fs.readFileSync(target, 'utf8');
let next = source;

function replaceFunction(name, replacement) {
  const startToken = `function ${name}(`;
  const start = next.indexOf(startToken);
  if (start < 0) throw new Error(`No se encontró ${name}`);

  let brace = next.indexOf('{', start);
  if (brace < 0) throw new Error(`No se encontró apertura de ${name}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let end = -1;

  for (let i = brace; i < next.length; i += 1) {
    const char = next[i];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) throw new Error(`No se encontró cierre de ${name}`);
  next = next.slice(0, start) + replacement + next.slice(end);
  console.log(`✓ ${name} reemplazada`);
}

replaceFunction('isAuthorizedInline', `function isAuthorizedInline(message) {
  const value = normalizeCommand(message);

  return /\\b(hazlo|hacelo|ejecuta|ejecutalo|guardalo|registralo|actualizalo|crealo|confirmame cuando|deja guardado|procede)\\b/.test(value) ||
    /^(agrega|agregar|registra|registrar|crea|crear|actualiza|actualizar|modifica|modificar|cambia|cambiar)\\b/.test(value);
}`);

replaceFunction('parseSupplierName', `function parseSupplierName(message) {
  const raw = normalizeCommand(message);
  const patterns = [
    /(?:actualizar|actualiza|modificar|modifica|cambiar|cambia)(?:\\s+los datos|\\s+el contacto)?(?:\\s+de|\\s+del|\\s+al|\\s+el)?\\s+proveedor\\s*[:,-]?\\s*([^.;\\n]+)/i,
    /(?:agregar|agrega|crear|crea|registrar|registra)\\s+(?:este\\s+)?proveedor\\s*[:,-]?\\s*([^.;\\n]+)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return normalize(match[1])
        .replace(/\\b(?:contacto|whatsapp|telefono|correo|email|vende|venden|ofrece|ofrecen)\\b.*$/i, '')
        .trim();
    }
  }

  return '';
}`);

replaceFunction('parseCategories', `function parseCategories(message) {
  const raw = normalize(message);

  const labeled = raw.match(
    /(?:vende|venden|ofrece|ofrecen|materiales|productos|categorias?|servicios?)\\s*[:,-]?\\s*(.+?)(?:\\n\\s*\\n|\\n[^\\n]*(?:contacto|whatsapp|telefono|correo|email)|\\b(?:contacto|whatsapp|telefono|correo|email|guardalo|hazlo|ejecuta)\\b|$)/is
  );

  let block = labeled ? labeled[1] : '';

  if (!block) {
    const lines = raw
      .split(/\\r?\\n/)
      .map(line => line.trim())
      .filter(Boolean);

    block = lines
      .slice(1)
      .filter(line => !/(?:contacto|whatsapp|telefono|correo|email|@|\\bmanagua\\b|\\bnacional\\b)/i.test(line))
      .join(', ');
  }

  return block
    .split(/,|\\s+y\\s+/i)
    .map(item => normalize(item))
    .filter(Boolean);
}`);

replaceFunction('parseSupplierType', `function parseSupplierType(message) {
  const value = normalizeCommand(message);
  const hasMaterials = /material|materia prima|ferreter|vinil|lona|acrilico|pvc|coroplast|resina|reflectivo|polarizado|papel|cinta|adhesivo|insumo/.test(value);
  const hasServices = /servicio|impresion|corte laser|corte cnc|fabricacion|instalacion|montaje|estructura|evento|soldadura|rotulacion/.test(value);

  if (hasMaterials && hasServices) return 'mixed';
  if (hasServices) return 'services';
  if (hasMaterials) return 'materials';
  return '';
}`);

replaceFunction('parseContactName', `function parseContactName(message) {
  const raw = normalize(message);
  const explicit = raw.match(/(?:nombre del contacto|contacto)(?:\\s+es)?\\s*[:,-]?\\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ .'-]*?)(?=\\s+(?:\\+?505)?\\s*\\d{4}[\\s.-]*\\d{4}|\\s*[·|;]|\\s+(?:whatsapp|telefono|correo|email)\\b|$)/i);
  if (explicit) return normalize(explicit[1]);
  return extractField(message, ['nombre del contacto', 'contacto', 'nombre']);
}`);

const oldPayload = `function parseSupplierPayload(message) {
  return {
    name: parseSupplierName(message),
    supplierType: parseSupplierType(message),
    categories: parseCategories(message),
    contactName: parseContactName(message),
    contactRole: parseContactRole(message),
    whatsapp: parseWhatsapp(message),
    phone: parseWhatsapp(message),
    email: parseEmail(message),
    country: /\\bnacional\\b/i.test(message) ? 'Nicaragua' : ''
  };
}`;

const newPayload = `function parseSupplierPayload(message) {
  const raw = normalize(message);
  const whatsapp = parseWhatsapp(raw);
  const cityMatch = raw.match(/(?:^|\\n|[·|;])\\s*(Managua|Masaya|Granada|Le[oó]n|Matagalpa|Estel[ií]|Chinandega|Jinotega|Rivas|Carazo|Boaco|Chontales)\\b/i);

  return {
    name: parseSupplierName(raw),
    supplierType: parseSupplierType(raw),
    categories: parseCategories(raw),
    contactName: parseContactName(raw),
    contactRole: parseContactRole(raw),
    whatsapp,
    phone: whatsapp,
    email: parseEmail(raw),
    country: 'Nicaragua',
    city: cityMatch ? normalize(cityMatch[1]) : '',
    notes: 'Registro creado desde orden única del propietario.'
  };
}`;

if (!next.includes(oldPayload)) {
  throw new Error('No se encontró parseSupplierPayload esperado');
}
next = next.replace(oldPayload, newPayload);
console.log('✓ parseSupplierPayload ampliado');

if (next === source) {
  console.log('Sin cambios pendientes.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${target}.bak.crm-supplier-one-message-${stamp}`;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, next, 'utf8');

console.log(`✓ Respaldo: ${backup}`);
console.log(`✓ Archivo actualizado: ${target}`);
