import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.API_PORT || 1215);
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@123';
const dbDir = join(process.cwd(), 'data');
const dbFile = join(dbDir, 'registrations.json');
const sessions = new Map();
const listeners = new Set();
const allowedEvents = new Set(['Bug Hunt', 'Treasure Hunt', 'Fuzzy Brain', 'Flush the Brain', 'Murder Mystery', 'Debate']);

const send = (res, status, body, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }).end(JSON.stringify(body));
const equal = (left, right) => { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && timingSafeEqual(a, b); };
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function records() { try { return JSON.parse(await readFile(dbFile, 'utf8')); } catch { return []; } }
async function save(data) { await mkdir(dbDir, { recursive: true }); await writeFile(dbFile, JSON.stringify(data, null, 2)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2)); }
function admin(req) { const token = cookies(req).aura_admin; return Boolean(token && sessions.get(token)?.authenticated); }
async function body(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100_000) throw new Error('Request too large'); } return JSON.parse(text || '{}'); }
function broadcast(type, payload) { const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`; for (const res of listeners) res.write(event); }
function stats(rows) { const byEvent = Object.fromEntries([...allowedEvents].map(event => [event, 0])); rows.forEach(row => { byEvent[row.event] = (byEvent[row.event] || 0) + 1; }); return { total: rows.length, teams: rows.filter(r => r.teamName).length, byEvent, updatedAt: new Date().toISOString() }; }
function validate(input) {
  const event = String(input.event || '').trim(); const name = String(input.name || '').trim(); const department = String(input.department || '').trim(); const year = String(input.year || '').trim(); const phone = String(input.phone || '').replace(/\s|-/g, ''); const email = String(input.email || '').trim().toLowerCase();
  if (!allowedEvents.has(event)) return { error: 'Select a valid event.' };
  if (name.length < 2 || name.length > 100 || department.length < 2 || department.length > 100) return { error: 'Name and department must be between 2 and 100 characters.' };
  if (!['1', '2', '3'].includes(year)) return { error: 'Select a valid year.' };
  if (!/^\+?[0-9]{10,15}$/.test(phone)) return { error: 'Enter a valid phone number.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  return { value: { event, name, department, year, phone, email, teamName: String(input.teamName || '').trim() } };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type' }).end();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'aura-api', realtimeClients: listeners.size });
    if (req.method === 'GET' && url.pathname === '/api/events') { const all = await records(); return send(res, 200, stats(all)); }
    if (req.method === 'GET' && url.pathname === '/api/live') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }); res.write(`event: dashboard\ndata: ${JSON.stringify(stats(await records()))}\n\n`); listeners.add(res); req.on('close', () => listeners.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/registrations') {
      const checked = validate(await body(req)); if (checked.error) return send(res, 400, { error: checked.error });
      const all = await records(); const duplicate = all.find(row => row.event === checked.value.event && (row.email === checked.value.email || row.phone === checked.value.phone));
      if (duplicate) return send(res, 409, { error: 'A registration for this event already uses that email or phone number.' });
      const registration = { id: randomUUID(), ...checked.value, createdAt: new Date().toISOString() }; all.push(registration); await save(all); const dashboard = stats(all); broadcast('registration', registration); broadcast('dashboard', dashboard); return send(res, 201, { ok: true, registration, dashboard });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/pin') { const { pin = '' } = await body(req); return equal(pin, ADMIN_PIN) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Invalid PIN.' }); }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') { const { username = '', password = '' } = await body(req); if (!equal(username, ADMIN_USER) || !equal(password, ADMIN_PASSWORD)) return send(res, 401, { error: 'Invalid administrator credentials.' }); const token = randomUUID(); sessions.set(token, { authenticated: true }); return send(res, 200, { ok: true }, { 'Set-Cookie': `aura_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` }); }
    if (req.method === 'GET' && url.pathname === '/api/admin/registrations') { if (!admin(req)) return send(res, 401, { error: 'Unauthorized' }); const all = await records(); return send(res, 200, { registrations: all, dashboard: stats(all) }); }
    if (req.method === 'GET' && url.pathname === '/api/admin/analytics') { if (!admin(req)) return send(res, 401, { error: 'Unauthorized' }); return send(res, 200, stats(await records())); }
    if (req.method === 'GET' && url.pathname === '/api/admin/report') { if (!admin(req)) return send(res, 401, { error: 'Unauthorized' }); const report = stats(await records()); return send(res, 200, { ...report, recommendations: Object.entries(report.byEvent).filter(([, count]) => count === 0).map(([event]) => `Promote ${event}: no registrations yet.`) }); }
    if (req.method === 'GET' && url.pathname === '/api/admin/export') { if (!admin(req)) return send(res, 401, { error: 'Unauthorized' }); const rows = await records(); const columns = ['id', 'event', 'teamName', 'name', 'department', 'year', 'phone', 'email', 'createdAt']; const csv = [columns.join(','), ...rows.map(row => columns.map(c => `"${String(row[c] || '').replaceAll('"', '""')}"`).join(','))].join('\n'); return res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="aura-2026-registrations.csv"' }).end(csv); }
    return send(res, 404, { error: 'Not found' });
  } catch (error) { return send(res, 500, { error: error.message || 'Server error.' }); }
}).listen(PORT, () => console.log(`Aura API running on http://localhost:${PORT}`));
