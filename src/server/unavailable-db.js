const MESSAGE = 'The database is not configured. Set SUPABASE_URL and '
  + 'SUPABASE_SERVICE_ROLE_KEY in the hosting environment, then redeploy.';

export class DuplicateError extends Error {
  constructor(m) { super(m); this.name = 'DuplicateError'; }
}
export class CapacityError extends Error {
  constructor(m) { super(m); this.name = 'CapacityError'; }
}
export class StorageUnavailableError extends Error {
  constructor(m) { super(m); this.name = 'StorageUnavailableError'; }
}

const unavailable = () => { throw new StorageUnavailableError(MESSAGE); };

export const createRegistration = async () => unavailable();
export const allRegistrations = async () => unavailable();
export const listRegistrations = async () => unavailable();
export const yearThreeRemaining = async () => ({});
export const stats = async (knownEvents = []) => ({
  total: 0, teams: 0,
  byEvent: Object.fromEntries(knownEvents.map(e => [e, 0])),
  updatedAt: new Date().toISOString(), unavailable: true,
});
export const verifyConnection = async () => unavailable();
export const healthCheck = async () => ({ ok: false, latencyMs: 0, error: MESSAGE });
export const deleteRegistration = async () => unavailable();
export const deleteAllRegistrations = async () => unavailable();
export function closeDatabase() {}
export const legacyImported = 0;
