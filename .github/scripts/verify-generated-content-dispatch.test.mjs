import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertContentSubmoduleResponse,
  assertPullRequestContract,
  classifyContentProgression,
  formatSummary,
  discoverLatestEligiblePullRequest,
  getClosedPullRequests,
  getJson,
  isAllowedChangedFile,
  isAllowedChangedFileChange,
  parseReopenRequest,
  writeOutput,
} from './verify-generated-content-dispatch.mjs'
import {
  decideContentPointerLifecycle,
  discoverContentPointerPullRequests,
} from './content-pointer-lifecycle.mjs'

const sha = 'a'.repeat(40)
const contentSubmoduleUrl = 'https://github.com/fredrik-hellmangroup/cv-online-presenter-content.git'

function validPullRequest() {
  return {
    number: 42,
    html_url: 'https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/42',
    state: 'closed',
    merged: true,
    merged_at: '2026-10-31T12:00:00Z',
    head: {
      repo: { full_name: 'fredrik-hellmangroup/cv-online-presenter-content' },
      ref: 'automation/generated-content',
      sha,
    },
    base: {
      repo: { full_name: 'fredrik-hellmangroup/cv-online-presenter-content' },
      ref: 'main',
    },
    merge_commit_sha: 'b'.repeat(40),
    labels: [{ name: 'generated-content' }],
  }
}

function listedPullRequest(number, headSha, mergeSha, mergedAt) {
  return {
    number,
    state: 'closed',
    merged_at: mergedAt,
    merge_commit_sha: mergeSha,
    head: {
      repo: { full_name: 'fredrik-hellmangroup/cv-online-presenter-content' },
      ref: 'automation/generated-content',
      sha: headSha,
    },
    base: {
      repo: { full_name: 'fredrik-hellmangroup/cv-online-presenter-content' },
      ref: 'main',
    },
    labels: [{ name: 'generated-content' }],
  }
}

function pullRequestDetails(listed) {
  return {
    ...listed,
    merged: true,
    html_url: `https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/${listed.number}`,
  }
}

function apiResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function mockedPullRequestApi(pullRequests, filesByNumber = new Map()) {
  return async (url) => {
    const parsedUrl = new URL(url)
    const listingMatch = parsedUrl.pathname.endsWith('/pulls') && parsedUrl.searchParams.has('state')
    if (listingMatch) return apiResponse(pullRequests)

    const fileMatch = /\/pulls\/(\d+)\/files$/.exec(parsedUrl.pathname)
    if (fileMatch) return apiResponse(filesByNumber.get(Number(fileMatch[1])) ?? [
      { filename: 'content/pages/home.md' },
    ])

    const detailMatch = /\/pulls\/(\d+)$/.exec(parsedUrl.pathname)
    if (detailMatch) {
      const pr = pullRequests.find((candidate) => candidate.number === Number(detailMatch[1]))
      return apiResponse(pullRequestDetails(pr))
    }

    if (parsedUrl.pathname.includes('/compare/')) {
      return apiResponse({ status: 'identical', ahead_by: 0, behind_by: 0 })
    }
    throw new Error(`Unexpected API request: ${parsedUrl.pathname}`)
  }
}

test('accepts only exact generated page and provenance paths', () => {
  assert.equal(isAllowedChangedFile('content/pages/cv.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/home.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/services.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/projects.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/projects/nordhem.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/projects/stockholmsmassan.md'), true)
  assert.equal(isAllowedChangedFile('content/pages/projects/asira.md'), true)
  assert.equal(isAllowedChangedFile('content/generated-provenance.json'), true)
  assert.equal(isAllowedChangedFile('content/site.json'), false)
  assert.equal(isAllowedChangedFile('content/sources/master-cv.md'), false)
  assert.equal(isAllowedChangedFile('content/manifest.json'), false)
  assert.equal(isAllowedChangedFile('PROVENANCE.md'), false)
  assert.equal(isAllowedChangedFile('content/sources/owner-cv-v1.2.md'), false)
  assert.equal(isAllowedChangedFile('content/generated-provenance.json.bak'), false)
  assert.equal(isAllowedChangedFile('content/generated-provenance.json/extra'), false)
  assert.equal(isAllowedChangedFile('README.md'), false)
  assert.equal(isAllowedChangedFile('content/pages/demo-profile.md'), false)
  assert.equal(isAllowedChangedFile('content/pages/projects/new.md'), false)
})

