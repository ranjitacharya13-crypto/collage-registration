// Supabase (Postgres) storage adapter.
//
// Exposes the same interface as db.js so server.js, the MCP agent and the
// export script work unchanged. Selected automatically by src/server/store.js
// when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
//
// All calls go through PostgREST with the service role key, which stays on the
// server and never reaches the browser.

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = 'registrations';
const REQUEST_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 10_000);

export class DuplicateError extends Error {
  constructor(message) { super(message); this.name = 'DuplicateError'; }
}
export class CapacityError extends Error {
  constructor(message) { super(message); this.name = 'CapacityError'; }
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/** fetch with a timeout and one retry, so a blip does not fail a registration. */
async function request(path, options = {}, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${URL_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* plain text error */ }
      const error = new Error(parsed.message || parsed.hint || body || `Supabase error ${response.status}`);
      error.status = response.status;
      error.code = parsed.code;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  } catch (error) {
    // Retry once on a network/timeout error, never on a real HTTP error.
    const retryable = !error.status && attempt === 0;
    if (retryable) return request(path, options, attempt + 1);
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  let row;
  try {
    row = await request('/rest/v1/rpc/create_registration', {
      method: 'POST',
      body: JSON.stringify({ payload: value, total_capacity: limits.total || 0 }),
    });
  } catch (error) {
    const message = String(error.message || '');
    if (error.code === '23505' || /duplicate key|uniq_event_/i.test(message)) {
      throw new DuplicateError('This email or phone number is already registered for that event.');
    }
    if (/Registration is closed/i.test(message)) throw new CapacityError(message);
    if (/not eligible/i.test(message)) throw new CapacityError(message);
    throw error;
  }
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

/** Every row, paged through PostgREST's limit so large exports stay complete. */
export async function allRegistrations() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(
      `/rest/v1/${TABLE}?select=${SELECT}&order=created_at.desc&limit=${pageSize}&offset=${offset}`);
    rows.push(...page.map(fromRow));
    if (page.length < pageSize) break;
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
    // Escape PostgREST's or() syntax characters before interpolating.
    const safe = term.replace(/[(),*]/g, ' ').trim();
    const like = `*${safe}*`;
    filter = '&or=(' + [
      `name.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`,
      `department.ilike.${like}`, `team_name.ilike.${like}`,
      `partner_name.ilike.${like}`, `event.ilike.${like}`,
    ].join(',') + ')';
  }

  const response = await fetch(
    `${URL_BASE}/rest/v1/${TABLE}?select=${SELECT}${filter}&order=created_at.desc&limit=${size}&offset=${from}`,
    { headers: { ...headers, Prefer: 'count=exact', Range: `${from}-${from + size - 1}` } });

  if (!response.ok) throw new Error(await response.text());
  const rows = (await response.json()).map(fromRow);
  const total = Number((response.headers.get('content-range') || '').split('/')[1] || rows.length);

  return { rows, total, page: current, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
}

/** Verifies credentials and that the schema has been applied. */
export async function verifyConnection() {
  await request('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
}

export function closeDatabase() { /* stateless HTTP client */ }
export const legacyImported = 0;
