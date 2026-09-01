'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(value, expressions) {
  return expressions.some((expression) => expression.test(value));
}

function isCreativeBriefRequest(text) {
  const value = normalizeText(text);
  if (!value) return false;

  const creationIntent = includesAny(value, [
    /\b(creemos|crear|crea|hagamos|hacer|haz|armemos|armar|preparemos|preparar|prepara|disenemos|disenar|disena|definamos|definir)\b/,
    /\b(necesito|quiero|ocupamos|ocupemos)\b.*\b(plantilla|diseno|pieza|video|reel|mensaje)\b/
  ]);
  const creativeObject = includesAny(value, [
    /\bplantilla\b/,
    /\bdiseno\b/,
    /\bpieza\b/,
    /\bmensaje\b/,
    /\bvideo\b/,
    /\breel\b/,
    /\bstory\b/,
    /\bestado\b/,
    /\bspot\b/
  ]);
  const promptIntent = /\b(prompt|brief|especificaciones|instrucciones para chatgpt|pasarselo a chatgpt|para chatgpt)\b/.test(value);

  return (creationIntent && creativeObject) || (promptIntent && creativeObject);
}

function detectCreativeKind(text) {
  const value = normalizeText(text);
  return /\b(video|reel|story|estado|spot|animacion|audiovisual)\b/.test(value) ? 'video' : 'html';
}

function detectAudience(text) {
  const value = normalizeText(text);
  if (/\bclientes?\b/.test(value) && /\bprospectos?\b/.test(value)) return 'prospectos y clientes';
  if (/\bclientes?\b/.test(value)) return 'clientes';
  return 'prospectos';
}

function detectPurpose(text, kind) {
  const value = normalizeText(text);
  if (/\b(segundo mensaje|segunda comunicacion|segunda pieza|muestras|referencias|portafolio)\b/.test(value)) return 'segundo mensaje';
  if (/\b(seguimiento|follow up|retomar|recordatorio)\b/.test(value)) return 'seguimiento';
  if (/\b(reactivacion|reactivar)\b/.test(value)) return 'reactivación';
  if (/\b(propuesta|presentacion)\b/.test(value)) return 'propuesta personalizada';
  if (/\b(pauta|anuncio|campana pagada|ads?)\b/.test(value)) return 'pauta';
  if (/\b(redes|instagram|facebook|social)\b/.test(value)) return 'redes sociales';
  if (kind === 'video' && /\b(caso de exito|antes y despues|portafolio)\b/.test(value)) return 'portafolio / caso de éxito';
  return 'primer contacto';
}

function detectService(text) {
  const value = normalizeText(text);
  const rules = [
    ['fachadas y rotulación', /\b(fachada|fachadas|rotulacion|rotulo|rotulos|letrero|letreros)\b/],
    ['ACM', /\bacm\b|aluminio compuesto/],
    ['PVC y acrílico', /\b(pvc|acrilico|acrilicos)\b/],
    ['letras corpóreas', /\b(letras corporeas|letra corporea|letras 3d|letra 3d)\b/],
    ['cajas de luz e iluminación', /\b(caja de luz|cajas de luz|led|iluminacion|luminoso|luminosos)\b/],
    ['señalización', /\b(senalizacion|senaletica|directorio|directorios)\b/],
    ['material POP e impresión', /\b(material pop|pop|impresion|banner|banners|display|displays|gran formato)\b/],
    ['viniles', /\b(vinil|viniles|microperforado|frost|polarizado)\b/],
    ['proyectos multisucursal', /\b(multisucursal|sucursales|cadena|franquicia|retail)\b/],
    ['interiores comerciales', /\b(interior|interiores|oficina|recepcion|wpc)\b/]
  ];
  return rules.find(([, regex]) => regex.test(value))?.[0] || 'general / a definir según la oportunidad';
}

