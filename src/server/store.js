// Chooses the storage backend.
//
//   Supabase (permanent cloud Postgres)  <- required in production
//   local SQLite file                    <- development convenience only
//
// Both modules export the same interface, so nothing else in the codebase
// needs to know which one is in use.

import { resolveSupabaseUrl, redactSecrets } from './supabase-url.js';

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// On serverless, process.exit() kills the invocation and the browser sees an
// opaque platform error. Record the misconfiguration so the API can return a
// readable message instead.
export let configError = null;
const fail = message => {
  configError = message;
  console.error(`[storage] ${message}`);
  if (!isServerless) process.exit(1);
};

const isProduction = process.env.NODE_ENV === 'production' || process.env.REQUIRE_SUPABASE === 'true';
const allowLocalFallback = process.env.ALLOW_SQLITE_FALLBACK === 'true';

if (!hasSupabase && isProduction && !allowLocalFallback) {
  fail('No cloud database configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
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
}

// Surfaced on /api/health as a warning: the site still works, but somebody
// should tidy up the configuration.
export let configWarning = null;

if (hasSupabase) {
  const resolved = resolveSupabaseUrl(process.env.SUPABASE_URL);

  // Only give up when nothing usable could be derived. A connection string or
  // a db.<ref> host still contains the project ref, so we correct it and carry
  // on rather than taking the whole site down over a copy-paste slip.
  if (resolved.error) {
    fail(resolved.error);
  } else if (resolved.warning) {
    configWarning = resolved.warning;
    console.warn(`[storage] ${redactSecrets(resolved.warning)}`);
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  // The publishable/anon key cannot write past RLS, so catch that mix-up early.
  if (key.startsWith('sb_publishable_') || key.startsWith('sbp_')) {
    fail('SUPABASE_SERVICE_ROLE_KEY looks like a PUBLISHABLE key. Use the service_role secret: Project Settings -> API -> Reveal.');
  }
}

const backend = hasSupabase
  ? await import('./supabase-db.js')
  : (isServerless ? await import('./unavailable-db.js') : await import('./db.js'));

export const STORAGE = hasSupabase ? 'supabase' : 'sqlite';

export const {
  createRegistration, stats, allRegistrations, listRegistrations,
  yearThreeRemaining, DuplicateError, CapacityError, closeDatabase, legacyImported,
  deleteRegistration, clearAllRegistrations,
} = backend;

export const verifyConnection = backend.verifyConnection || (async () => {});
export const healthCheck = backend.healthCheck || (async () => ({ ok: true }));

/** How SUPABASE_URL was interpreted, for start-up logging and /api/health. */
export const urlInfo = backend.urlInfo || null;
