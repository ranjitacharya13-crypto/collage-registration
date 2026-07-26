// SUPABASE_URL is the single most-copied-wrong value in the whole setup, and
// getting it wrong used to take the live API down with a 500 on every request
// while printing the database password into a public health endpoint.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseUrl, redactSecrets } from '../src/server/supabase-url.js';

const REF = 'tsxbhobkbfmsiqnywqeo';
const API = `https://${REF}.supabase.co`;

describe('resolveSupabaseUrl', () => {
  test('accepts the correct project URL unchanged', () => {
    const out = resolveSupabaseUrl(API);
    assert.equal(out.url, API);
    assert.equal(out.warning, null);
    assert.equal(out.error, null);
  });

  test('strips a trailing slash and the /rest/v1 suffix', () => {
    assert.equal(resolveSupabaseUrl(`${API}/`).url, API);
    assert.equal(resolveSupabaseUrl(`${API}/rest/v1`).url, API);
    assert.equal(resolveSupabaseUrl(`${API}/rest/v1/`).url, API);
  });

  test('recovers the API URL from a direct connection string', () => {
    const out = resolveSupabaseUrl(`postgresql://postgres:R@njit_1215@db.${REF}.supabase.co:5432/postgres`);
    assert.equal(out.url, API);
    assert.equal(out.ref, REF);
    assert.equal(out.derivedFrom, 'connection-string');
    assert.equal(out.error, null);
    assert.match(out.warning, /connection string/i);
  });

  test('recovers the API URL from a pooled connection string', () => {
    const out = resolveSupabaseUrl(`postgresql://postgres.${REF}:secretpw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`);
    assert.equal(out.url, API);
    assert.equal(out.ref, REF);
  });

  test('never leaks the database password in the warning', () => {
    const out = resolveSupabaseUrl(`postgresql://postgres:R@njit_1215@db.${REF}.supabase.co:5432/postgres`);
    assert.ok(!out.warning.includes('R@njit_1215'), 'password must not appear in the warning');
    assert.ok(!out.url.includes('R@njit_1215'), 'password must not appear in the URL');
  });

  test('corrects the database host to the API host', () => {
    const out = resolveSupabaseUrl(`https://db.${REF}.supabase.co`);
    assert.equal(out.url, API);
    assert.equal(out.derivedFrom, 'db-host');
  });

  test('accepts a bare hostname and a bare project ref', () => {
    assert.equal(resolveSupabaseUrl(`${REF}.supabase.co`).url, API);
    assert.equal(resolveSupabaseUrl(REF).url, API);
  });

  test('upgrades http to https for a remote host', () => {
    assert.equal(resolveSupabaseUrl(`http://${REF}.supabase.co`).url, API);
  });

  test('leaves a local mock server alone, so tests still work', () => {
    const out = resolveSupabaseUrl('http://127.0.0.1:54321');
    assert.equal(out.url, 'http://127.0.0.1:54321');
    assert.equal(out.error, null);
    assert.equal(out.warning, null);
  });

  test('returns an empty result for an empty value', () => {
    assert.equal(resolveSupabaseUrl('').url, '');
    assert.equal(resolveSupabaseUrl(undefined).url, '');
  });

  test('reports an error only when nothing usable can be derived', () => {
    assert.ok(resolveSupabaseUrl('not a url at all').error);
    assert.ok(resolveSupabaseUrl('postgresql://user:pw@example.com:5432/db').error);
  });
});

describe('redactSecrets', () => {
  test('masks a password inside a connection string', () => {
    const out = redactSecrets(`postgresql://postgres:R@njit_1215@db.${REF}.supabase.co:5432/postgres`);
    assert.ok(!out.includes('R@njit_1215'));
    assert.match(out, /postgres:\*\*\*@/);
  });

  test('masks service role keys and JWTs', () => {
    assert.ok(!redactSecrets('key sb_secret_abcdef123456').includes('abcdef123456'));
    assert.ok(!redactSecrets('eyJhbGciOiJIUzI1NiJ9.payloadpart.signaturepart').includes('payloadpart'));
    assert.match(redactSecrets('Authorization: Bearer abc.def.ghi'), /Bearer \*\*\*/);
  });

  test('masks the configured service role key wherever it appears', () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-value-123';
    try {
      assert.ok(!redactSecrets('failed with super-secret-value-123').includes('super-secret-value-123'));
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
    }
  });

  test('leaves ordinary text untouched', () => {
    assert.equal(redactSecrets('Could not reach the database'), 'Could not reach the database');
  });
});