function detectRecipient(text) {
  const value = normalizeText(text);
  const roles = [];
  if (/\bmercadeo|marketing\b/.test(value)) roles.push('Mercadeo');
  if (/\bcompras|comprador|procurement\b/.test(value)) roles.push('Compras');
  if (/\bgerencia|gerente|direccion|director\b/.test(value)) roles.push('Gerencia');
  if (/\bcliente final\b/.test(value)) roles.push('Cliente final');
  return roles.length ? [...new Set(roles)].join(' · ') : 'Mercadeo · Compras · Gerencia';
}

function detectStyle(text) {
  const value = normalizeText(text);
  const styles = [];
  for (const [label, regex] of [
    ['premium', /\bpremium\b/],
    ['corporativo', /\bcorporativo|corporativa|ejecutivo|ejecutiva\b/],
    ['minimalista', /\bminimal|minimalista|limpio|limpia\b/],
    ['elegante', /\belegante\b/],
    ['técnico', /\btecnico|tecnica\b/],
    ['moderno', /\bmoderno|moderna\b/],
    ['llamativo', /\bllamativo|llamativa|impactante\b/],
    ['sobrio', /\bsobrio|sobria\b/]
  ]) {
    if (regex.test(value)) styles.push(label);
  }
  return styles.length ? [...new Set(styles)].join(' · ') : 'corporativo · moderno · limpio';
}

function detectTone(text) {
  const value = normalizeText(text);
  if (/\bejecutivo|ejecutiva|gerencia|corporativo|corporativa\b/.test(value)) return 'ejecutivo · directo · profesional';
  if (/\bcalido|calida|cercano|cercana\b/.test(value)) return 'cálido · profesional';
  if (/\btecnico|tecnica\b/.test(value)) return 'técnico · claro · profesional';
  return 'directo · profesional · comercial sin ser agresivo';
}

function detectChannel(text, kind) {
  const value = normalizeText(text);
  if (/\b(correo|email|e-mail)\b/.test(value) && /\b(whatsapp|wasap|wsp)\b/.test(value)) return 'WhatsApp + correo';
  if (/\b(correo|email|e-mail)\b/.test(value)) return 'correo';
  if (/\b(whatsapp|wasap|wsp)\b/.test(value)) return 'WhatsApp';
  if (/\b(reel|instagram|story|stories|estado|facebook|redes)\b/.test(value)) return 'redes / móvil';
  if (/\b(presentacion|pantalla|web)\b/.test(value)) return 'presentación / web';
  return kind === 'video' ? 'móvil / redes / WhatsApp' : 'WhatsApp + correo';
}

function detectStaticFormat(text, channel) {
  const value = normalizeText(text);
  if (/1080\s*[x×]\s*1920|9\s*:\s*16|story|stories|estado/.test(value)) return { size: '1080 × 1920 px', ratio: '9:16', label: 'Story / Estado' };
  if (/1080\s*[x×]\s*1350|4\s*:\s*5|feed vertical/.test(value)) return { size: '1080 × 1350 px', ratio: '4:5', label: 'Feed vertical' };
  if (/1080\s*[x×]\s*1080|1\s*:\s*1|cuadrad/.test(value)) return { size: '1080 × 1080 px', ratio: '1:1', label: 'Cuadrado' };
  if (/1920\s*[x×]\s*1080|16\s*:\s*9|presentacion|pantalla/.test(value)) return { size: '1920 × 1080 px', ratio: '16:9', label: 'Presentación horizontal' };
  if (/\ba4\b/.test(value)) return { size: 'A4 vertical', ratio: 'A4', label: 'Documento' };
  if (channel === 'correo') return { size: 'HTML responsivo', ratio: 'adaptativo', label: 'Correo HTML' };
  return { size: '1080 × 540 px', ratio: '2:1', label: 'WhatsApp · enganche visual' };
}

