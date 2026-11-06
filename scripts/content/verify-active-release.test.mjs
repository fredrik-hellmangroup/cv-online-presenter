import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyActiveRelease } from './verify-active-release.mjs';

const expected = {
  releaseId: '20261102-232500-abcdef0',
  version: 'snapshot-42',
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function pollingOptions(overrides = {}) {
  let now = 0;
  return {
    url: 'https://example.test',
    token: 'test-token',
    ...expected,
    timeoutMs: 20,
    intervalMs: 5,
    now: () => now,
    sleep: async (duration) => { now += duration; },
    ...overrides,
  };
}

test('accepts the exact active release and sends the token in the request header', async () => {
  let request;
  await verifyActiveRelease({
    ...pollingOptions(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        contentReleaseId: expected.releaseId,
        contentVersion: expected.version,
      });
    },
  });

  assert.equal(request.url, 'https://example.test/internal/content/active');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers['X-Content-Activation-Token'], 'test-token');
});

test('rejects redirects without following them or exposing the token', async () => {
  let request;

  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async (url, options) => {
        request = { url, options };
        assert.equal(options.redirect, 'error');
        throw new TypeError('fetch redirect error');
      },
    }),
    (error) => {
      assert.match(error.message, /fetch failed/i);
      assert.doesNotMatch(error.message, /test-token/);
      return true;
    },
  );

  assert.equal(request.url, 'https://example.test/internal/content/active');
  assert.equal(request.options.redirect, 'error');
});

test('rejects timeout and interval values above the Node timer maximum', async () => {
  const maximumTimerDelay = 2_147_483_647;

  for (const options of [
    { timeoutMs: maximumTimerDelay + 1 },
    { intervalMs: maximumTimerDelay + 1 },
  ]) {
    await assert.rejects(
      verifyActiveRelease({
        ...pollingOptions(),
        ...options,
        fetchImpl: async () => response({
          contentReleaseId: expected.releaseId,
          contentVersion: expected.version,
        }),
      }),
      /timeoutMs and intervalMs must be positive finite numbers no greater than 2147483647/i,
    );
  }
});

test('accepts timeout and interval values at the Node timer maximum', async () => {
  const maximumTimerDelay = 2_147_483_647;

  await verifyActiveRelease({
    ...pollingOptions({
      timeoutMs: maximumTimerDelay,
      intervalMs: maximumTimerDelay,
    }),
    fetchImpl: async () => response({
      contentReleaseId: expected.releaseId,
      contentVersion: expected.version,
    }),
  });
});

test('fails when the active release id does not match before the timeout', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async () => response({
        contentReleaseId: 'another-release',
        contentVersion: expected.version,
      }),
    }),
    /release id mismatch|timed out/i,
  );
});

test('fails when the active content version does not match before the timeout', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async () => response({
        contentReleaseId: expected.releaseId,
        contentVersion: 'older-version',
      }),
    }),
    /version mismatch|timed out/i,
  );
});

test('rejects missing and malformed response fields', async () => {
  for (const body of [
    { contentReleaseId: expected.releaseId },
    { contentReleaseId: 7, contentVersion: expected.version },
    { contentReleaseId: '  ', contentVersion: expected.version },
    { contentReleaseId: expected.releaseId, contentVersion: '   ' },
    { contentReleaseId: expected.releaseId, contentVersion: expected.version, unexpected: true },
  ]) {
    await assert.rejects(
      verifyActiveRelease({
        ...pollingOptions(),
        fetchImpl: async () => response(body),
      }),
      /invalid|missing|field|response/i,
    );
  }
});

test('rejects malformed JSON', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('invalid JSON'); },
      }),
    }),
    /json|parse|response/i,
  );
});

test('rejects non-success HTTP responses', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async () => response({}, 503),
    }),
    /503|HTTP/i,
  );
});

test('rejects fetch failures without exposing the token', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions(),
      fetchImpl: async () => { throw new Error('network unavailable'); },
    }),
    (error) => {
      assert.match(error.message, /fetch|network/i);
      assert.doesNotMatch(error.message, /test-token/);
      return true;
    },
  );
});

test('fails after the bounded polling timeout', async () => {
  let calls = 0;
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions({ timeoutMs: 10, intervalMs: 4 }),
      fetchImpl: async () => {
        calls += 1;
        return response({
          contentReleaseId: 'not-active-yet',
          contentVersion: expected.version,
        });
      },
    }),
    /timed out|mismatch/i,
  );
  assert.equal(calls, 3);
});

test('bounds the time spent waiting for the diagnostics response body', async () => {
  await assert.rejects(
    verifyActiveRelease({
      ...pollingOptions({ timeoutMs: 10 }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      }),
    }),
    /timed out/i,
  );
});
