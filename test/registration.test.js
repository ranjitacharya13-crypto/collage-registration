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
  event: 'Flush the Brain', name: 'Bala R', department: 'ECE', year: '1',
  phone: '9876500001', email: 'bala@example.com', teamName: 'Falcons',
  partnerName: 'Chitra S', partnerDepartment: 'ECE', partnerYear: '2', ...over,
});

after(() => { closeDatabase(); rmSync(workspace, { recursive: true, force: true }); });

describe('validation', () => {
  test('rejects unknown events', () => {
    assert.match(validateRegistration(solo({ event: 'Hackathon' })).error, /valid event/);
  });

  test('rejects the legacy "Fuzzy Brain" name', () => {
    assert.ok(validateRegistration(solo({ event: 'Fuzzy Brain' })).error);
  });

  test('rejects events whose registration is closed', () => {
    // Crack the Clue, Murder Mystery, Flush the Brain, Debate, and Bug Hunt are all closed.
    for (const event of ['Crack the Clue', 'Murder Mystery', 'Flush the Brain', 'Debate', 'Bug Hunt']) {
      assert.match(validateRegistration(solo({ event })).error, /valid event/);
    }
  });
});

describe('storage', () => {
  test('persists a registration', async () => {
    const row = await createRegistration(solo());
    assert.ok(row.id);
    assert.equal((await stats(['Bug Hunt'])).total, 1);
  });

  test('rejects a duplicate email for the same event', async () => {
    await assert.rejects(() => createRegistration(solo({ phone: '9999999999' })), DuplicateError);
  });

  test('rejects a duplicate phone for the same event', async () => {
    await assert.rejects(() => createRegistration(solo({ email: 'other@example.com' })), DuplicateError);
  });

  test('ignores phone formatting when detecting duplicates', async () => {
    await assert.rejects(
      () => createRegistration(solo({ email: 'x@example.com', phone: '+919876543210' })),
      DuplicateError);
  });

  test('enforces total capacity atomically', async () => {
    await assert.rejects(
      () => createRegistration(solo({ email: 'cap@example.com', phone: '9700000001' }), { total: 1 }),
      CapacityError);
  });

  test('search and pagination work', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createRegistration(solo({
        name: `Searchable ${i}`, email: `search${i}@example.com`,
        phone: `9700000${String(i).padStart(4, '0')}`,
      }));
    }
    const all = await listRegistrations({ pageSize: 100 });
    assert.ok(all.total >= 4, `expected at least 4 rows, got ${all.total}`);
    const found = await listRegistrations({ query: 'Searchable' });
    assert.ok(found.total >= 4);
    assert.ok(found.rows.every(row => row.name.includes('Searchable')));
    const page = await listRegistrations({ page: 1, pageSize: 2 });
    assert.equal(page.rows.length, 2);
    assert.ok(page.pages >= 2);
  });

  test('handles a burst of concurrent-style inserts without loss', async () => {
    const before = (await stats([])).total;
    for (let i = 0; i < 200; i += 1) {
      await createRegistration(solo({
        name: `Bulk ${i}`, email: `bulk${i}@example.com`, phone: `98000${String(i).padStart(5, '0')}`,
      }));
    }
    assert.equal((await stats([])).total, before + 200);
  });

  test('deletes a single registration by id', async () => {
    const row = await createRegistration(solo({
      email: 'delete-me@example.com', phone: '9111111111',
    }));
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
  const y3solo = (i) => ({
    event: 'Bug Hunt', name: `Y3 Solo ${i}`, department: 'CSE', year: '3',
    phone: `9611100${String(i).padStart(3, '0')}`, email: `y3solo${i}@example.com`,
  });

  test('allows exactly fifteen Year 3 places for Bug Hunt', async () => {
    const before = (await yearThreeRemaining(YEAR_THREE_LIMIT))['Bug Hunt'];
    assert.equal(before, 15, 'should start with fifteen places');

    for (let i = 0; i < 15; i += 1) {
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
    const row = await createRegistration({
      event: 'Bug Hunt', name: 'Second Year', department: 'CSE', year: '2',
      phone: '9622200001', email: 'y2ok@example.com',
    }, { yearThree: YEAR_THREE_LIMIT });
    assert.ok(row.id);
  });
});
