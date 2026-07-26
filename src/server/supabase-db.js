// Supabase (Postgres) storage adapter.
//
// Exposes the same interface as db.js so server.js, the MCP agent and the
// export script work unchanged.
//
// All calls go through PostgREST with the service role key, which stays on the
// server and never reaches the browser. Writes retry with exponential backoff
// so a transient network blip does not lose a student's registration.

// Accept the plain project URL, and also tolerate someone pasting the Data API
// endpoint (…/rest/v1/) that the dashboard shows.
const URL_BASE = (process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const TABLE = 'registrations';
const REQUEST_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 12_000);
const MAX_RETRIES = Number(process.env.SUPABASE_MAX_RETRIES || 3);

// Keep-alive connection pool: without this every request pays a fresh TLS
// handshake, which is the difference between coping with a rush and timing out.
// Node ships undici internally; use the package if present, else rely on
// Node's built-in fetch, which already pools connections per origin.
try {
  const undici = await import('undici');
  undici.setGlobalDispatcher(new undici.Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: Number(process.env.SUPABASE_POOL || 64),
  }));
} catch {
  // undici not installed as a package: Node's built-in fetch already pools
  // connections per origin, which is sufficient.
}

export class DuplicateError extends Error {
  constructor(message) { super(message); this.name = 'DuplicateError'; }
}
export class CapacityError extends Error {
  constructor(message) { super(message); this.name = 'CapacityError'; }
}
export class StorageUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'StorageUnavailableError'; }
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A duplicate or rule violation must never be retried — it will never succeed. */
function classify(status, parsed, text) {
  const message = parsed.message || parsed.hint || text || '';
  if (parsed.code === '23505' || /duplicate key|uniq_event_/i.test(message)) {
    return new DuplicateError('This email or phone number is already registered for that event.');
  }
  if (/Registration is closed/i.test(message)) return new CapacityError(message);
  if (/not eligible/i.test(message)) return new CapacityError(message);
  if (status === 401 || status === 403) {
    return new StorageUnavailableError('Database rejected our credentials. Check SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (status === 404 && /relation|function/i.test(message)) {
    return new StorageUnavailableError('Database schema missing. Run supabase-schema.sql in the SQL Editor.');
  }
  const error = new Error(message || `Supabase error ${status}`);
  error.status = status;
  error.code = parsed.code;
  return error;
}

/**
 * fetch with timeout and exponential backoff.
 * Retries only on network errors and 5xx / 429 — never on a definitive answer.
 */
async function request(path, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${URL_BASE}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: controller.signal,
      });

      if (response.ok) return response.status === 204 ? null : response.json();

      const text = await response.text();
      let parsed = {};
      try { parsed = JSON.parse(text); } catch { /* plain text */ }
      const error = classify(response.status, parsed, text);

      // Definitive answers propagate immediately.
      if (error instanceof DuplicateError || error instanceof CapacityError) throw error;
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable || attempt === MAX_RETRIES) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof DuplicateError || error instanceof CapacityError) throw error;
      if (error instanceof StorageUnavailableError) throw error;
      lastError = error;
      if (attempt === MAX_RETRIES) break;
    } finally {
      clearTimeout(timer);
    }
    await sleep(Math.min(2000, 200 * 2 ** attempt) + Math.random() * 100);
  }
  throw new StorageUnavailableError(
    `Could not reach the database after ${MAX_RETRIES + 1} attempts: ${lastError?.message || 'unknown error'}`);
}

const fromRow = row => row && ({
  id: row.id,
  event: row.event,
  choice: row.choice ?? null,
  teamName: row.team_name ?? null,
  name: row.name,
  department: row.department,
  year: row.year,
  partnerName: row.partner_name ?? null,
  partnerDepartment: row.partner_department ?? null,
  partnerYear: row.partner_year ?? null,
  phone: row.phone,
  email: row.email,
  createdAt: row.created_at,
});

const SELECT = 'id,event,choice,team_name,name,department,year,partner_name,partner_department,partner_year,phone,email,created_at';

export async function createRegistration(value, limits = {}) {
  const row = await request('/rest/v1/rpc/create_registration', {
    method: 'POST',
    body: JSON.stringify({ payload: value, total_capacity: limits.total || 0 }),
  });
  return fromRow(Array.isArray(row) ? row[0] : row);
}

export async function stats(knownEvents = []) {
  const result = await request('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
  const data = Array.isArray(result) ? result[0] : result;
  const byEvent = Object.fromEntries(knownEvents.map(event => [event, 0]));
  for (const [event, count] of Object.entries(data?.byEvent || {})) byEvent[event] = Number(count);
  return {
    total: Number(data?.total || 0),
    teams: Number(data?.teams || 0),
    byEvent,
    updatedAt: new Date().toISOString(),
  };
}

/** Every row, paged so large exports stay complete past PostgREST's limit. */
export async function allRegistrations() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(
      `/rest/v1/${TABLE}?select=${SELECT}&order=created_at.desc&limit=${pageSize}&offset=${offset}`);
    rows.push(...page.map(fromRow));
    if (page.length < pageSize) break;
    if (rows.length > 100_000) break;   // safety valve
  }
  return rows;
}

export async function listRegistrations({ page = 1, pageSize = 50, query = '' } = {}) {
  const size = Math.min(Math.max(1, Number(pageSize) || 50), 500);
  const current = Math.max(1, Number(page) || 1);
  const from = (current - 1) * size;
  const term = String(query || '').trim();

  let filter = '';
  if (term) {
    // Neutralise PostgREST's or() syntax characters before interpolating.
    const safe = term.replace(/[(),*"\\]/g, ' ').trim();
    if (safe) {
      const like = `*${safe}*`;
      filter = '&or=(' + [
        `name.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`,
        `department.ilike.${like}`, `team_name.ilike.${like}`,
        `partner_name.ilike.${like}`, `event.ilike.${like}`,
      ].join(',') + ')';
    }
  }

  const path = `/rest/v1/${TABLE}?select=${SELECT}${filter}&order=created_at.desc&limit=${size}&offset=${from}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${URL_BASE}${path}`, {
      headers: { ...headers, Prefer: 'count=exact' },
      signal: controller.signal,
    });
    if (!response.ok) throw new StorageUnavailableError(await response.text());
    const rows = (await response.json()).map(fromRow);
    const total = Number((response.headers.get('content-range') || '').split('/')[1] || rows.length);
    return { rows, total, page: current, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Verifies credentials and that the schema has been applied. */
export async function verifyConnection() {
  if (!URL_BASE) throw new StorageUnavailableError('SUPABASE_URL is empty.');
  if (!SERVICE_KEY) throw new StorageUnavailableError('SUPABASE_SERVICE_ROLE_KEY is empty.');
  await request('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
  // Confirm the table itself is reachable, not just the RPC.
  await request(`/rest/v1/${TABLE}?select=id&limit=1`);
}

export async function healthCheck() {
  const started = Date.now();
  try {
    await request('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error.message };
  }
}

export function closeDatabase() { /* stateless HTTP client */ }
export const legacyImported = 0;
