import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dbFile = join(process.cwd(), 'data', 'registrations.json');
const events = [
  { name: 'Bug Hunt', day: 'Day 1', venue: 'Main Lab', duration: '45 minutes', rounds: ['Written: C ', 'Programming figure-out'] },
  { name: 'Treasure Hunt', day: 'Day 1', venue: 'N/A', duration: '1 hour', rounds: ['Hidden clue papers', 'Library article and book search'] },
  { name: 'Fuzzy Brain', day: 'Day 1', venue: 'Visa Hall', duration: 'TBA', rounds: ['Three-image guessing', 'Movie, song and place clues'] },
  { name: 'Murder Mystery', day: 'Day 2', venue: 'Visa Hall', duration: 'TBA', rounds: ['Projected scenario', 'Critical-thinking finale'] },
  { name: 'Debate', day: 'Day 2', venue: '3rd Classroom', duration: 'TBA', rounds: ['Android vs iOS'] }
];
async function registrations() { try { return JSON.parse(await readFile(dbFile, 'utf8')); } catch { return []; } }
function dashboard(rows) { const byEvent = Object.fromEntries(events.map(event => [event.name, 0])); rows.forEach(row => byEvent[row.event] = (byEvent[row.event] || 0) + 1); return { participants: rows.length, teams: rows.filter(row => row.teamName).length, byEvent, generatedAt: new Date().toISOString() }; }
async function localChat(prompt) { const base = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'; const model = process.env.OLLAMA_MODEL || 'llama3.2'; const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: 'You assist AURA 2026 organisers. Be concise and never expose private registration data.' }, { role: 'user', content: prompt }] }) }); if (!response.ok) throw new Error('Local Ollama model is unavailable. Start Ollama or set OLLAMA_URL.'); return (await response.json()).message?.content; }
export async function execute(name, args) {
  const rows = await registrations(); const data = dashboard(rows);
  if (name === 'chat') return { answer: await localChat(args.prompt || '') };
  if (name === 'database_query') return args.query === 'registrations' ? rows : data;
  if (name === 'event_management') return events;
  if (name === 'registration_validation') { const r = args.registration || {}; return { valid: Boolean(r.name && /^\S+@\S+\.\S+$/.test(r.email || '') && /^\+?\d{10,15}$/.test(String(r.phone || '').replace(/[ -]/g, ''))), checks: ['name', 'email', 'phone'] }; }
  if (name === 'analytics' || name === 'live_dashboard') return data;
  if (name === 'admin_commands') return args.command === 'health' ? { ok: true, storage: 'local-json', registrations: rows.length } : { ...data, recommendations: events.filter(event => !data.byEvent[event.name]).map(event => `Promote ${event.name}.`) };
  if (name === 'report_generation') return { title: 'AURA 2026 live report', ...data, events };
  if (name === 'search') { const q = String(args.query || '').toLowerCase(); return { events: events.filter(e => JSON.stringify(e).toLowerCase().includes(q)), registrations: rows.filter(r => `${r.name} ${r.event} ${r.department}`.toLowerCase().includes(q)).map(({ name, event, department }) => ({ name, event, department })) }; }
  if (name === 'image_understanding') return { ready: false, message: 'Image understanding is reserved for a local vision model integration.' };
  throw new Error(`Unknown tool: ${name}`);
}
