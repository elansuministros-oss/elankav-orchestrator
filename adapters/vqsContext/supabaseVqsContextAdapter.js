const DEFAULT_TABLES = Object.freeze({
  customers: 'clientes',
  designs: 'design_requests',
  storeProducts: 'productos_registrados',
  projects: 'elankav_projects',
  quotations: 'elankav_quotations'
});

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

class SupabaseVqsContextAdapter {
  constructor({ supabase, tables = {}, maxRows = 250 } = {}) {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('SupabaseVqsContextAdapter requiere un cliente Supabase válido');
    }
    this.supabase = supabase;
    this.tables = { ...DEFAULT_TABLES, ...tables };
    this.maxRows = maxRows;
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
    return rows.filter((row) =>
      phoneMatches(first(row, ['whatsapp', 'phone', 'telefono']), query) ||
      ['request_code', 'customer_name', 'business_name', 'request_type', 'design_notes'].some((key) => textMatches(row?.[key], query))
    ).map((row) => {
      const id = String(first(row, ['id', 'design_request_id', 'request_code']));
      const code = String(first(row, ['request_code', 'code'], id));
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
          imageUrl: '',
          images: Array.isArray(row.files) ? row.files : [],
          features: [first(row, ['installation_environment']), first(row, ['width_cm']) && `${row.width_cm} cm ancho`, first(row, ['height_cm']) && `${row.height_cm} cm alto`].filter(Boolean)
        }],
        source: { type: 'design', sourceId: id, designRequestId: id, requestCode: code },
        raw: row
      };
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
  DEFAULT_TABLES
};