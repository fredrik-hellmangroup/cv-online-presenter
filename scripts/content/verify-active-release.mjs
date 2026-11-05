import { fileURLToPath } from 'node:url';
import path from 'node:path';

const activeReleasePath = '/internal/content/active';
const maximumTimerDelayMs = 2_147_483_647;

class ActiveReleaseResponseError extends Error {}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function parseActiveRelease(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ActiveReleaseResponseError('Active-release diagnostics returned an invalid JSON response.');
  }

  const fields = Object.keys(payload).sort();
  if (
    fields.length !== 2
    || fields[0] !== 'contentReleaseId'
    || fields[1] !== 'contentVersion'
    || (payload.contentReleaseId !== null && typeof payload.contentReleaseId !== 'string')
    || (typeof payload.contentReleaseId === 'string' && payload.contentReleaseId.trim().length === 0)
    || typeof payload.contentVersion !== 'string'
    || payload.contentVersion.trim().length === 0
  ) {
    throw new ActiveReleaseResponseError('Active-release diagnostics returned missing or invalid fields.');
  }

  return payload;
}

export async function verifyActiveRelease({
  url,
  token,
  releaseId,
  version,
  fetchImpl = globalThis.fetch,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = () => performance.now(),
  timeoutMs = 30_000,
  intervalMs = 1_000,
}) {
  requireNonEmptyString(url, 'url');
  requireNonEmptyString(token, 'token');
  requireNonEmptyString(releaseId, 'releaseId');
  requireNonEmptyString(version, 'version');
  if (typeof fetchImpl !== 'function' || typeof sleep !== 'function' || typeof now !== 'function') {
    throw new TypeError('fetchImpl, sleep, and now must be functions.');
  }
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > maximumTimerDelayMs
    || !Number.isFinite(intervalMs)
    || intervalMs <= 0
    || intervalMs > maximumTimerDelayMs
  ) {
    throw new TypeError(
      `timeoutMs and intervalMs must be positive finite numbers no greater than ${maximumTimerDelayMs}.`,
    );
  }

  const endpoint = new URL(activeReleasePath, `${url.replace(/\/+$/, '')}/`);
  if (endpoint.protocol !== 'https:') {
    throw new TypeError('Active-release diagnostics must use HTTPS.');
  }

  const deadline = now() + timeoutMs;
  let mismatch = 'the active release did not match';

  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(`Timed out verifying the active release: ${mismatch}.`);
    }

    const controller = new AbortController();
    let timer;
    const timeoutError = new Error('Active-release diagnostics request timed out.');
    let active;
    try {
      active = await Promise.race([
        (async () => {
          const response = await fetchImpl(endpoint.href, {
            method: 'GET',
            headers: { 'X-Content-Activation-Token': token },
            redirect: 'error',
            signal: controller.signal,
          });
          if (!response || response.ok !== true) {
            throw new ActiveReleaseResponseError(
              `Active-release diagnostics returned HTTP ${response?.status ?? 'unknown'}.`,
            );
          }

          try {
            return parseActiveRelease(await response.json());
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new ActiveReleaseResponseError('Active-release diagnostics returned malformed JSON.');
            }
            throw error;
          }
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(timeoutError);
          }, remaining);
        }),
      ]);
    } catch (error) {
      if (error === timeoutError) {
        throw error;
      }
      if (error instanceof ActiveReleaseResponseError) {
        throw error;
      }
      throw new Error('Active-release diagnostics fetch failed.');
    } finally {
      clearTimeout(timer);
    }

    if (active.contentReleaseId === releaseId && active.contentVersion === version) {
      return active;
    }

    mismatch = active.contentReleaseId !== releaseId
      ? 'the active release id did not match'
      : 'the active content version did not match';

    const timeLeft = deadline - now();
    if (timeLeft <= 0) {
      throw new Error(`Timed out verifying the active release: ${mismatch}.`);
    }
    await sleep(Math.min(intervalMs, timeLeft));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyActiveRelease({
      url: process.env.CONTENT_ACTIVATION_URL,
      token: process.env.CONTENT_ACTIVATION_TOKEN,
      releaseId: process.env.CONTENT_RELEASE_ID,
      version: process.env.CONTENT_VERSION,
    });
    console.log('Protected active-release diagnostics match the activated release.');
  } catch (error) {
    console.error(`Active-release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
