// Tests the Supabase adapter against a PostgREST mock that reproduces the
// real schema's constraints. Covers the failure modes that matter on the day:
// duplicates under concurrency, transient outages, and capacity limits.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockSupabase } from './helpers/mock-supabase.mjs';

const mock = await startMockSupabase();
process.env.SUPABASE_URL = mock.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_key';
process.env.SUPABASE_MAX_RETRIES = '3';

const {
  createRegistration, stats, listRegistrations, allRegistrations,
  DuplicateError, CapacityError, StorageUnavailableError, verifyConnection, healthCheck,
  deleteRegistration, deleteAllRegistrations,
} = await import('../src/server/supabase-db.js');

after(() => mock.server.close());

const solo = (over = {}) => ({
  event: 'Bug Hunt', name: 'Asha Kumar', department: 'CSE', year: '2',
  phone: '9876543210', email: 'asha@example.com', ...over,
});
const team = (over = {}) => ({
  event: 'Crack the Clue', name: 'Bala R', department: 'ECE', year: '1',
  phone: '9876500001', email: 'bala@example.com', teamName: 'Falcons',
  partnerName: 'Chitra S', partnerDepartment: 'ECE', partnerYear: '2', ...over,
});

describe('supabase adapter', () => {
  test('verifies the connection and schema', async () => {
    await verifyConnection();
    const probe = await healthCheck();
    assert.equal(probe.ok, true);
    assert.ok(typeof probe.latencyMs === 'number');
  });

  test('writes a registration and maps columns to camelCase', async () => {
    const row = await createRegistration(solo());
    assert.ok(row.id);
    assert.equal(row.name, 'Asha Kumar');
    assert.ok(row.createdAt);
  });

  test('rejects a duplicate email for the same event', async () => {
    await assert.rejects(() => createRegistration(solo({ phone: '9000000000' })), DuplicateError);
  });

  test('rejects a duplicate phone regardless of formatting', async () => {
    await assert.rejects(
      () => createRegistration(solo({ email: 'other@example.com', phone: '+91 98765 43210' })),
      DuplicateError);
  });

  test('allows the same person to enter a different event', async () => {
    const row = await createRegistration(team({ email: 'asha@example.com', phone: '9876543210' }));
    assert.ok(row.id);
  });

  test('stores team fields and the debate choice', async () => {
    const row = await createRegistration(team({
      event: 'Debate', choice: 'Android', email: 'deb@example.com',
      phone: '9800000001', teamName: 'Byte Force',
    }));
    assert.equal(row.choice, 'Android');
    assert.equal(row.teamName, 'Byte Force');
    assert.equal(row.partnerName, 'Chitra S');
  });

  test('enforces the year 3 eligibility rule', async () => {
    await assert.rejects(
      () => createRegistration(team({ year: '3', email: 'y3@example.com', phone: '9600000001' })),
      CapacityError);
  });

  test('only one of many simultaneous identical submissions succeeds', async () => {
    const attempts = Array.from({ length: 25 }, () =>
      createRegistration(solo({ event: 'Murder Mystery', email: 'race@example.com', phone: '9500000001' }))
        .then(() => 'ok').catch(error => (error instanceof DuplicateError ? 'duplicate' : `error:${error.name}`)));
    const results = await Promise.all(attempts);
    assert.equal(results.filter(r => r === 'ok').length, 1, 'exactly one insert must win');
    assert.equal(results.filter(r => r === 'duplicate').length, 24);
  });

  test('enforces total capacity', async () => {
    await assert.rejects(
      () => createRegistration(solo({ email: 'cap@example.com', phone: '9400000001' }), { total: 1 }),
      CapacityError);
  });

  test('reports statistics', async () => {
    const summary = await stats(['Bug Hunt', 'Crack the Clue', 'Debate', 'Murder Mystery', 'Flush the Brain']);
    assert.ok(summary.total >= 4, `expected >=4 rows, got ${summary.total}`);
    assert.equal(summary.byEvent['Flush the Brain'], 0);
    assert.ok(summary.teams >= 1);
  });

  test('paginates and searches', async () => {
    const page = await listRegistrations({ page: 1, pageSize: 2 });
    assert.equal(page.rows.length, 2);
    assert.ok(page.pages >= 2);
    const found = await listRegistrations({ query: 'Byte Force' });
    assert.equal(found.total, 1);
    assert.equal(found.rows[0].teamName, 'Byte Force');
  });

  test('search input cannot break the PostgREST query', async () => {
    const result = await listRegistrations({ query: 'a,b)(*"\\' });
    assert.ok(Array.isArray(result.rows));
  });

  test('returns every row for the export', async () => {
    const rows = await allRegistrations();
    assert.ok(rows.length >= 4, `expected >=4 rows, got ${rows.length}`);
    assert.ok(rows.every(row => row.id && row.event));
  });

  test('deletes a single registration by id', async () => {
    const row = await createRegistration(solo({ email: 'delete-single@example.com', phone: '9300000001' }));
    const before = (await stats([])).total;
    const removed = await deleteRegistration(row.id);
    assert.equal(removed, true);
    assert.equal((await stats([])).total, before - 1);
    assert.equal(await deleteRegistration(row.id), false); // already gone
  });

  test('deletes every registration', async () => {
    const before = (await stats([])).total;
    assert.ok(before > 0);
    const removedCount = await deleteAllRegistrations();
    assert.equal(removedCount, before);
    assert.equal((await stats([])).total, 0);
  });
});

describe('resilience', () => {
  test('retries through a transient outage', async () => {
    const flaky = await startMockSupabase({ failFirst: 2 });
    process.env.SUPABASE_URL = flaky.url;
    const fresh = await import(`../src/server/supabase-db.js?flaky=${Date.now()}`);
    // First two calls return 503; the adapter must retry and still succeed.
    const summary = await fresh.stats(['Bug Hunt']);
    assert.equal(summary.total, 0);
    flaky.server.close();
    process.env.SUPABASE_URL = mock.url;
  });

  test('surfaces a clear error when the database is unreachable', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';   // nothing listening
    process.env.SUPABASE_MAX_RETRIES = '1';
    const dead = await import(`../src/server/supabase-db.js?dead=${Date.now()}`);
    await assert.rejects(() => dead.stats([]), error => {
      assert.equal(error.name, 'StorageUnavailableError');
      assert.match(error.message, /Could not reach the database/);
      return true;
    });
    const probe = await dead.healthCheck();
    assert.equal(probe.ok, false);
    process.env.SUPABASE_URL = mock.url;
    process.env.SUPABASE_MAX_RETRIES = '3';
  });
});
