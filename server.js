// AURA 2026 registration API.
//
// Design goals: never lose a registration, never accept a duplicate, never
// crash the process, and stay responsive for both students and organisers.

import http from 'node:http';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import {
  createRegistration, stats, allRegistrations, listRegistrations,
  yearThreeRemaining as readYearThreeRemaining,
  DuplicateError, CapacityError, closeDatabase, legacyImported,
  verifyConnection, healthCheck, STORAGE, configError, configWarning, urlInfo,
  deleteRegistration, deleteAllRegistrations,
} from './src/server/store.js';
import { validateRegistration, ALLOWED_EVENTS, YEAR_THREE_LIMIT } from './src/server/validate.js';
import { buildCsv, buildXlsx, exportFilename } from './src/server/export.js';
import { createSession, verifySession, sessionSecretWarning } from './src/server/session.js';

const PORT = Number(process.env.API_PORT || 1215);
const HOST = process.env.API_HOST || '127.0.0.1';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@123';
const TOTAL_CAPACITY = Number(process.env.TOTAL_CAPACITY || 0);   // 0 = unlimited
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SERVE_STATIC = process.env.SERVE_STATIC !== 'false';
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DIST_DIR = join(process.cwd(), 'dist');

// A crash would take every user down, so log and keep serving instead.
process.on('uncaughtException', error => console.error('[uncaught]', error));
process.on('unhandledRejection', error => console.error('[unhandled]', error));

const listeners = new Set();
const rateBuckets = new Map();

const json = (res, status, body, headers = {}) => {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

const safeEqual = (left, right) => {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
};

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';')
    .map(part => part.trim().split('='))
    .filter(pair => pair.length === 2)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

// Signed cookie, so any instance can verify it without shared memory.
const isAdmin = req => verifySession(cookies(req).aura_admin);

/** Simple in-process rate limit; enough to stop accidental floods and bots. */
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

// Stop the rate-limit and session maps growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (now > bucket.reset) rateBuckets.delete(key);
}, 60_000).unref();

const clientIp = req =>
  (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) {
    try { res.write(frame); } catch { listeners.delete(res); }
  }
}

/** Zeroed counts, used when the database cannot be read. */
const emptyStats = () => ({
  total: 0, teams: 0,
  byEvent: Object.fromEntries(ALLOWED_EVENTS.map(event => [event, 0])),
  updatedAt: new Date().toISOString(),
});

// Short-lived cache: the public counter and SSE stream are read far more
// often than they change, and this keeps read load off the database.
let statsCache = { value: null, at: 0, inflight: null };
const STATS_TTL_MS = Number(process.env.STATS_TTL_MS || 2000);

async function publicStats(force = false) {
  const now = Date.now();
  if (!force && statsCache.value && now - statsCache.at < STATS_TTL_MS) return statsCache.value;
  if (statsCache.inflight) return statsCache.inflight;      // coalesce concurrent callers
  statsCache.inflight = stats(ALLOWED_EVENTS)
    .then(value => { statsCache = { value, at: Date.now(), inflight: null }; return value; })
    .catch(error => {
      statsCache.inflight = null;
      if (statsCache.value) return statsCache.value;         // serve stale rather than fail
      throw error;
    });
  return statsCache.inflight;
}

