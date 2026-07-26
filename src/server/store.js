// Chooses the storage backend.
//
//   Supabase (permanent cloud Postgres)  <- required in production
//   local SQLite file                    <- development convenience only
//
// Both modules export the same interface, so nothing else in the codebase
// needs to know which one is in use.
//
// In production a missing Supabase configuration is a hard failure. Silently
// falling back to a local file would mean registrations are written to a disk
// that disappears on the next deploy, which is worse than not starting at all.

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const isProduction = process.env.NODE_ENV === 'production' || process.env.REQUIRE_SUPABASE === 'true';
const allowLocalFallback = process.env.ALLOW_SQLITE_FALLBACK === 'true';

if (!hasSupabase && isProduction && !allowLocalFallback) {
  console.error(`
┌──────────────────────────────────────────────────────────────────┐
│  REFUSING TO START: no cloud database configured                 │
├──────────────────────────────────────────────────────────────────┤
│  This is production, so registrations must go to Supabase.       │
│  A local SQLite file would be lost on the next deploy.           │
│                                                                  │
│  Set both of these in your environment (or .env):                │
│    SUPABASE_URL=https://<your-project>.supabase.co               │
│    SUPABASE_SERVICE_ROLE_KEY=<service_role secret key>           │
│                                                                  │
│  Find them at: Supabase dashboard -> Project Settings -> API     │
│  Run supabase-schema.sql once in the SQL Editor first.           │
│                                                                  │
│  To override deliberately (data will NOT persist):               │
│    ALLOW_SQLITE_FALLBACK=true                                    │
└──────────────────────────────────────────────────────────────────┘
`);
  process.exit(1);
}

if (hasSupabase) {
  const url = process.env.SUPABASE_URL.trim()
    .replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
  if (/^postgres(ql)?:\/\//i.test(url)) {
    console.error('[storage] SUPABASE_URL is a database connection string, not the API URL.');
    console.error('[storage] Use the Project URL: https://<project-ref>.supabase.co');
    process.exit(1);
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    console.warn(`[storage] SUPABASE_URL does not look like a project URL: ${url}`);
    console.warn('[storage] Expected https://<project-ref>.supabase.co — not the database connection string.');
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  // The publishable/anon key cannot write past RLS, so catch that mix-up early.
  if (key.startsWith('sb_publishable_') || key.startsWith('sbp_')) {
    console.error('[storage] SUPABASE_SERVICE_ROLE_KEY looks like a PUBLISHABLE key.');
    console.error('[storage] Use the service_role (secret) key: Project Settings -> API -> Reveal.');
    process.exit(1);
  }
}

const backend = hasSupabase
  ? await import('./supabase-db.js')
  : await import('./db.js');

export const STORAGE = hasSupabase ? 'supabase' : 'sqlite';

export const {
  createRegistration, stats, allRegistrations, listRegistrations,
  yearThreeRemaining, DuplicateError, CapacityError, closeDatabase, legacyImported,
} = backend;

export const verifyConnection = backend.verifyConnection || (async () => {});
export const healthCheck = backend.healthCheck || (async () => ({ ok: true }));
