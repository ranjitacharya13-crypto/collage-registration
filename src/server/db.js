// SQLite storage for AURA 2026 registrations.
//
// Why SQLite rather than the previous JSON file: the JSON approach did
// read-modify-write on every request, so two students submitting at the same
// moment could overwrite each other and a crash mid-write could truncate the
// file. SQLite gives us atomic transactions, real UNIQUE constraints (so
// duplicates are impossible even under concurrency) and crash safety via WAL.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'aura.db');
const LEGACY_JSON = join(DATA_DIR, 'registrations.json');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL lets readers (the admin dashboard) run while a write is in flight, and
// survives an unclean shutdown. NORMAL sync is the right durability/speed
// trade-off for WAL. busy_timeout makes concurrent writers wait instead of
// failing instantly.
db.exec(`
  pragma journal_mode = WAL;
  pragma synchronous = NORMAL;
  pragma busy_timeout = 5000;
  pragma foreign_keys = ON;
`);

db.exec(`
  create table if not exists registrations (
    id                 text primary key,
    event              text not null,
    choice             text,
    team_name          text,
    name               text not null,
    department         text not null,
    year               text not null,
    partner_name       text,
    partner_department text,
    partner_year       text,
    phone              text not null,
    email              text not null,
    email_key          text not null,
    phone_key          text not null,
    created_at         text not null
  );

  -- Duplicate protection enforced by the database, not by application code,
  -- so it holds even when two requests arrive simultaneously.
  create unique index if not exists uniq_event_email on registrations (event, email_key);
  create unique index if not exists uniq_event_phone on registrations (event, phone_key);

  create index if not exists idx_event      on registrations (event);
  create index if not exists idx_created_at on registrations (created_at);
`);

const columns = `id, event, choice, team_name AS teamName, name, department, year,
  partner_name AS partnerName, partner_department AS partnerDepartment,
  partner_year AS partnerYear, phone, email, created_at AS createdAt`;

const statements = {
  insert: db.prepare(`
    insert into registrations (id, event, choice, team_name, name, department, year,
      partner_name, partner_department, partner_year, phone, email, email_key, phone_key, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  total: db.prepare('select count(*) as count from registrations'),
  byEvent: db.prepare('select event, count(*) as count from registrations group by event'),
  teams: db.prepare("select count(*) as count from registrations where team_name is not null and team_name != ''"),
  countForEvent: db.prepare('select count(*) as count from registrations where event = ?'),
  all: db.prepare(`select ${columns} from registrations order by created_at desc`),
  page: db.prepare(`select ${columns} from registrations order by created_at desc limit ? offset ?`),
  search: db.prepare(`select ${columns} from registrations
    where name like ?1 or email like ?1 or phone like ?1 or department like ?1
       or ifnull(team_name,'') like ?1 or ifnull(partner_name,'') like ?1 or event like ?1
    order by created_at desc limit ?2 offset ?3`),
  searchCount: db.prepare(`select count(*) as count from registrations
    where name like ?1 or email like ?1 or phone like ?1 or department like ?1
       or ifnull(team_name,'') like ?1 or ifnull(partner_name,'') like ?1 or event like ?1`),
};

/** One-time import of the old data/registrations.json file, if present. */
function migrateLegacyJson() {
  if (!existsSync(LEGACY_JSON)) return 0;
  let rows = [];
  try {
    rows = JSON.parse(readFileSync(LEGACY_JSON, 'utf8'));
  } catch {
    return 0; // Corrupt legacy file: leave it alone rather than crash on boot.
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let imported = 0;
  db.exec('begin');
  try {
    for (const row of rows) {
      try {
        insertRow({
          id: row.id || crypto.randomUUID(),
          event: row.event,
          choice: row.choice ?? null,
          teamName: row.teamName ?? null,
          name: row.name,
          department: row.department,
          year: String(row.year ?? ''),
          partnerName: row.partnerName ?? null,
          partnerDepartment: row.partnerDepartment ?? null,
          partnerYear: row.partnerYear ?? null,
          phone: row.phone,
          email: row.email,
          createdAt: row.createdAt || new Date().toISOString(),
        });
        imported += 1;
      } catch {
        // Skip rows that violate the new constraints (duplicates, bad shape).
      }
    }
    db.exec('commit');
  } catch {
    db.exec('rollback');
    return 0;
  }
  renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
  return imported;
}

const normaliseEmail = value => String(value || '').trim().toLowerCase();
const normalisePhone = value => String(value || '').replace(/[^\d]/g, '').slice(-10);

function insertRow(row) {
  statements.insert.run(
    row.id, row.event, row.choice, row.teamName, row.name, row.department, row.year,
    row.partnerName, row.partnerDepartment, row.partnerYear, row.phone, row.email,
    normaliseEmail(row.email), normalisePhone(row.phone), row.createdAt
  );
}

export class DuplicateError extends Error {
  constructor(message) { super(message); this.name = 'DuplicateError'; }
}
export class CapacityError extends Error {
  constructor(message) { super(message); this.name = 'CapacityError'; }
}

/**
 * Inserts a registration atomically.
 * Capacity is checked inside the same transaction as the insert, so the last
 * seat cannot be handed to two people at once.
 */
export function createRegistration(value, limits = {}) {
  const record = {
    id: crypto.randomUUID(),
    ...value,
    choice: value.choice ?? null,
    teamName: value.teamName || null,
    partnerName: value.partnerName ?? null,
    partnerDepartment: value.partnerDepartment ?? null,
    partnerYear: value.partnerYear ?? null,
    createdAt: new Date().toISOString(),
  };

  db.exec('begin immediate');
  try {
    if (limits.total && statements.total.get().count >= limits.total) {
      throw new CapacityError(`Registration is closed. All ${limits.total} places are filled.`);
    }
    const perEvent = limits.perEvent?.[record.event];
    if (perEvent && statements.countForEvent.get(record.event).count >= perEvent) {
      throw new CapacityError(`${record.event} is full (${perEvent} places).`);
    }
    insertRow(record);
    db.exec('commit');
  } catch (error) {
    db.exec('rollback');
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      throw new DuplicateError('This email or phone number is already registered for that event.');
    }
    throw error;
  }
  return record;
}

export function stats(knownEvents = []) {
  const byEvent = Object.fromEntries(knownEvents.map(event => [event, 0]));
  for (const row of statements.byEvent.all()) byEvent[row.event] = row.count;
  return {
    total: statements.total.get().count,
    teams: statements.teams.get().count,
    byEvent,
    updatedAt: new Date().toISOString(),
  };
}

export const allRegistrations = () => statements.all.all();

/** Paginated + searchable listing for the admin dashboard. */
export function listRegistrations({ page = 1, pageSize = 50, query = '' } = {}) {
  const size = Math.min(Math.max(1, Number(pageSize) || 50), 500);
  const current = Math.max(1, Number(page) || 1);
  const offset = (current - 1) * size;
  const term = String(query || '').trim();

  const rows = term
    ? statements.search.all(`%${term}%`, size, offset)
    : statements.page.all(size, offset);
  const total = term ? statements.searchCount.get(`%${term}%`).count : statements.total.get().count;

  return { rows, total, page: current, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
}

export function closeDatabase() {
  try { db.exec('pragma wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  try { db.close(); } catch { /* already closed */ }
}

export const legacyImported = migrateLegacyJson();