// Year 3 availability, cached briefly so the public endpoint cannot hammer
// the database. Falls back to the last good value if a read fails.
let yearThreeCache = { value: null, at: 0 };
async function yearThreeRemaining() {
  const now = Date.now();
  if (yearThreeCache.value && now - yearThreeCache.at < 3000) return yearThreeCache.value;
  try {
    const value = await readYearThreeRemaining(YEAR_THREE_LIMIT);
    yearThreeCache = { value, at: now };
    return value;
  } catch {
    return yearThreeCache.value || {};
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/** Serves the built site so one process runs everything in production. */
async function serveStatic(req, res, pathname) {
  if (!SERVE_STATIC) return false;
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const candidates = relative === '' ? ['index.html'] : [relative, 'index.html'];
  for (const candidate of candidates) {
    try {
      const file = join(DIST_DIR, candidate);
      if (!file.startsWith(DIST_DIR)) continue;   // path-traversal guard
      const body = await readFile(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      const cache = candidate.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(body);
      return true;
    } catch { /* try the next candidate */ }
  }
  return false;
}

/** Request handler, exported so serverless hosts can mount it directly. */
export async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return json(res, 400, { error: 'Bad request.' });
  }
  const { pathname } = url;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    });
    return res.end();
  }

  try {
    // ---------- public ----------
    if (req.method === 'GET' && pathname === '/api/health') {
      const probe = await healthCheck();
      let total = null;
      try { total = (await publicStats()).total; } catch { /* reported via probe */ }
      return json(res, probe.ok ? 200 : 503, {
        ok: probe.ok, service: 'aura-api', storage: STORAGE,
        configError: configError || undefined,
        configWarning: configWarning || undefined,
        databaseUrl: urlInfo?.url || undefined,
        database: probe.ok ? 'connected' : 'unreachable',
        databaseLatencyMs: probe.latencyMs ?? null,
        databaseError: probe.error || undefined,
        registrations: total, realtimeClients: listeners.size,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      // The public counter must never take the page down with it. If the
      // database cannot be read, answer with zeroed counts and a flag rather
      // than a 500, so the site still renders and registration stays open.
      let summary;
      let degraded = false;
      try {
        summary = await publicStats();
      } catch (error) {
        console.error('[events] storage failure:', error.message);
        summary = emptyStats();
        degraded = true;
      }
      const yearThree = await yearThreeRemaining();
      const body = {
        ...summary,
        yearThreeLimit: YEAR_THREE_LIMIT,
        yearThreeRemaining: yearThree,
        ...(degraded ? { degraded: true } : {}),
      };
      return json(res, 200, TOTAL_CAPACITY
        ? { ...body, capacity: TOTAL_CAPACITY, remaining: Math.max(0, TOTAL_CAPACITY - summary.total) }
        : body);
    }

    if (req.method === 'GET' && pathname === '/api/live') {
      // Serverless functions cannot hold a stream open, and the dashboard
      // polls anyway, so answer with a single snapshot instead of hanging.
      const snapshot = await publicStats().catch(() => emptyStats());
      if (isServerless) {
        return json(res, 200, { ...snapshot, streaming: false });
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write(`event: dashboard\ndata: ${JSON.stringify(snapshot)}\n\n`);
      listeners.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25_000);
      const drop = () => { clearInterval(ping); listeners.delete(res); };
      req.on('close', drop);
      req.on('error', drop);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/registrations') {
      if (!rateLimit(`reg:${clientIp(req)}`, 10, 60_000)) {
        return json(res, 429, { error: 'Too many attempts. Please wait a minute and try again.' });
      }
      const checked = validateRegistration(await readBody(req));
      if (checked.error) return json(res, 400, { error: checked.error });

      let registration;
      try {
        registration = await createRegistration(checked.value, { total: TOTAL_CAPACITY || undefined, yearThree: YEAR_THREE_LIMIT });
      } catch (error) {
        if (error instanceof DuplicateError) return json(res, 409, { error: error.message });
        if (error instanceof CapacityError) return json(res, 409, { error: error.message });
        // Database unreachable: tell the student honestly and log for the organiser.
        console.error('[registration] storage failure:', error.message);
        return json(res, 503, {
          error: 'We could not save your registration just now. Please try again in a moment.',
        });
      }

      // The row is already committed; a failed stats refresh must not turn a
      // successful registration into an error for the student.
      const dashboard = await publicStats(true).catch(() => emptyStats());
      broadcast('registration', { event: registration.event, createdAt: registration.createdAt });
      broadcast('dashboard', dashboard);
      return json(res, 201, { ok: true, registration: { id: registration.id, event: registration.event }, dashboard });
    }

    // ---------- admin ----------
    if (req.method === 'POST' && pathname === '/api/admin/pin') {
      if (!rateLimit(`pin:${clientIp(req)}`, 8, 15 * 60_000)) {
        return json(res, 429, { error: 'Too many attempts. Try again later.' });
      }
      const { pin = '' } = await readBody(req);
      return safeEqual(pin, ADMIN_PIN) ? json(res, 200, { ok: true }) : json(res, 401, { error: 'Invalid PIN.' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      if (!rateLimit(`login:${clientIp(req)}`, 8, 15 * 60_000)) {
        return json(res, 429, { error: 'Too many attempts. Try again later.' });
      }
      const { username = '', password = '' } = await readBody(req);
      const ok = safeEqual(username, ADMIN_USER) & safeEqual(password, ADMIN_PASSWORD);
      if (!ok) return json(res, 401, { error: 'Invalid administrator credentials.' });
      const session = createSession();
      const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
      return json(res, 200, { ok: true }, {
        'Set-Cookie': `aura_admin=${session.value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${session.maxAgeSeconds}`,
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'aura_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (pathname.startsWith('/api/admin/') && !isAdmin(req)) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    if (req.method === 'GET' && pathname === '/api/admin/registrations') {
      const result = await listRegistrations({
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
        query: url.searchParams.get('q') || '',
      });
      return json(res, 200, { ...result, dashboard: await publicStats() });
    }

    // Delete every registration. Checked before the single-row route below so
    // "/api/admin/registrations" (no id) always means "the whole table".
    if (req.method === 'DELETE' && pathname === '/api/admin/registrations') {
      let removed;
      try {
        removed = await deleteAllRegistrations();
      } catch (error) {
        console.error('[admin] delete-all failure:', error.message);
        return json(res, 503, { error: 'Could not clear the database. Try again shortly.' });
      }
      const dashboard = await publicStats(true).catch(() => emptyStats());
      broadcast('dashboard', dashboard);
      return json(res, 200, { ok: true, removed, dashboard });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/registrations/')) {
      const id = decodeURIComponent(pathname.slice('/api/admin/registrations/'.length));
      if (!id) return json(res, 400, { error: 'Missing registration id.' });
      let removed;
      try {
        removed = await deleteRegistration(id);
      } catch (error) {
        console.error('[admin] delete failure:', error.message);
        return json(res, 503, { error: 'Could not delete that registration. Try again shortly.' });
      }
      if (!removed) return json(res, 404, { error: 'Registration not found.' });
      const dashboard = await publicStats(true).catch(() => emptyStats());
      broadcast('dashboard', dashboard);
      return json(res, 200, { ok: true, dashboard });
    }

    if (req.method === 'GET' && (pathname === '/api/admin/analytics' || pathname === '/api/admin/report')) {
      const summary = await publicStats();
      if (pathname === '/api/admin/analytics') return json(res, 200, summary);
      return json(res, 200, {
        ...summary,
        recommendations: Object.entries(summary.byEvent)
          .filter(([, count]) => count === 0)
          .map(([event]) => `Promote ${event}: no registrations yet.`),
      });
    }

    if (req.method === 'GET' && pathname === '/api/admin/export') {
      let rows;
      try { rows = await allRegistrations(); }
      catch (error) {
        console.error('[export] storage failure:', error.message);
        return json(res, 503, { error: 'Could not read the database for the export. Try again shortly.' });
      }
      const format = (url.searchParams.get('format') || 'xlsx').toLowerCase();
      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFilename('csv')}"`,
          'Cache-Control': 'no-store',
        });
        return res.end(buildCsv(rows));
      }
      const workbook = buildXlsx(rows);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exportFilename('xlsx')}"`,
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store',
      });
      return res.end(workbook);
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

    if (await serveStatic(req, res, pathname)) return;
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[request]', req.method, pathname, error?.message);
    const message = /too large|Invalid JSON/i.test(error?.message || '') ? error.message : 'Server error.';
    return json(res, /too large|Invalid JSON/i.test(error?.message || '') ? 400 : 500, { error: message });
  }
}

