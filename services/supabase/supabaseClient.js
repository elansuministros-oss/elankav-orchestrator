const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
let singleton = null;

class SupabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseConfigurationError';
    this.code = 'SUPABASE_CONFIGURATION_ERROR';
  }
}

function requireConfiguration(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !String(env[key] || '').trim());
  if (missing.length) {
    throw new SupabaseConfigurationError(`Falta configuración requerida: ${missing.join(', ')}`);
  }
  return {
    url: String(env.SUPABASE_URL).replace(/\/$/, ''),
    serviceRoleKey: String(env.SUPABASE_SERVICE_ROLE_KEY)
  };
}

function encodeFilter(value) {
  if (value === null) return 'null';
  return encodeURIComponent(String(value));
}

class PostgrestQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.method = 'GET';
    this.body = undefined;
    this.params = new URLSearchParams();
    this.headers = {};
    this.allowMissing = false;
  }

  insert(row) {
    this.method = 'POST';
    this.body = row;
    this.headers.Prefer = 'return=representation';
    return this;
  }

  update(patch) {
    this.method = 'PATCH';
    this.body = patch;
    this.headers.Prefer = 'return=representation';
    return this;
  }

  upsert(row, { onConflict } = {}) {
    this.method = 'POST';
    this.body = row;
    this.headers.Prefer = 'return=representation,resolution=merge-duplicates';
    if (onConflict) this.params.set('on_conflict', onConflict);
    return this;
  }

  select(columns = '*') {
    this.params.set('select', columns);
    return this;
  }

  eq(column, value) {
    this.params.set(column, `eq.${encodeFilter(value)}`);
    return this;
  }

  is(column, value) {
    this.params.set(column, `is.${encodeFilter(value)}`);
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.params.set('order', `${column}.${ascending ? 'asc' : 'desc'}`);
    return this;
  }

  limit(value) {
    this.params.set('limit', String(value));
    return this;
  }

  single() {
    this.headers.Accept = 'application/vnd.pgrst.object+json';
    return this.execute();
  }

  maybeSingle() {
    this.allowMissing = true;
    this.headers.Accept = 'application/vnd.pgrst.object+json';
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const query = this.params.toString();
    const response = await this.client.fetchImpl(
      `${this.client.url}/rest/v1/${encodeURIComponent(this.table)}${query ? `?${query}` : ''}`,
      {
        method: this.method,
        headers: {
          apikey: this.client.serviceRoleKey,
          Authorization: `Bearer ${this.client.serviceRoleKey}`,
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: this.body === undefined ? undefined : JSON.stringify(this.body)
      }
    );

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      if (this.allowMissing && response.status === 406) return { data: null, error: null };
      return {
        data: null,
        error: {
          message: data?.message || data?.error || `Supabase respondió ${response.status}`,
          code: data?.code || String(response.status),
          details: data?.details || null,
          hint: data?.hint || null
        }
      };
    }
    return { data, error: null };
  }
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

function normalizeStorageSignedUrl(baseUrl, value = '') {
  const signedUrl = String(value || '').trim();
  if (!signedUrl) return '';
  try {
    const url = new URL(signedUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') return signedUrl;
  } catch {
    // Supabase Storage can return a path relative to /storage/v1.
  }
  return signedUrl.startsWith('/') ? `${baseUrl}/storage/v1${signedUrl}` : '';
}

class StorageBucketClient {
  constructor(client, bucket) {
    this.client = client;
    this.bucket = String(bucket || '');
  }

  async createSignedUrl(path, expiresIn) {
    const objectPath = String(path || '');
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    const response = await this.client.fetchImpl(
      `${this.client.url}/storage/v1/object/sign/${encodeURIComponent(this.bucket)}/${encodedPath}`,
      {
        method: 'POST',
        headers: {
          apikey: this.client.serviceRoleKey,
          Authorization: `Bearer ${this.client.serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn: Number(expiresIn || 3600) })
      }
    );
    const data = parseJson(await response.text());
    const signedUrl = normalizeStorageSignedUrl(
      this.client.url,
      data?.signedUrl || data?.signedURL || data?.signed_url || ''
    );

    if (!response.ok || !signedUrl) {
      return {
        data: null,
        error: {
          code: String(data?.code || response.status || 'STORAGE_SIGN_FAILED'),
          status: response.status
        }
      };
    }

    return { data: { signedUrl }, error: null };
  }
}

class StorageClient {
  constructor(client) {
    this.client = client;
  }

  from(bucket) {
    return new StorageBucketClient(this.client, bucket);
  }
}

class SupabaseRestClient {
  constructor({ url, serviceRoleKey, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') throw new Error('Este entorno requiere fetch nativo');
    this.url = url;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
    this.storage = new StorageClient(this);
  }

  from(table) {
    return new PostgrestQuery(this, table);
  }
}

function getSupabaseClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (singleton) return singleton;
  singleton = new SupabaseRestClient({ ...requireConfiguration(env), fetchImpl });
  return singleton;
}

function resetSupabaseClientForTests() {
  singleton = null;
}

module.exports = {
  getSupabaseClient,
  resetSupabaseClientForTests,
  SupabaseConfigurationError,
  SupabaseRestClient
};
