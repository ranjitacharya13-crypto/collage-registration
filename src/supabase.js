const SUPABASE_URL = 'https://tsxbhobkbfmsiqnywqeo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2YUnQksbnWI5BPASS51Ivg_rcHphc9h';
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Supabase request failed.');
  return response.status === 204 ? null : response.json();
}

export async function yearThreeSlots(event) {
  const result = await request('/rest/v1/rpc/year_three_slots', { method: 'POST', body: JSON.stringify({ event_name: event }) });
  return result === null ? null : Number(result);
}

export async function registrationSlotsRemaining() {
  const result = await request('/rest/v1/rpc/registration_slots_remaining', { method: 'POST', body: '{}' });
  return Number(result);
}

export async function registerStudent(registration) {
  await request('/rest/v1/registrations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(registration) });
}
