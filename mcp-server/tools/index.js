// Tools exposed to the local AI agent over MCP.
//
// The agent reads the same SQLite database the API writes to, so it always
// sees live data. Exports are written to exports/ as real .xlsx files.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { allRegistrations, listRegistrations, stats, STORAGE } from '../../src/server/store.js';
import { ALLOWED_EVENTS } from '../../src/server/validate.js';
import { validateRegistration } from '../../src/server/validate.js';
import { buildXlsx, buildCsv, exportFilename } from '../../src/server/export.js';
import { DAYS, EVENTS } from '../../src/schedule.js';

const EXPORT_DIR = process.env.EXPORT_DIR || join(process.cwd(), 'exports');

const summary = () => stats(ALLOWED_EVENTS);   // async

const catalogue = () => EVENTS.map(event => ({
  name: event.name,
  registrationName: event.registrationName,
  category: event.category,
  day: event.day,
  date: event.dateLong,
  time: event.time,
  venue: event.venue,
  team: event.team,
  rules: event.rules,
}));

/** Writes the full registration list to exports/ and returns the file path. */
async function writeExport(format = 'xlsx') {
  const rows = await allRegistrations();
  mkdirSync(EXPORT_DIR, { recursive: true });
  const filename = exportFilename(format === 'csv' ? 'csv' : 'xlsx');
  const path = join(EXPORT_DIR, filename);
  writeFileSync(path, format === 'csv' ? buildCsv(rows) : buildXlsx(rows));
  return { path, filename, rows: rows.length, format: format === 'csv' ? 'csv' : 'xlsx' };
}

async function localChat(prompt) {
  const base = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false,
      messages: [
        { role: 'system', content: 'You assist AURA 2026 organisers. Be concise and never expose private participant contact details unless explicitly asked by the organiser.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error('Local Ollama model is unavailable. Start Ollama or set OLLAMA_URL.');
  return (await response.json()).message?.content;
}

export async function execute(name, args = {}) {
  switch (name) {
    case 'chat':
      return { answer: await localChat(args.prompt || '') };

    case 'list_registrations': {
      const result = await listRegistrations({ page: args.page, pageSize: args.pageSize, query: args.query });
      return result;
    }

    case 'export_excel': {
      const result = await writeExport(args.format);
      return { ...result, message: `Wrote ${result.rows} registration(s) to ${result.path}` };
    }

    case 'database_query':
      return args.query === 'registrations' ? await allRegistrations() : await summary();

    case 'event_management':
      return { days: DAYS, events: catalogue() };

    case 'registration_validation': {
      const checked = validateRegistration(args.registration || {});
      return checked.error ? { valid: false, error: checked.error } : { valid: true, value: checked.value };
    }

    case 'analytics':
    case 'live_dashboard':
      return summary();

    case 'admin_commands': {
      const data = await summary();
      if (args.command === 'health') return { ok: true, storage: STORAGE, registrations: data.total };
      return {
        ...data,
        recommendations: Object.entries(data.byEvent)
          .filter(([, count]) => count === 0)
          .map(([event]) => `Promote ${event}: no registrations yet.`),
      };
    }

    case 'report_generation': {
      const data = await summary();
      const busiest = Object.entries(data.byEvent).sort((a, b) => b[1] - a[1])[0];
      return {
        title: 'AURA 2026 live registration report',
        ...data,
        busiestEvent: busiest ? { event: busiest[0], count: busiest[1] } : null,
        events: catalogue(),
      };
    }

    case 'search': {
      const result = await listRegistrations({ query: args.query || '', pageSize: 100 });
      return { matches: result.total, registrations: result.rows };
    }

    case 'image_understanding':
      return { ready: false, message: 'Image understanding is reserved for a local vision model integration.' };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
