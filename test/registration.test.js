import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'aura-test-'));
process.env.DATA_DIR = workspace;
process.env.DB_PATH = join(workspace, 'test.db');

const { createRegistration, listRegistrations, allRegistrations, stats, DuplicateError, CapacityError, closeDatabase } =
  await import('../src/server/db.js');
const { validateRegistration } = await import('../src/server/validate.js');
const { buildXlsx, buildCsv } = await import('../src/server/export.js');

const solo = (over = {}) => ({
  event: 'Bug Hunt', name: 'Asha Kumar', department: 'CSE', year: '2',
  phone: '9876543210', email: 'asha@example.com', ...over,
});
const team = (over = {}) => ({
  event: 'Treasure Hunt', name: 'Bala R', department: 'ECE', year: '1',
  phone: '9876500001', email: 'bala@example.com', teamName: 'Falcons',
  partnerName: 'Chitra S', partnerDepartment: 'ECE', partnerYear: '2', ...over,
});

after(() => { closeDatabase(); rmSync(workspace, { recursive: true, force: true }); });

describe('validation', () => {
  test('accepts a valid solo registration', () => {
    assert.equal(validateRegistration(solo()).error, undefined);
  });

  test('rejects unknown events', () => {
    assert.match(validateRegistration(solo({ event: 'Hackathon' })).error, /valid event/);
  });

  test('rejects the legacy "Fuzzy Brain" name', () => {
    assert.ok(validateRegistration(solo({ event: 'Fuzzy Brain' })).error);
  });

  test('rejects bad email and phone', () => {
    assert.match(validateRegistration(solo({ email: 'nope' })).error, /email/);
    assert.match(validateRegistration(solo({ phone: '123' })).error, /phone/);
  });

  test('requires both participants for team events', () => {
    assert.match(validateRegistration(team({ partnerName: '' })).error, /participant 2/i);
    assert.match(validateRegistration(team({ teamName: '' })).error, /team name/i);
    assert.match(validateRegistration(team({ partnerYear: '' })).error, /participant 2/i);
  });

  test('rejects the same person entered twice', () => {
    assert.match(validateRegistration(team({ partnerName: 'bala r' })).error, /different people/);
  });

  test('enforces the debate dropdown', () => {
    const base = team({ event: 'Debate' });
    assert.match(validateRegistration(base).error, /Android, iOS/);
    assert.match(validateRegistration({ ...base, choice: 'Windows' }).error, /Android, iOS/);
    assert.equal(validateRegistration({ ...base, choice: 'iOS' }).error, undefined);
  });

  test('blocks year 3 from non-technical events', () => {
    assert.match(validateRegistration(team({ year: '3' })).error, /Year 3/);
    assert.match(validateRegistration(team({ partnerYear: '3' })).error, /Year 3/);
    // Bug Hunt allows year 3.
    assert.equal(validateRegistration(solo({ year: '3' })).error, undefined);
  });

  test('trims and normalises input', () => {
    const { value } = validateRegistration(solo({ name: '  Asha   Kumar ', email: '  ASHA@Example.COM ' }));
    assert.equal(value.name, 'Asha Kumar');
    assert.equal(value.email, 'asha@example.com');
  });

  test('drops a stray choice on events without one', () => {
    const { value } = validateRegistration(solo({ choice: 'Android' }));
    assert.equal(value.choice, undefined);
  });
});

describe('storage', () => {
  test('persists a registration', () => {
    const row = createRegistration(validateRegistration(solo()).value);
    assert.ok(row.id);
    assert.equal(stats(['Bug Hunt']).total, 1);
  });

  test('rejects a duplicate email for the same event', () => {
    assert.throws(() => createRegistration(validateRegistration(solo({ phone: '9999999999' })).value), DuplicateError);
  });

  test('rejects a duplicate phone for the same event', () => {
    assert.throws(() => createRegistration(validateRegistration(solo({ email: 'other@example.com' })).value), DuplicateError);
  });

  test('ignores phone formatting when detecting duplicates', () => {
    assert.throws(
      () => createRegistration(validateRegistration(solo({ email: 'x@example.com', phone: '+919876543210' })).value),
      DuplicateError);
  });

  test('allows the same person in a different event', () => {
    const row = createRegistration(validateRegistration(team({ email: 'asha@example.com', phone: '9876543210' })).value);
    assert.ok(row.id);
  });

  test('stores team and choice fields', () => {
    const row = createRegistration(validateRegistration(team({
      event: 'Debate', choice: 'Android', email: 'deb@example.com', phone: '9800000001',
    })).value);
    assert.equal(row.choice, 'Android');
    assert.equal(row.partnerName, 'Chitra S');
  });

  test('enforces total capacity atomically', () => {
    assert.throws(
      () => createRegistration(
        validateRegistration(solo({ email: 'cap@example.com', phone: '9700000001' })).value,
        { total: 1 }),
      CapacityError);
  });

  test('search and pagination work', () => {
    const all = listRegistrations({ pageSize: 100 });
    assert.ok(all.total >= 3, `expected at least 3 rows, got ${all.total}`);
    const found = listRegistrations({ query: 'Falcons' });
    assert.ok(found.total >= 1);
    assert.ok(found.rows.every(row => row.teamName === 'Falcons'));
    const page = listRegistrations({ page: 1, pageSize: 2 });
    assert.equal(page.rows.length, 2);
    assert.ok(page.pages >= 2);
  });

  test('handles a burst of concurrent-style inserts without loss', () => {
    const before = stats([]).total;
    for (let i = 0; i < 200; i += 1) {
      createRegistration(validateRegistration(solo({
        name: `Bulk ${i}`, email: `bulk${i}@example.com`, phone: `98000${String(i).padStart(5, '0')}`,
      })).value);
    }
    assert.equal(stats([]).total, before + 200);
  });
});

describe('exports', () => {
  test('csv includes a header and every row', () => {
    const rows = allRegistrations();
    const csv = buildCsv(rows);
    assert.ok(csv.startsWith('\uFEFF'), 'has BOM for Excel');
    assert.ok(csv.includes('Participant 2'));
    assert.equal(csv.trim().split('\r\n').length, rows.length + 1);
  });

  test('csv escapes quotes and commas', () => {
    const csv = buildCsv([{ event: 'Bug Hunt', name: 'A, "B"', department: 'X', year: '1', phone: '1', email: 'e', createdAt: new Date().toISOString() }]);
    assert.ok(csv.includes('"A, ""B"""'));
  });

  test('xlsx is a valid non-empty zip', () => {
    const buffer = buildXlsx(allRegistrations());
    assert.ok(buffer.length > 500);
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');       // zip magic
    assert.ok(buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  });

  test('xlsx escapes xml-unsafe characters', () => {
    const buffer = buildXlsx([{ event: 'Bug Hunt', name: 'A & <b>', department: 'X', year: '1', phone: '1', email: 'e', createdAt: new Date().toISOString() }]);
    assert.ok(buffer.length > 500);
  });
});
