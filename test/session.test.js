import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-for-session-signing';
const { createSession, verifySession } = await import('../src/server/session.js');

describe('stateless admin sessions', () => {
  test('a fresh session verifies', () => {
    const session = createSession();
    assert.ok(verifySession(session.value));
    assert.ok(session.maxAgeSeconds > 0);
  });

  test('rejects tampering and rubbish', () => {
    const { value } = createSession();
    assert.equal(verifySession(`${value}x`), false);
    assert.equal(verifySession(value.replace(/^\d+/, '9999999999999')), false);
    assert.equal(verifySession(''), false);
    assert.equal(verifySession(undefined), false);
    assert.equal(verifySession('a.b.c'), false);
    assert.equal(verifySession('nodots'), false);
  });

  test('rejects a cookie signed with a different secret', async () => {
    const { value } = createSession();
    process.env.SESSION_SECRET = 'a-completely-different-secret';
    const other = await import(`../src/server/session.js?v=${Date.now()}`);
    assert.equal(other.verifySession(value), false);
    process.env.SESSION_SECRET = 'test-secret-for-session-signing';
  });

  test('rejects an expired cookie', async () => {
    process.env.SESSION_TTL_MS = '1';
    const shortLived = await import(`../src/server/session.js?ttl=${Date.now()}`);
    const { value } = shortLived.createSession();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(shortLived.verifySession(value), false);
    delete process.env.SESSION_TTL_MS;
  });

  test('two instances sharing a secret accept each other cookies', async () => {
    const instanceA = await import(`../src/server/session.js?a=${Date.now()}`);
    const instanceB = await import(`../src/server/session.js?b=${Date.now()}`);
    assert.ok(instanceB.verifySession(instanceA.createSession().value),
      'a cookie issued by one serverless instance must work on another');
  });
});