const server = http.createServer(handler);

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

if (!isServerless) server.listen(PORT, HOST, async () => {
  if (legacyImported) console.log(`Imported ${legacyImported} registration(s) from the old JSON file.`);
  if (STORAGE === 'supabase') {
    if (configWarning) {
      console.warn('');
      console.warn(`  [config] ${configWarning}`);
      console.warn('');
    }
    try {
      await verifyConnection();
      console.log(`Storage: Supabase (permanent cloud database) — connected (${urlInfo?.url || ''}).`);
    } catch (error) {
      console.error('');
      console.error('  Supabase is configured but UNREACHABLE:');
      console.error(`  ${error.message}`);
      console.error('');
      console.error('  Checklist:');
      console.error('   1. supabase-schema.sql has been run in the SQL Editor');
      console.error('   2. SUPABASE_URL is the Project URL (https://<ref>.supabase.co)');
      console.error('   3. SUPABASE_SERVICE_ROLE_KEY is the service_role secret, not the publishable key');
      console.error('   4. The project is not paused in the Supabase dashboard');
      console.error('');
      if (process.env.NODE_ENV === 'production' || process.env.REQUIRE_SUPABASE === 'true') {
        console.error('  Refusing to serve in production without a working database.');
        process.exit(1);
      }
      console.error('  Continuing anyway because this is not production.');
    }
  } else {
    console.log('Storage: local SQLite file (data/aura.db) — DEVELOPMENT ONLY, not persistent.');
  }
  console.log(`Aura API running on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down.`);
  for (const res of listeners) { try { res.end(); } catch { /* ignore */ } }
  server.close(() => { closeDatabase(); process.exit(0); });
  setTimeout(() => { closeDatabase(); process.exit(0); }, 5000).unref();
}
if (!isServerless) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