function detectVideoFormat(text, channel) {
  const value = normalizeText(text);
  if (/1920\s*[x×]\s*1080|16\s*:\s*9|horizontal|presentacion|pantalla|web/.test(value)) return { size: '1920 × 1080 px', ratio: '16:9', orientation: 'horizontal' };
  if (/1080\s*[x×]\s*1080|1\s*:\s*1|cuadrad/.test(value)) return { size: '1080 × 1080 px', ratio: '1:1', orientation: 'cuadrado' };
  if (/1080\s*[x×]\s*1350|4\s*:\s*5|feed/.test(value)) return { size: '1080 × 1350 px', ratio: '4:5', orientation: 'vertical feed' };
  if (/1080\s*[x×]\s*1920|9\s*:\s*16|vertical|reel|story|estado|movil/.test(value)) return { size: '1080 × 1920 px', ratio: '9:16', orientation: 'vertical' };
  if (channel === 'presentación / web') return { size: '1920 × 1080 px', ratio: '16:9', orientation: 'horizontal' };
  return { size: '1080 × 1920 px', ratio: '9:16', orientation: 'vertical móvil' };
}

function detectDuration(text) {
  const value = normalizeText(text);
  const match = value.match(/\b(\d{1,3})\s*(segundos?|seg|s)\b/);
  if (match) return `${match[1]} segundos`;
  if (/\b(reel|story|estado)\b/.test(value)) return '15–20 segundos';
  return '15–30 segundos';
}

