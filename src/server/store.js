// Chooses the storage backend.
//
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set  ->  Supabase (permanent, cloud)
//   otherwise                                     ->  local SQLite file
//
// Both modules export the same functions, so nothing else in the codebase
// needs to know which one is in use.

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const backend = useSupabase
  ? await import('./supabase-db.js')
  : await import('./db.js');

export const STORAGE = useSupabase ? 'supabase' : 'sqlite';

export const {
  createRegistration, stats, allRegistrations, listRegistrations,
  DuplicateError, CapacityError, closeDatabase, legacyImported,
} = backend;

// Only the Supabase adapter can check connectivity up front.
export const verifyConnection = backend.verifyConnection || (async () => {});
