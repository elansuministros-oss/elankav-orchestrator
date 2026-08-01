'use strict';

const crypto = require('node:crypto');
const { getSupabaseClient } = require('./supabase/supabaseClient');

const COMMERCIAL_STATE_TABLE = 'commercial_conversation_states';
const DEFAULT_TTL_HOURS = 24;

function normalizeText(value) {
  return String(value || '').trim();
}

function hashPhone(phone) {
  const normalized = normalizeText(phone).replace(/[^\d+]/g, '');
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function resolveExpiresAt(now = new Date(), ttlHours = DEFAULT_TTL_HOURS) {
  return new Date(now.getTime() + (ttlHours * 60 * 60 * 1000)).toISOString();
}

class MemoryCommercialStateRepository {
  constructor({ ttlHours = DEFAULT_TTL_HOURS } = {}) {
    this.ttlHours = ttlHours;
    this.rows = new Map();
  }

  async get(key) {
    const row = this.rows.get(key);
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      this.rows.delete(key);
      return null;
    }
    return row.state_json || null;
  }

  async save(key, state, identity = {}) {
    const row = {
      conversation_key: key,
      platform: normalizeText(identity.platform || state?.platform || 'ELANVISUAL'),
      channel: normalizeText(identity.channel || 'whatsapp').toLowerCase(),
      external_user_id: normalizeText(identity.externalUserId) || null,
      phone_hash: hashPhone(identity.phone),
      active_item_id: state?.activeItemId || null,
      state_json: state,
      updated_at: new Date().toISOString(),
      expires_at: resolveExpiresAt(new Date(), this.ttlHours)
    };
    this.rows.set(key, row);
    return row.state_json;
  }

  async clear(key) {
    this.rows.delete(key);
  }
}

class SupabaseCommercialStateRepository {
  constructor({ client = null, ttlHours = DEFAULT_TTL_HOURS } = {}) {
    this.client = client;
    this.ttlHours = ttlHours;
  }

  resolveClient() {
    return this.client || getSupabaseClient();
  }

  async get(key) {
    const { data, error } = await this.resolveClient()
      .from(COMMERCIAL_STATE_TABLE)
      .select('state_json,expires_at')
      .eq('conversation_key', key)
      .maybeSingle();

    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    if (!data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.state_json || null;
  }

  async save(key, state, identity = {}) {
    const row = {
      conversation_key: key,
      platform: normalizeText(identity.platform || state?.platform || 'ELANVISUAL'),
      channel: normalizeText(identity.channel || 'whatsapp').toLowerCase(),
      external_user_id: normalizeText(identity.externalUserId) || null,
      phone_hash: hashPhone(identity.phone),
      active_item_id: state?.activeItemId || null,
      state_json: state,
      updated_at: new Date().toISOString(),
      expires_at: resolveExpiresAt(new Date(), this.ttlHours)
    };
    const { data, error } = await this.resolveClient()
      .from(COMMERCIAL_STATE_TABLE)
      .upsert(row, { onConflict: 'conversation_key' })
      .select('state_json')
      .maybeSingle();

    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data?.state_json || state;
  }

  async clear(key) {
    const { error } = await this.resolveClient()
      .from(COMMERCIAL_STATE_TABLE)
      .update({ expires_at: new Date(0).toISOString() })
      .eq('conversation_key', key)
      .maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
  }
}

function createCommercialStateRepository(env = process.env) {
  const configured = normalizeText(env.COMMERCIAL_STATE_REPOSITORY).toLowerCase();
  if (configured === 'supabase') return new SupabaseCommercialStateRepository();
  return new MemoryCommercialStateRepository();
}

module.exports = {
  COMMERCIAL_STATE_TABLE,
  DEFAULT_TTL_HOURS,
  MemoryCommercialStateRepository,
  SupabaseCommercialStateRepository,
  createCommercialStateRepository,
  hashPhone,
  resolveExpiresAt
};