function detectHook(text, fallback) {
  const raw = String(text || '');
  const quoted = raw.match(/[“"]([^”"]{6,120})[”"]/);
  if (quoted) return quoted[1].trim();
  return fallback;
}

function buildHtmlBrief(text) {
  const channel = detectChannel(text, 'html');
  const format = detectStaticFormat(text, channel);
  const audience = detectAudience(text);
  const purpose = detectPurpose(text, 'html');
  const service = detectService(text);
  const recipient = detectRecipient(text);
  const style = detectStyle(text);
  const tone = detectTone(text);
  const hook = detectHook(text, 'Crear un título de enganche corto, específico y comercial según la empresa.');

  return [
    'PROMPT TÉCNICO PARA CHATGPT — PLANTILLA HTML ELANVISUAL',
    '',
    'Crea un único archivo .html limpio, reutilizable y listo para guardar como plantilla aprobada en CONNECT.',
    'No incluyas paneles de edición, formularios, selectores, botones administrativos ni instrucciones visibles.',
    '',
    `OBJETIVO: ${purpose} comercial de ELANVISUAL.`,
    `USO: ${audience}.`,
    `CANAL: ${channel}.`,
    'FUENTE MAESTRA: HTML reutilizable.',
    `FORMATO PRINCIPAL: ${format.label}.`,
    `TAMAÑO: ${format.size}.`,
    `RELACIÓN: ${format.ratio}.`,
    `SEGMENTO / SERVICIO: ${service}.`,
    `DESTINATARIO: ${recipient}.`,
    `ESTILO: ${style}.`,
    `TONO: ${tone}.`,
    `TÍTULO / HOOK: ${hook}`,
    '',
    'ELEMENTOS OBLIGATORIOS:',
    '- Logo oficial de ELANVISUAL.',
    '- Espacio condicional para logo oficial validado del prospecto o cliente.',
    '- Nombre de empresa.',
    '- Título de enganche.',
    '- Área o destinatario.',
    '- Personaje ELAN IA cuando la composición lo beneficie.',
    '- Espacio opcional para imagen o render cuando aplique.',
    '- Pie de marca discreto.',
    '',
    'VARIABLES ESTÁNDAR:',
    '{{company_name}}',
    '{{contact_name}}',
    '{{prospect_logo_url}}',
    '{{hook_title}}',
    '{{contact_area}}',
    '{{hero_image_url}}',
    '{{services_text}}',
    '{{services_html}}',
    '{{landing_url}}',
    '{{whatsapp_url}}',
    '{{cta_text}}',
    '',
    'REGLAS DE SALIDA:',
    '- Entregar solamente el archivo HTML final.',
    '- Debe verse correctamente en móvil.',
    '- Mantener la proporción real del formato definido.',
    '- No saturar la pieza con texto.',
    '- El contenido comercial amplio va en el cuerpo del mensaje, no dentro de la pieza visual.',
    '- Para correo: ELAN reutilizará el HTML como contenido de correo cuando el formato sea compatible.',
    '- Para WhatsApp: ELAN personalizará el HTML y lo renderizará como imagen en el tamaño definido.',
    '- No incrustar datos de un cliente específico salvo como valores de ejemplo reemplazables.',
    '',
    'ENTREGA:',
    'Devuelve un solo archivo .html listo para que el Owner lo valide en su móvil y luego lo envíe a ELAN por WhatsApp para almacenarlo como plantilla aprobada.'
  ].join('\n');
}

function buildVideoBrief(text) {
  const channel = detectChannel(text, 'video');
  const format = detectVideoFormat(text, channel);
  const audience = detectAudience(text);
  const purpose = detectPurpose(text, 'video');
  const service = detectService(text);
  const style = detectStyle(text);
  const tone = detectTone(text);
  const duration = detectDuration(text);
  const hook = detectHook(text, 'Abrir con un gancho visual y verbal en los primeros 2–3 segundos.');

  return [
    'BRIEF DE PRODUCCIÓN DE VIDEO — ELANVISUAL',
    '',
    'Este brief es para producción directa por ELAN. No requiere archivo HTML.',
    '',
    `OBJETIVO: ${purpose}.`,
    `USO: ${audience}.`,
    `CANAL: ${channel}.`,
    `FORMATO: ${format.orientation}.`,
    `RESOLUCIÓN: ${format.size}.`,
    `RELACIÓN: ${format.ratio}.`,
    `DURACIÓN OBJETIVO: ${duration}.`,
    'FPS: 30 fps salvo que el material original requiera conservar otra cadencia.',
    `SEGMENTO / SERVICIO: ${service}.`,
    `ESTILO: ${style}.`,
    `TONO: ${tone}.`,
    `GANCHO INICIAL: ${hook}`,
    '',
    'PRODUCCIÓN:',
    '- Analizar primero el material original y conservarlo sin modificaciones destructivas.',
    '- Seleccionar las mejores escenas de la Biblioteca Multimedia.',
    '- Preparar guion breve orientado al objetivo.',
    '- Editar ritmo, cortes, encuadres y transiciones sin sobrecargar.',
    '- Incorporar branding ELANVISUAL.',
    '- Usar logo del prospecto o cliente únicamente si está validado como oficial.',
    '- Incluir personaje ELAN IA solo cuando tenga sentido creativo.',
    '- Generar locución ELAN profesional, natural, segura y en español latino neutro.',
    '- Música únicamente apta para uso comercial y por debajo de la locución.',
    '- Añadir subtítulos cuando mejoren comprensión o reproducción sin audio.',
    '- Cerrar con CTA claro.',
    '',
    'FLUJO:',
    'material original → análisis → guion → selección de escenas → edición → voz ELAN → música → branding → subtítulos → exportación → revisión Owner → aprobado → biblioteca.',
    '',
    'ESTADO:',
    'No publicar ni enviar automáticamente. Preparar para revisión del Owner antes de usarlo comercialmente.'
  ].join('\n');
}

function buildCreativeBrief(text) {
  return detectCreativeKind(text) === 'video' ? buildVideoBrief(text) : buildHtmlBrief(text);
}

module.exports = {
  buildCreativeBrief,
  buildHtmlBrief,
  buildVideoBrief,
  detectAudience,
  detectChannel,
  detectCreativeKind,
  detectDuration,
  detectPurpose,
  detectService,
  detectStaticFormat,
  detectVideoFormat,
  isCreativeBriefRequest,
  normalizeText
};
