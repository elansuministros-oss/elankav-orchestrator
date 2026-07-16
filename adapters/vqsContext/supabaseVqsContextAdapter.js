const DEFAULT_TABLES = Object.freeze({
  customers: 'clientes',
  designs: 'design_requests',
  storeProducts: 'productos_registrados',
  projects: 'elankav_projects',
  quotations: 'elankav_quotations'
});
const SIGNED_URL_TTL_SECONDS = 3600;
const VISUAL_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizePhone(value, countryCode = '505') {
  const raw = digits(value);
  if (!raw) return '';
  if (raw.length === 8) return `+${countryCode}${raw}`;
  if (raw.startsWith(countryCode) && raw.length === countryCode.length + 8) return `+${raw}`;
  return `+${raw}`;
}

function phoneMatches(value, query) {
  const left = digits(value);
  const right = digits(query);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function textMatches(value, query) {
  const left = normalizeText(value);
  const right = normalizeText(query);
  return Boolean(left && right && left.includes(right));
}

function first(row, keys, fallback = '') {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return fallback;
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function normalizeAsset(asset = {}) {
  return {
    kind: String(asset.kind || ''),
    name: String(asset.name || ''),
    bucket: String(asset.bucket || ''),
    path: String(asset.path || ''),
    mimeType: normalizeMimeType(asset.mimeType || asset.type),
    sizeBytes: Number(asset.sizeBytes || asset.size_bytes || 0) || 0
  };
}

function assetKey(asset = {}) {
  if (asset.bucket && asset.path) return `${asset.bucket}\u0000${asset.path}`;
  return [
    'asset',
    asset.kind,
    asset.name,
    asset.mimeType,
    asset.sizeBytes
  ].join('\u0000');
}

function collectVisualAssets(row = {}) {
  const seen = new Set();
  const entries = [
    ...Array.isArray(row.result_files) ? row.result_files : [],
    ...Array.isArray(row.files) ? row.files : []
  ];

  return entries
    .map((entry, index) => ({ asset: normalizeAsset(entry), index }))
    .filter(({ asset }) => VISUAL_MIME_TYPES.has(asset.mimeType))
    .filter(({ asset }) => {
      const key = assetKey(asset);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftPriority = left.asset.kind === 'generated-render' ? 0 : 1;
      const rightPriority = right.asset.kind === 'generated-render' ? 0 : 1;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ asset }) => asset);
}

function signedUrlOf(result = {}) {
  return String(
    result?.data?.signedUrl ||
    result?.data?.signedURL ||
    result?.data?.signed_url ||
    ''
  ).trim();
}

class SupabaseVqsContextAdapter {
  constructor({ supabase, tables = {}, maxRows = 250, logger = console } = {}) {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('SupabaseVqsContextAdapter requiere un cliente Supabase válido');
    }
    this.supabase = supabase;
    this.tables = { ...DEFAULT_TABLES, ...tables };
    this.maxRows = maxRows;
    this.logger = logger;
  }

  async listRows(table, orderColumn = 'created_at') {
    let result = await this.supabase.from(table).select('*').order(orderColumn, { ascending: false }).limit(this.maxRows);
    if (result?.error) {
      result = await this.supabase.from(table).select('*').limit(this.maxRows);
    }
    if (result?.error) return [];
    return Array.isArray(result?.data) ? result.data : [];
  }

  async searchCustomers(query) {
    const rows = await this.listRows(this.tables.customers);
    return rows.filter((row) =>
      phoneMatches(first(row, ['whatsapp', 'telefono', 'phone', 'celular']), query) ||
      ['cliente', 'nombre', 'contacto', 'empresa', 'correo', 'email', 'ruc', 'codigo'].some((key) => textMatches(row?.[key], query))
    ).map((row) => ({
      type: 'customer',
      sourceId: String(first(row, ['id', 'customer_id', 'codigo'])),
      label: String(first(row, ['empresa', 'cliente', 'nombre', 'contacto'], 'Cliente')),
      customer: {
        customerId: String(first(row, ['id', 'customer_id', 'codigo'])),
        name: String(first(row, ['nombre', 'cliente', 'contacto'])),
        companyName: String(first(row, ['empresa', 'business_name'])),
        phone: normalizePhone(first(row, ['whatsapp', 'telefono', 'phone', 'celular'])),
        email: String(first(row, ['correo', 'email'])),
        address: String(first(row, ['direccion', 'address', 'ciudad']))
      },
      source: { type: 'customer', sourceId: String(first(row, ['id', 'customer_id', 'codigo'])) },
      raw: row
    }));
  }

  async searchDesigns(query) {
    const rows = await this.listRows(this.tables.designs);
    const matches = rows.filter((row) =>
      phoneMatches(first(row, ['whatsapp', 'phone', 'telefono']), query) ||
      ['request_code', 'customer_name', 'business_name', 'request_type', 'design_notes'].some((key) => textMatches(row?.[key], query))
    );

    return Promise.all(matches.map(async (row) => {
      const id = String(first(row, ['id', 'design_request_id', 'request_code']));
      const code = String(first(row, ['request_code', 'code'], id));
      const images = await this.resolveDesignAssets(row);
      const primaryImage = images.find((asset) => asset.kind === 'generated-render' && asset.signedUrl)
        || images.find((asset) => asset.signedUrl)
        || null;

      return {
        type: 'design',
        sourceId: id,
        label: `${code} · ${first(row, ['business_name', 'customer_name', 'request_type'], 'Diseño')}`,
        customer: {
          customerId: '',
          name: String(first(row, ['customer_name', 'name'])),
          companyName: String(first(row, ['business_name', 'company_name'])),
          phone: normalizePhone(first(row, ['whatsapp', 'phone', 'telefono'])),
          email: String(first(row, ['email', 'correo'])),
          address: String(first(row, ['address', 'direccion']))
        },
        project: {
          title: String(first(row, ['request_type', 'title'], `Diseño ${code}`)),
          installationEnvironment: String(first(row, ['installation_environment', 'environment'])),
          widthCm: Number(first(row, ['width_cm', 'width'], 0)) || 0,
          heightCm: Number(first(row, ['height_cm', 'height'], 0)) || 0,
          notes: String(first(row, ['design_notes', 'notes']))
        },
        items: [{
          itemId: id,
          productId: '',
          designId: id,
          title: String(first(row, ['request_type', 'title'], 'Diseño solicitado')),
          description: String(first(row, ['design_notes', 'notes'])),
          quantity: 1,
          unit: 'unidad',
          unitPriceUsd: 0,
          imageUrl: primaryImage?.signedUrl || '',
          images,
          features: [first(row, ['installation_environment']), first(row, ['width_cm']) && `${row.width_cm} cm ancho`, first(row, ['height_cm']) && `${row.height_cm} cm alto`].filter(Boolean)
        }],
        source: { type: 'design', sourceId: id, designRequestId: id, requestCode: code },
        raw: row
      };
    }));
  }

  async resolveDesignAssets(row) {
    const assets = collectVisualAssets(row);
    return Promise.all(assets.map((asset) => this.resolveDesignAsset(asset)));
  }

  async resolveDesignAsset(asset) {
    if (!asset.bucket || !asset.path) return asset;

    try {
      const bucket = this.supabase.storage?.from?.(asset.bucket);
      if (!bucket || typeof bucket.createSignedUrl !== 'function') {
        throw new Error('SUPABASE_STORAGE_SIGNER_UNAVAILABLE');
      }

      const result = await bucket.createSignedUrl(asset.path, SIGNED_URL_TTL_SECONDS);
      const signedUrl = signedUrlOf(result);
      if (result?.error || !signedUrl) {
        this.logAssetSigningFailure(asset, result?.error);
        return asset;
      }

      return { ...asset, signedUrl };
    } catch (error) {
      this.logAssetSigningFailure(asset, error);
      return asset;
    }
  }

  logAssetSigningFailure(asset, error) {
    this.logger?.warn?.('[VQS_CONTEXT_ASSET_SIGN_ERROR]', {
      code: String(error?.code || 'ASSET_SIGN_FAILED').slice(0, 80),
      kind: asset.kind,
      bucket: asset.bucket,
      path: asset.path
    });
  }

  async searchStoreProducts(query) {
    const rows = await this.listRows(this.tables.storeProducts);
    return rows.filter((row) =>
      ['codigo', 'nombre', 'titulo', 'categoria', 'descripcion'].some((key) => textMatches(row?.[key], query))
    ).map((row) => {
      const id = String(first(row, ['id', 'product_id', 'codigo']));
      const title = String(first(row, ['nombre', 'titulo', 'descripcion'], 'Producto'));
      const price = Number(first(row, ['precio_total_usd', 'precio', 'price'], 0)) || 0;
      return {
        type: 'store',
        sourceId: id,
        label: `${first(row, ['codigo'], id)} · ${title}`,
        customer: null,
        project: { title },
        items: [{
          itemId: id,
          productId: id,
          designId: '',
          title,
          description: String(first(row, ['descripcion', 'description'])),
          quantity: 1,
          unit: 'unidad',
          unitPriceUsd: price,
          imageUrl: String(first(row, ['imagen_url', 'image_url', 'imagen'])),
          images: [],
          features: [first(row, ['categoria']), first(row, ['ancho_m']) && `${row.ancho_m} m ancho`, first(row, ['largo_m']) && `${row.largo_m} m largo`].filter(Boolean)
        }],
        source: { type: 'store', sourceId: id, storeProductId: id },
        raw: row
      };
    });
  }

  async search(query, { types = ['customer', 'design', 'store'], limit = 30 } = {}) {
    const tasks = [];
    if (types.includes('customer')) tasks.push(this.searchCustomers(query));
    if (types.includes('design')) tasks.push(this.searchDesigns(query));
    if (types.includes('store')) tasks.push(this.searchStoreProducts(query));
    const groups = await Promise.all(tasks);
    return groups.flat().slice(0, limit);
  }
}

module.exports = {
  SupabaseVqsContextAdapter,
  normalizeText,
  normalizePhone,
  phoneMatches,
  collectVisualAssets,
  DEFAULT_TABLES
};
