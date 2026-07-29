import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'aura-test-'));
process.env.DATA_DIR = workspace;
process.env.DB_PATH = join(workspace, 'test.db');

const { createRegistration, listRegistrations, allRegistrations, stats, yearThreeRemaining, DuplicateError, CapacityError, closeDatabase, deleteRegistration, deleteAllRegistrations } =
  await import('../src/server/db.js');
const { validateRegistration, YEAR_THREE_LIMIT } = await import('../src/server/validate.js');
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
  test('persists a registration', async () => {
    const row = await createRegistration(validateRegistration(solo()).value);
    assert.ok(row.id);
    assert.equal((await stats(['Bug Hunt'])).total, 1);
  });

  test('rejects a duplicate email for the same event', async () => {
    await assert.rejects(() => createRegistration(validateRegistration(solo({ phone: '9999999999' })).value), DuplicateError);
  });

  test('rejects a duplicate phone for the same event', async () => {
    await assert.rejects(() => createRegistration(validateRegistration(solo({ email: 'other@example.com' })).value), DuplicateError);
  });

  test('ignores phone formatting when detecting duplicates', async () => {
    await assert.rejects(
      () => createRegistration(validateRegistration(solo({ email: 'x@example.com', phone: '+919876543210' })).value),
      DuplicateError);
  });

  test('allows the same person in a different event', async () => {
    const row = await createRegistration(validateRegistration(team({ email: 'asha@example.com', phone: '9876543210' })).value);
    assert.ok(row.id);
  });

  test('stores team and choice fields', async () => {
    const row = await createRegistration(validateRegistration(team({
      event: 'Debate', choice: 'Android', email: 'deb@example.com', phone: '9800000001',
    })).value);
    assert.equal(row.choice, 'Android');
    assert.equal(row.partnerName, 'Chitra S');
  });

  test('enforces total capacity atomically', async () => {
    await assert.rejects(
      () => createRegistration(
        validateRegistration(solo({ email: 'cap@example.com', phone: '9700000001' })).value,
        { total: 1 }),
      CapacityError);
  });

  test('search and pagination work', async () => {
    const all = await listRegistrations({ pageSize: 100 });
    assert.ok(all.total >= 3, `expected at least 3 rows, got ${all.total}`);
    const found = await listRegistrations({ query: 'Falcons' });
    assert.ok(found.total >= 1);
    assert.ok(found.rows.every(row => row.teamName === 'Falcons'));
    const page = await listRegistrations({ page: 1, pageSize: 2 });
    assert.equal(page.rows.length, 2);
    assert.ok(page.pages >= 2);
  });

  test('handles a burst of concurrent-style inserts without loss', async () => {
    const before = (await stats([])).total;
    for (let i = 0; i < 200; i += 1) {
      await createRegistration(validateRegistration(solo({
        name: `Bulk ${i}`, email: `bulk${i}@example.com`, phone: `98000${String(i).padStart(5, '0')}`,
      })).value);
    }
    assert.equal((await stats([])).total, before + 200);
  });

  test('deletes a single registration by id', async () => {
    const row = await createRegistration(validateRegistration(solo({
      email: 'delete-me@example.com', phone: '9111111111',
    })).value);
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

describe('exports', () => {
  test('csv includes a header and every row', async () => {
    const rows = await allRegistrations();
    const csv = buildCsv(rows);
    assert.ok(csv.startsWith('\uFEFF'), 'has BOM for Excel');
    assert.ok(csv.includes('Participant 2'));
    assert.equal(csv.trim().split('\r\n').length, rows.length + 1);
  });

  test('csv escapes quotes and commas', () => {
    const csv = buildCsv([{ event: 'Bug Hunt', name: 'A, "B"', department: 'X', year: '1', phone: '1', email: 'e', createdAt: new Date().toISOString() }]);
    assert.ok(csv.includes('"A, ""B"""'));
  });

  test('xlsx is a valid non-empty zip', async () => {
    const buffer = buildXlsx(await allRegistrations());
    assert.ok(buffer.length > 500);
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');       // zip magic
    assert.ok(buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  });

  test('xlsx escapes xml-unsafe characters', () => {
    const buffer = buildXlsx([{ event: 'Bug Hunt', name: 'A & <b>', department: 'X', year: '1', phone: '1', email: 'e', createdAt: new Date().toISOString() }]);
    assert.ok(buffer.length > 500);
  });
});

describe('year 3 slot limit', () => {
  const y3solo = (i) => validateRegistration({
    event: 'Bug Hunt', name: `Y3 Solo ${i}`, department: 'CSE', year: '3',
    phone: `9611100${String(i).padStart(3, '0')}`, email: `y3solo${i}@example.com`,
  }).value;

  test('allows exactly five Year 3 places for Bug Hunt', async () => {
    const before = (await yearThreeRemaining(YEAR_THREE_LIMIT))['Bug Hunt'];
    assert.equal(before, 5, 'should start with five places');

    for (let i = 0; i < 5; i += 1) {
      await createRegistration(y3solo(i), { yearThree: YEAR_THREE_LIMIT });
    }
    assert.equal((await yearThreeRemaining(YEAR_THREE_LIMIT))['Bug Hunt'], 0);

    await assert.rejects(
      () => createRegistration(y3solo(99), { yearThree: YEAR_THREE_LIMIT }),
      error => {
        assert.equal(error.name, 'CapacityError');
        assert.match(error.message, /Year 3 places for Bug Hunt are filled/);
        return true;
      });
  });

  test('year 1 and 2 are unaffected once Year 3 is full', async () => {
    const row = await createRegistration(validateRegistration({
      event: 'Bug Hunt', name: 'Second Year', department: 'CSE', year: '2',
      phone: '9622200001', email: 'y2ok@example.com',
    }).value, { yearThree: YEAR_THREE_LIMIT });
    assert.ok(row.id);
  });

  test('a team with two Year 3 members uses two places', async () => {
    const team = (i) => validateRegistration({
      event: 'Debate', choice: 'Android', teamName: `Pair ${i}`,
      name: `Lead ${i}`, department: 'IT', year: '3',
      partnerName: `Mate ${i}`, partnerDepartment: 'IT', partnerYear: '3',
      phone: `9633300${String(i).padStart(3, '0')}`, email: `pair${i}@example.com`,
    }).value;

    await createRegistration(team(1), { yearThree: YEAR_THREE_LIMIT });
    await createRegistration(team(2), { yearThree: YEAR_THREE_LIMIT });
    assert.equal((await yearThreeRemaining(YEAR_THREE_LIMIT)).Debate, 1);

    // A third pair needs two places but only one remains.
    await assert.rejects(
      () => createRegistration(team(3), { yearThree: YEAR_THREE_LIMIT }),
      error => { assert.equal(error.name, 'CapacityError'); return true; });

    // A single Year 3 student still fits in the last place.
    const single = await createRegistration(validateRegistration({
      event: 'Debate', choice: 'iOS', teamName: 'Mixed',
      name: 'Y3 Lead', department: 'IT', year: '3',
      partnerName: 'Y2 Mate', partnerDepartment: 'IT', partnerYear: '2',
      phone: '9644400001', email: 'mixed@example.com',
    }).value, { yearThree: YEAR_THREE_LIMIT });
    assert.ok(single.id);
    assert.equal((await yearThreeRemaining(YEAR_THREE_LIMIT)).Debate, 0);
  });
});