test('rejects renames from outside the exact allowlist into an allowed path', () => {
  assert.equal(isAllowedChangedFileChange({
    filename: 'content/pages/cv.md',
    previous_filename: 'README.md',
  }), false)
  assert.equal(isAllowedChangedFileChange({
    filename: 'content/pages/cv.md',
    previous_filename: 'content/pages/home.md',
  }), true)
})

test('an older dispatch wake-up selects the newest eligible merged PR', async () => {
  const older = listedPullRequest(41, 'a'.repeat(40), 'b'.repeat(40), '2026-10-30T12:00:00Z')
  const newer = listedPullRequest(42, 'c'.repeat(40), 'd'.repeat(40), '2026-10-31T12:00:00Z')
  older.updated_at = '2026-11-01T12:00:00Z'
  newer.updated_at = '2026-10-30T13:00:00Z'
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockedPullRequestApi([older, newer])

  try {
    const result = await discoverLatestEligiblePullRequest({
      number: older.number,
      headSha: older.head.sha,
      mergeSha: older.merge_commit_sha,
      mergedAt: older.merged_at,
    }, 'read-only-token')
    assert.equal(result.number, newer.number)
    assert.equal(result.headSha, newer.head.sha)
    assert.equal(result.mergeSha, newer.merge_commit_sha)
    assert.equal(result.mergedAt, newer.merged_at)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a newer event missing from the completed listing fails closed', async () => {
  const older = listedPullRequest(41, 'a'.repeat(40), 'b'.repeat(40), '2026-10-30T12:00:00Z')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockedPullRequestApi([older])

  try {
    await assert.rejects(
      discoverLatestEligiblePullRequest({
        number: 42,
        headSha: 'c'.repeat(40),
        mergeSha: 'd'.repeat(40),
      }, 'read-only-token'),
      /absent from the complete merged-PR listing.*Rerun reconciliation/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('skips the newer PR when its changed files include paths outside the allowlist', async () => {
  const older = listedPullRequest(41, 'a'.repeat(40), 'b'.repeat(40), '2026-10-30T12:00:00Z')
  const newer = listedPullRequest(42, 'c'.repeat(40), 'd'.repeat(40), '2026-10-31T12:00:00Z')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockedPullRequestApi([older, newer], new Map([
    [42, [{ filename: 'content/pages/home.md' }, { filename: 'README.md' }]],
  ]))

  try {
    const result = await discoverLatestEligiblePullRequest({
      number: newer.number,
      headSha: newer.head.sha,
      mergeSha: newer.merge_commit_sha,
      mergedAt: newer.merged_at,
    }, 'read-only-token')
    assert.equal(result.number, older.number)
    assert.deepEqual(result.changedFiles, ['content/pages/home.md'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('paginates closed PR discovery and fails when the safety limit prevents completeness', async () => {
  const originalFetch = globalThis.fetch
  let pages = 0
  globalThis.fetch = async (url) => {
    pages += 1
    const page = Number(new URL(url).searchParams.get('page'))
    return apiResponse(page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
      : [])
  }

  try {
    assert.equal((await getClosedPullRequests('read-only-token')).length, 100)
    assert.equal(pages, 2)

    pages = 0
    globalThis.fetch = async () => {
      pages += 1
      return apiResponse(Array.from({ length: 100 }, (_, index) => ({
        number: (pages - 1) * 100 + index + 1,
      })))
    }
    await assert.rejects(
      getClosedPullRequests('read-only-token'),
      /3000-PR safety limit.*Rerun/,
    )
    assert.equal(pages, 30)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('accepts the authoritative merged PR contract', () => {
  assert.doesNotThrow(() => assertPullRequestContract(validPullRequest(), {
    number: 42,
    headSha: sha,
    mergeSha: 'b'.repeat(40),
  }))
})

test('requires the exact content-repository PR URL and matching PR number', () => {
  for (const htmlUrl of [
    'https://attacker.example/fredrik-hellmangroup/cv-online-presenter-content/pull/42',
    'https://github.com/attacker/cv-online-presenter-content/pull/42',
    'https://github.com/fredrik-hellmangroup/other-repository/pull/42',
    'https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/43',
    'https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/42?redirect=attacker',
    'https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/42#fragment',
    'https://github.com/fredrik-hellmangroup/cv-online-presenter-content/pull/42\ninjected=value',
  ]) {
    assert.throws(() => assertPullRequestContract({
      ...validPullRequest(),
      html_url: htmlUrl,
    }, { number: 42 }), /URL must match/)
  }

  assert.throws(() => assertPullRequestContract(validPullRequest(), { number: 43 }), /URL must match/)
})

test('rejects GitHub output values that are not strings or contain line breaks', () => {
  for (const value of ['first\ninjected=value', 'first\rinjected=value', 42, true, null]) {
    assert.throws(() => writeOutput('source_pr_url', value), /valid strings without CR or LF/)
  }
  for (const name of ['bad\nname', 'bad\rname', 42, null, 'bad name']) {
    assert.throws(() => writeOutput(name, 'safe-value'), /valid strings without CR or LF/)
  }
})

test('does not expose malicious GitHub API bodies in errors or failure summaries', async () => {
  const maliciousBody = '</summary>\r\n::error::injected\nsecret=attacker-controlled'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    headers: new Headers(),
    body: { cancel: async () => {} },
    text: async () => maliciousBody,
  })

  try {
    const error = await getJson(
      'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      undefined,
      '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
    ).then(
      () => assert.fail('Expected the API request to fail.'),
      (caught) => caught,
    )
    const summary = formatSummary(null, error)
    assert.match(error.message, /HTTP 400/)
    assert.match(error.message, /pulls\/42/)
    assert.match(summary, /HTTP 400/)
    assert.match(summary, /pulls\/42/)
    assert.doesNotMatch(error.message, /injected|attacker-controlled|secret=/)
    assert.doesNotMatch(summary, /injected|attacker-controlled|secret=/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries rate-limit and transient API errors a bounded number of times', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const status of [403, 429, 503]) {
      let attempts = 0
      globalThis.fetch = async () => {
        attempts += 1
        return {
          ok: false,
          status,
          headers: new Headers({ 'retry-after': '0', 'x-ratelimit-remaining': '0' }),
          body: { cancel: async () => {} },
        }
      }

      const error = await getJson(
        'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
        undefined,
        '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      ).then(
        () => assert.fail('Expected the API request to fail after bounded retries.'),
        (caught) => caught,
      )
      assert.equal(attempts, 3)
      assert.match(error.message, new RegExp(`HTTP ${status}`))
      assert.match(error.message, /retry the workflow/)
      assert.match(formatSummary(null, error), new RegExp(`HTTP ${status}`))
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('honors Retry-After seconds and HTTP dates within the safe retry bound', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  try {
    for (const { retryAfter, expectedDelay } of [
      { retryAfter: '7', expectedDelay: (delay) => delay === 7_000 },
      {
        retryAfter: new Date(Date.now() + 45_000).toUTCString(),
        expectedDelay: (delay) => delay >= 43_000 && delay <= 45_000,
      },
    ]) {
      let attempts = 0
      const delays = []
      globalThis.setTimeout = (callback, delay) => {
        delays.push(delay)
        callback()
        return 0
      }
      globalThis.fetch = async () => {
        attempts += 1
        if (attempts === 1) {
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'retry-after': retryAfter }),
            body: { cancel: async () => {} },
          }
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) }
      }

      const result = await getJson(
        'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
        undefined,
        '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      )
      assert.deepEqual(result, { success: true })
      assert.equal(attempts, 2)
      assert.equal(delays.length, 1)
      assert.equal(expectedDelay(delays[0]), true)
      assert.ok(delays[0] <= 60_000)
    }
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test('honors X-RateLimit-Reset and fails promptly when the reset exceeds the retry bound', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  try {
    let attempts = 0
    const delays = []
    globalThis.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 0
    }
    globalThis.fetch = async () => {
      attempts += 1
      if (attempts === 1) {
        return {
          ok: false,
          status: 403,
          headers: new Headers({
            'retry-after': '1',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.ceil((Date.now() + 35_000) / 1_000)),
          }),
          body: { cancel: async () => {} },
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) }
    }

    const result = await getJson(
      'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      undefined,
      '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
    )
    assert.deepEqual(result, { success: true })
    assert.equal(attempts, 2)
    assert.equal(delays.length, 1)
    assert.ok(delays[0] > 30_000 && delays[0] <= 36_000, `Expected reset delay, got ${delays[0]}ms`)

    for (const headers of [
      {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.ceil((Date.now() + 120_000) / 1_000)),
      },
      { 'retry-after': '120' },
    ]) {
      attempts = 0
      delays.length = 0
      globalThis.fetch = async () => {
        attempts += 1
        return {
          ok: false,
          status: headers['retry-after'] ? 429 : 403,
          headers: new Headers(headers),
          body: { cancel: async () => {} },
        }
      }

      const error = await getJson(
        'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
        undefined,
        '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      ).then(
        () => assert.fail('Expected the rate-limited request to fail before retrying too early.'),
        (caught) => caught,
      )
      assert.equal(attempts, 1)
      assert.equal(delays.length, 0)
      assert.match(error.message, /beyond the 60-second retry window/)
      assert.match(error.message, /rerun this workflow after the rate limit resets/)
      assert.match(formatSummary(null, error), /Wait for the GitHub API rate limit to reset, then rerun this workflow/)
      assert.doesNotMatch(error.message, /120|attacker|secret/)
    }
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test('uses Retry-After for secondary rate limits without waiting for a later primary reset', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const delays = []
  let attempts = 0
  try {
    globalThis.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 0
    }
    globalThis.fetch = async () => {
      attempts += 1
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({
            'retry-after': '5',
            'x-ratelimit-remaining': '10',
            'x-ratelimit-reset': String(Math.ceil((Date.now() + 120_000) / 1_000)),
          }),
          body: { cancel: async () => {} },
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) }
    }

    const result = await getJson(
      'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      undefined,
      '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
    )
    assert.deepEqual(result, { success: true })
    assert.equal(attempts, 2)
    assert.deepEqual(delays, [5_000])
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test('ignores a rate-limit reset header for transient 5xx and non-rate-limit 403 responses', async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  try {
    for (const status of [503, 403]) {
      const delays = []
      let attempts = 0
      globalThis.setTimeout = (callback, delay) => {
        delays.push(delay)
        callback()
        return 0
      }
      globalThis.fetch = async () => {
        attempts += 1
        if (attempts === 1) {
          return {
            ok: false,
            status,
            headers: new Headers({
              'x-ratelimit-remaining': '10',
              'x-ratelimit-reset': String(Math.ceil((Date.now() + 120_000) / 1_000)),
            }),
            body: { cancel: async () => {} },
          }
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) }
      }

      const result = await getJson(
        'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
        undefined,
        '/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      )
      assert.deepEqual(result, { success: true })
      assert.equal(attempts, 2)
      assert.deepEqual(delays, [250])
    }
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test('sanitizes an unsafe endpoint before including it in errors or summaries', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    headers: new Headers(),
    body: { cancel: async () => {} },
  })

  try {
    const error = await getJson(
      'https://api.github.com/repos/fredrik-hellmangroup/cv-online-presenter-content/pulls/42',
      undefined,
      '/repos/attacker/pulls/42\r\ninjected',
    ).then(
      () => assert.fail('Expected the API request to fail.'),
      (caught) => caught,
    )
    assert.doesNotMatch(error.message, /attacker|injected/)
    assert.doesNotMatch(formatSummary(null, error), /attacker|injected/)
    assert.match(error.message, /the requested endpoint/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failure summaries never include arbitrary error text or unsafe endpoints', () => {
  const summary = formatSummary(null, new Error('injected\r\n::error::malicious body'))
  assert.match(summary, /Failed — verification failed/)
  assert.doesNotMatch(summary, /injected|malicious body/)
})

test('requires merged to be a strict boolean and merged_at to be a non-empty string', () => {
  for (const merged of [false, 'true', 1, null, undefined, {}]) {
    const pullRequest = validPullRequest()
    pullRequest.merged = merged
    assert.throws(() => assertPullRequestContract(pullRequest), /must be merged/)
  }

  for (const mergedAt of ['', '  ', null, 123]) {
    const pullRequest = validPullRequest()
    pullRequest.merged_at = mergedAt
    assert.throws(() => assertPullRequestContract(pullRequest), /must be merged/)
  }
})

test('rejects mismatched dispatch SHAs, source branch, base branch, or missing label', () => {
  assert.throws(
    () => assertPullRequestContract(validPullRequest(), { headSha: 'c'.repeat(40) }),
    /head_sha/,
  )

  const wrongHead = validPullRequest()
  wrongHead.head.ref = 'attacker-branch'
  assert.throws(() => assertPullRequestContract(wrongHead), /automation\/generated-content/)

  const wrongBase = validPullRequest()
  wrongBase.base.ref = 'release'
  assert.throws(() => assertPullRequestContract(wrongBase), /target/)

  const unlabeled = validPullRequest()
  unlabeled.labels = []
  assert.throws(() => assertPullRequestContract(unlabeled), /generated-content/)

  for (const invalidSha of [123, {}, null]) {
    const invalidHeadSha = validPullRequest()
    invalidHeadSha.head.sha = invalidSha
    assert.throws(() => assertPullRequestContract(invalidHeadSha), /full 40-character/)
  }

  for (const invalidRef of [123, {}, null]) {
    const invalidHeadRef = validPullRequest()
    invalidHeadRef.head.ref = invalidRef
    assert.throws(() => assertPullRequestContract(invalidHeadRef), /automation\/generated-content/)
  }
})

test('classifies current-to-new as forward and new-to-current as older', () => {
  const currentToNew = classifyContentProgression({
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
  })
  const newToCurrent = classifyContentProgression({
    status: 'behind',
    ahead_by: 0,
    behind_by: 2,
  })
  assert.equal(currentToNew, 'forward')
  assert.equal(newToCurrent, 'older')
  assert.equal(classifyContentProgression({
    status: 'identical',
    ahead_by: 0,
    behind_by: 0,
  }), 'identical')
  assert.throws(() => classifyContentProgression({
    status: 'diverged',
    ahead_by: 1,
    behind_by: 1,
  }), /descendant/)
  assert.throws(() => classifyContentProgression({
    status: 'ahead',
    ahead_by: 1,
    behind_by: 1,
  }), /descendant/)
})

test('rejects invalid compare counts instead of coercing API values', () => {
  for (const [aheadBy, behindBy] of [
    ['1', 0],
    [1.5, 0],
    [-1, 0],
    [0, '0'],
    [0, 0.5],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.throws(() => classifyContentProgression({
      status: 'ahead',
      ahead_by: aheadBy,
      behind_by: behindBy,
    }), /invalid compare/)
  }
})

test('accepts only the documented content submodule file response', () => {
  assert.equal(assertContentSubmoduleResponse({
    type: 'file',
    submodule_git_url: contentSubmoduleUrl,
    sha,
  }), sha)

  for (const response of [
    { type: 'submodule', submodule_git_url: contentSubmoduleUrl, sha },
    { type: 'file', submodule_git_url: 'https://github.com/attacker/content.git', sha },
    { type: 'file', submodule_git_url: contentSubmoduleUrl, sha: 'not-a-commit' },
    { type: 'file', submodule_git_url: contentSubmoduleUrl, sha: 'a'.repeat(39) },
  ]) {
    assert.throws(() => assertContentSubmoduleResponse(response), /valid Git submodule gitlink/)
  }
  for (const invalidSha of [123, {}, null]) {
    assert.throws(() => assertContentSubmoduleResponse({
      type: 'file',
      submodule_git_url: contentSubmoduleUrl,
      sha: invalidSha,
    }), /valid Git submodule gitlink/)
  }
})

test('requires a manually referenced app PR to reopen a closed PR', () => {
  assert.deepEqual(parseReopenRequest('repository_dispatch', {}), {
    requested: false,
    pullRequest: '',
    markReady: false,
  })
  assert.deepEqual(parseReopenRequest('workflow_dispatch', {
    inputs: { reopen_closed: 'true', app_pr_number: '42' },
  }), {
    requested: true,
    pullRequest: 42,
    markReady: false,
  })
  assert.deepEqual(parseReopenRequest('workflow_dispatch', {
    inputs: { reopen_closed: 'true', app_pr_number: '42', mark_ready: 'true' },
  }), {
    requested: true,
    pullRequest: 42,
    markReady: true,
  })
  assert.throws(() => parseReopenRequest('workflow_dispatch', {
    inputs: { reopen_closed: 'true' },
  }), /app_pr_number/)
  assert.throws(() => parseReopenRequest('workflow_dispatch', {
    inputs: { reopen_closed: true, app_pr_number: '42.5' },
  }), /app_pr_number/)
  assert.throws(() => parseReopenRequest('repository_dispatch', {
    inputs: { app_pr_number: '42' },
  }), /only be supplied/)
  assert.throws(() => parseReopenRequest('workflow_dispatch', {
    inputs: { mark_ready: 'true' },
  }), /only be supplied/)
  assert.throws(() => parseReopenRequest('workflow_dispatch', {
    inputs: { reopen_closed: 'true', app_pr_number: '42', mark_ready: 'maybe' },
  }), /boolean/)
})

function openPointer(number, contentSha, {
  relationToMain = 'forward',
  relationToCandidate = 'older',
  branchName = `automation/content-pointer-${contentSha}`,
  relationToOthers = {},
  createdAt = '2026-10-31T12:00:00Z',
  diffPaths = ['content'],
} = {}) {
  return {
    number,
    url: `https://github.com/fredrik-hellmangroup/cv-online-presenter/pull/${number}`,
    branchName,
    contentSha,
    mode: '160000',
    diffPaths,
    relationToMain,
    relationToCandidate,
    relationToOthers,
    createdAt,
  }
}

test('closes stale and superseded open pointers before creating a newer candidate', () => {
  const appMainSha = 'a'.repeat(40)
  const olderSha = 'b'.repeat(40)
  const newestSha = 'c'.repeat(40)
  const candidateSha = 'd'.repeat(40)
  const result = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(11, appMainSha, { relationToMain: 'identical', relationToCandidate: 'older', diffPaths: [] }),
      openPointer(12, olderSha, {
        relationToCandidate: 'older',
        relationToOthers: { 13: 'older' },
      }),
      openPointer(13, newestSha, {
        relationToCandidate: 'older',
        relationToOthers: { 12: 'forward' },
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(result, {
    action: 'create',
    closeNumbers: [11, 12, 13],
    pullRequestNumber: '',
    preserveNumber: '',
  })
})

test('creates for a forward candidate, cleans stale pointers for an older candidate, and rejects divergence', () => {
  const candidateSha = '4'.repeat(40)
  const currentSha = '5'.repeat(40)
  assert.deepEqual(decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  }), {
    action: 'create',
    closeNumbers: [],
    pullRequestNumber: '',
    preserveNumber: '',
  })

  assert.deepEqual(decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'older',
    openPullRequests: [
      openPointer(41, currentSha, {
        relationToMain: 'older',
        relationToCandidate: 'forward',
        diffPaths: [],
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  }), {
    action: 'noop',
    closeNumbers: [41],
    pullRequestNumber: '',
    preserveNumber: '',
  })

  assert.throws(() => decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'divergent',
    openPullRequests: [],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  }), /linear content relationship/)
})

test('closes the legacy bare content-update branch instead of preserving it', () => {
  const candidateSha = '6'.repeat(40)
  const legacyPullRequest = {
    number: 42,
    url: 'https://github.com/fredrik-hellmangroup/cv-online-presenter/pull/42',
    headRefName: 'automation/content-update',
    headRepository: { nameWithOwner: 'fredrik-hellmangroup/cv-online-presenter' },
    baseRefName: 'main',
    createdAt: '2026-10-31T12:00:00Z',
  }
  assert.deepEqual(discoverContentPointerPullRequests([legacyPullRequest]), [legacyPullRequest])

  const result = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(42, candidateSha, {
        branchName: 'automation/content-update',
        relationToCandidate: 'identical',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(result, {
    action: 'create',
    closeNumbers: [42],
    pullRequestNumber: '',
    preserveNumber: '',
  })
})

test('discovers bare legacy pointer and content-update branches and rejects malformed API fields', () => {
  const bareLegacy = {
    number: 44,
    url: 'https://github.com/fredrik-hellmangroup/cv-online-presenter/pull/44',
    headRefName: 'automation/content-pointer',
    headRepository: { nameWithOwner: 'fredrik-hellmangroup/cv-online-presenter' },
    baseRefName: 'main',
    createdAt: '2026-10-31T12:00:00Z',
  }
  const unrelated = { ...bareLegacy, number: 45, headRefName: 'feature/unrelated' }
  assert.deepEqual(discoverContentPointerPullRequests([unrelated, bareLegacy]), [bareLegacy])
  assert.throws(() => discoverContentPointerPullRequests([
    { ...bareLegacy, headRefName: 123 },
  ]), /branch\/API response field/)
  assert.throws(() => discoverContentPointerPullRequests([
    { ...bareLegacy, headRefName: 'automation/content-pointer-not-a-sha' },
  ]), /invalid branch name/)
  assert.throws(() => discoverContentPointerPullRequests([
    { ...bareLegacy, headRepository: null },
  ]), /invalid API response fields/)

  const bareContentUpdate = {
    ...bareLegacy,
    number: 48,
    url: 'https://github.com/fredrik-hellmangroup/cv-online-presenter/pull/48',
    headRefName: 'automation/content-update',
  }
  assert.deepEqual(discoverContentPointerPullRequests([bareContentUpdate]), [bareContentUpdate])
  assert.throws(() => discoverContentPointerPullRequests([
    { ...bareContentUpdate, baseRefName: 'release' },
  ]), /invalid API response fields/)
})

test('uses main-to-candidate ancestry direction for lifecycle decisions', () => {
  const candidateSha = '8'.repeat(40)
  const olderPointer = '7'.repeat(40)
  const forwardResult = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(46, olderPointer, {
        relationToMain: 'forward',
        relationToCandidate: 'older',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(forwardResult, {
    action: 'create',
    closeNumbers: [46],
    pullRequestNumber: '',
    preserveNumber: '',
  })

  const olderResult = decideContentPointerLifecycle({
    candidateSha: olderPointer,
    candidateRelationToMain: 'older',
    openPullRequests: [
      openPointer(47, candidateSha, {
        relationToMain: 'forward',
        relationToCandidate: 'forward',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(olderResult, {
    action: 'noop',
    closeNumbers: [],
    pullRequestNumber: '',
    preserveNumber: 47,
  })
})

test('rejects non-string candidate SHAs and branch names before regex matching', () => {
  const args = {
    candidateSha: '7'.repeat(40),
    candidateRelationToMain: 'forward',
    openPullRequests: [],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  }
  for (const candidateSha of [123, {}, null]) {
    assert.throws(() => decideContentPointerLifecycle({
      ...args,
      candidateSha,
    }), /full lowercase 40-character SHA/)
  }
  assert.throws(() => decideContentPointerLifecycle({
    ...args,
    openPullRequests: [openPointer(43, args.candidateSha, { branchName: 123 })],
  }), /invalid content-pointer ref or diff/)
})

test('preserves a newer open candidate and no-ops for a duplicate candidate', () => {
  const candidateSha = 'e'.repeat(40)
  const newerSha = 'f'.repeat(40)
  const result = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(21, newerSha, {
        relationToCandidate: 'forward',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })

  test('preserves a newer legacy content-update candidate over a delayed dispatch', () => {
    const dispatchSha = 'b'.repeat(40)
    const newerLegacySha = 'c'.repeat(40)
    const result = decideContentPointerLifecycle({
      candidateSha: dispatchSha,
      candidateRelationToMain: 'forward',
      openPullRequests: [
        openPointer(52, newerLegacySha, {
          branchName: `automation/content-update-${newerLegacySha}`,
          relationToCandidate: 'forward',
        }),
      ],
      closedCandidatePullRequests: [],
      reopenRequest: { requested: false, pullRequest: '' },
    })
    assert.deepEqual(result, {
      action: 'noop',
      closeNumbers: [],
      pullRequestNumber: '',
      preserveNumber: 52,
    })
  })
  assert.deepEqual(result, {
    action: 'noop',
    closeNumbers: [],
    pullRequestNumber: '',
    preserveNumber: 21,
  })

  const withOlderOpen = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(23, '2'.repeat(40), {
        relationToCandidate: 'older',
        relationToOthers: { 24: 'older' },
      }),
      openPointer(24, newerSha, {
        relationToCandidate: 'forward',
        relationToOthers: { 23: 'forward' },
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(withOlderOpen, {
    action: 'noop',
    closeNumbers: [23],
    pullRequestNumber: '',
    preserveNumber: 24,
  })

  const duplicateResult = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(22, candidateSha, {
        relationToCandidate: 'identical',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.equal(duplicateResult.action, 'noop')
  assert.equal(duplicateResult.preserveNumber, 22)
})

test('reconciles legacy content-update PRs without retaining duplicates or stale candidates', () => {
  const candidateSha = '3'.repeat(40)
  const olderSha = '2'.repeat(40)
  const result = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(25, candidateSha, {
        branchName: `automation/content-update-${candidateSha}`,
        relationToCandidate: 'identical',
        relationToOthers: { 26: 'identical' },
        createdAt: '2026-10-31T12:00:00Z',
      }),
      openPointer(26, candidateSha, {
        relationToCandidate: 'identical',
        relationToOthers: { 25: 'identical' },
        createdAt: '2026-10-31T13:00:00Z',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })

  assert.deepEqual(result, {
    action: 'noop',
    closeNumbers: [25],
    pullRequestNumber: '',
    preserveNumber: 26,
  })

  const staleResult = decideContentPointerLifecycle({
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [
      openPointer(27, olderSha, {
        branchName: `automation/content-update-${olderSha}`,
        relationToCandidate: 'older',
      }),
    ],
    closedCandidatePullRequests: [],
    reopenRequest: { requested: false, pullRequest: '' },
  })
  assert.deepEqual(staleResult, {
    action: 'create',
    closeNumbers: [27],
    pullRequestNumber: '',
    preserveNumber: '',
  })
})

test('keeps same-SHA closed unmerged PRs closed unless explicitly reopened by exact number', () => {
  const candidateSha = '1'.repeat(40)
  const closed = {
    number: 31,
    url: 'https://github.com/fredrik-hellmangroup/cv-online-presenter/pull/31',
    branchName: `automation/content-pointer-${candidateSha}`,
    mergedAt: null,
  }
  const args = {
    candidateSha,
    candidateRelationToMain: 'forward',
    openPullRequests: [],
    closedCandidatePullRequests: [closed],
  }
  assert.throws(() => decideContentPointerLifecycle({
    ...args,
    reopenRequest: { requested: false, pullRequest: '' },
  }), /remains closed.*app_pr_number=31/)
  assert.throws(() => decideContentPointerLifecycle({
    ...args,
    reopenRequest: { requested: true, pullRequest: 32 },
  }), /exact app_pr_number/)
  assert.deepEqual(decideContentPointerLifecycle({
    ...args,
    reopenRequest: { requested: true, pullRequest: 31 },
  }), {
    action: 'reopen',
    closeNumbers: [],
    pullRequestNumber: 31,
    preserveNumber: '',
  })
  assert.throws(() => decideContentPointerLifecycle({
    ...args,
    closedCandidatePullRequests: [{
      ...closed,
      branchName: `automation/content-update-${candidateSha}`,
    }],
    reopenRequest: { requested: true, pullRequest: 31 },
  }), /Legacy app PR .*cannot be reopened/)
})
