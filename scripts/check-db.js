#!/usr/bin/env node
// Pre-flight check:  npm run check-db
// Verifies the Supabase configuration end to end before you publish.

const pass = message => console.log(`  \x1b[32mPASS\x1b[0m  ${message}`);
const fail = message => console.log(`  \x1b[31mFAIL\x1b[0m  ${message}`);
const info = message => console.log(`        ${message}`);

console.log('\nAURA 2026 — database pre-flight check\n');

const url = (process.env.SUPABASE_URL || '').trim()
  .replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
let failures = 0;

// 1. Variables present
if (!url || !key) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set');
  info('Add them to .env, then run this again.');
  info('Supabase dashboard -> Project Settings -> API');
  process.exit(1);
}
pass('Supabase environment variables are set');

// 2. URL shape
if (/^postgres(ql)?:\/\//i.test(url)) {
  fail('SUPABASE_URL is a database connection string, not the API URL');
  info('Use the "Project URL": https://<project-ref>.supabase.co');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
  fail(`SUPABASE_URL does not look right: ${url}`);
  info('Expected https://<project-ref>.supabase.co');
  failures += 1;
} else {
  pass(`Project URL looks valid (${url})`);
}

// 3. Key type
if (key.startsWith('sb_publishable_') || key.startsWith('sbp_')) {
  fail('That is the PUBLISHABLE key — it cannot write past Row Level Security');
  info('Use the service_role (secret) key: Project Settings -> API -> Reveal');
  process.exit(1);
}
if (key.startsWith('eyJ') || key.startsWith('sb_secret_')) {
  pass('Key looks like a service_role secret');
} else {
  fail('Key format not recognised; continuing anyway');
  failures += 1;
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const call = async (path, options = {}) => {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { /* plain text */ }
  return { status: response.status, ok: response.ok, body: parsed, text, headers: response.headers };
};

try {
  // 4. Reachable + authenticated
  const table = await call('/rest/v1/registrations?select=id&limit=1');
  if (table.status === 401 || table.status === 403) {
    fail('Database rejected the key (401/403)');
    info('The service_role key is wrong or has been rotated.');
    process.exit(1);
  }
  if (table.status === 404) {
    fail('Table "registrations" does not exist');
    info('Run supabase-schema.sql in the Supabase SQL Editor, then retry.');
    process.exit(1);
  }
  if (!table.ok) {
    fail(`Unexpected response ${table.status}: ${table.text.slice(0, 200)}`);
    process.exit(1);
  }
  pass('Connected and the registrations table exists');

  // 4b. Column shape — an older table can exist but be missing new columns.
  const probe = await call('/rest/v1/registrations?select=choice,team_name,partner_name,partner_department,partner_year&limit=1');
  if (!probe.ok) {
    fail('The registrations table is from an older version (missing columns)');
    info(probe.body.message || probe.text.slice(0, 160));
    info('Run the updated supabase-schema.sql — it migrates the existing table.');
    process.exit(1);
  }
  pass('Table has all the columns this version needs');

  // 5. Required functions
  const statsCall = await call('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
  if (!statsCall.ok) {
    fail('Function registration_stats() is missing');
    info('The SQL script did not finish. Supabase rolls back the whole script');
    info('when any statement fails, so no functions were created.');
    info('Run the updated supabase-schema.sql (it handles an existing table),');
    info('and read the error shown in the SQL Editor if it fails again.');
    process.exit(1);
  }
  pass('Function registration_stats() is present');

  // 6. Insert path, using a throwaway row that is removed afterwards
  const marker = `preflight-${Date.now()}@example.invalid`;
  const insert = await call('/rest/v1/rpc/create_registration', {
    method: 'POST',
    body: JSON.stringify({
      payload: {
        event: 'Bug Hunt', name: 'Preflight Check', department: 'QA', year: '1',
        phone: `9${String(Date.now()).slice(-9)}`, email: marker,
      },
      total_capacity: 0,
    }),
  });
  if (!insert.ok) {
    fail('Function create_registration() failed');
    info(insert.body.message || insert.text.slice(0, 200));
    info('Re-run supabase-schema.sql in the SQL Editor.');
    process.exit(1);
  }
  pass('Function create_registration() works — a test row was written');

  // 7. Duplicate protection
  const duplicate = await call('/rest/v1/rpc/create_registration', {
    method: 'POST',
    body: JSON.stringify({
      payload: {
        event: 'Bug Hunt', name: 'Preflight Duplicate', department: 'QA', year: '1',
        phone: `9${String(Date.now()).slice(-9)}`, email: marker,
      },
      total_capacity: 0,
    }),
  });
  if (duplicate.ok) {
    fail('Duplicate protection is NOT active — the same email was accepted twice');
    info('The unique indexes are missing. Re-run supabase-schema.sql.');
    failures += 1;
  } else {
    pass('Duplicate protection is active');
  }

  // 8. Tidy up
  const cleanup = await call(`/rest/v1/registrations?email=eq.${encodeURIComponent(marker)}`, { method: 'DELETE' });
  if (cleanup.ok || cleanup.status === 204) pass('Test rows removed');
  else info(`Could not remove test rows automatically; delete ${marker} manually.`);

  // 9. Current contents
  const summary = await call('/rest/v1/rpc/registration_stats', { method: 'POST', body: '{}' });
  const data = Array.isArray(summary.body) ? summary.body[0] : summary.body;
  info(`Registrations currently stored: ${data?.total ?? 0}`);
} catch (error) {
  fail(`Could not reach Supabase: ${error.message}`);
  info('Check your internet connection and that the project is not paused.');
  process.exit(1);
}

console.log(failures === 0
  ? '\n\x1b[32mAll checks passed — safe to publish.\x1b[0m\n'
  : `\n\x1b[33m${failures} warning(s) above. Review before publishing.\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
