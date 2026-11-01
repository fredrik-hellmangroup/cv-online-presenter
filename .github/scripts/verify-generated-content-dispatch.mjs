import { appendFile, readFile } from 'node:fs/promises'

export const CONTENT_REPOSITORY = 'fredrik-hellmangroup/cv-online-presenter-content'
export const APP_REPOSITORY = 'fredrik-hellmangroup/cv-online-presenter'
export const CONTENT_SUBMODULE_URL = 'https://github.com/fredrik-hellmangroup/cv-online-presenter-content.git'
export const GENERATED_CONTENT_PATHS = new Set([
  'content/pages/cv.md',
  'content/pages/home.md',
  'content/pages/projects.md',
  'content/pages/projects/asira.md',
  'content/pages/projects/nordhem.md',
  'content/pages/projects/stockholmsmassan.md',
  'content/pages/services.md',
  'content/generated-provenance.json',
])

const apiBase = 'https://api.github.com'
const shaPattern = /^[0-9a-f]{40}$/i
const safeEndpointPattern = /^\/repos\/fredrik-hellmangroup\/cv-online-presenter(?:-content)?\/(?:pulls(?:\/[1-9]\d*(?:\/files)?)?|contents\/content|compare\/\{[a-z-]+\}\.\.\.\{?[a-z-]*\}?)$/
const retryDelaysMs = [250, 750]
const maxRetryDelayMs = 60_000
const pullRequestPageSize = 100
const maxPullRequestPages = 30

class ApiRequestError extends Error {
  constructor(endpoint, { status, reason = 'request failed' } = {}) {
    const safeEndpoint = typeof endpoint === 'string' && safeEndpointPattern.test(endpoint)
      ? endpoint
      : 'the requested endpoint'
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    const safeReason = [
      'timed out',
      'temporarily unavailable',
      'returned invalid JSON',
      'rate limit window exceeds the safe retry bound',
      'server retry delay exceeds the safe retry bound',
    ].includes(reason)
      ? reason
      : 'request failed'
    const rateLimitWindowExceeded = safeReason === 'rate limit window exceeds the safe retry bound'
    let message
    if (rateLimitWindowExceeded) {
      message = `GitHub API rate limit remains active beyond the ${maxRetryDelayMs / 1_000}-second retry window for ${safeEndpoint}; rerun this workflow after the rate limit resets.`
    } else if (safeReason === 'server retry delay exceeds the safe retry bound') {
      message = `GitHub API requested a retry delay beyond the ${maxRetryDelayMs / 1_000}-second retry window for ${safeEndpoint}; rerun this workflow later.`
    } else if (safeStatus) {
      message = `GitHub API request failed (HTTP ${safeStatus}) for ${safeEndpoint}; check API access or retry the workflow.`
    } else {
      message = `GitHub API ${safeReason} for ${safeEndpoint} after bounded retries; retry the workflow and check API availability.`
    }
    super(message)
    this.endpoint = safeEndpoint
    this.status = safeStatus
    this.rateLimitWindowExceeded = rateLimitWindowExceeded
  }
}

class LatestDiscoveryError extends Error {}

function latestDiscoveryError(message) {
  return new LatestDiscoveryError(message)
}

export function isAllowedChangedFile(path) {
  return GENERATED_CONTENT_PATHS.has(path)
}

export function isAllowedChangedFileChange(file) {
  return (
    isAllowedChangedFile(file.filename) &&
    (file.previous_filename === undefined || isAllowedChangedFile(file.previous_filename))
  )
}

export function assertPullRequestContract(pr, { headSha, mergeSha, number } = {}) {
  if (
    !pr ||
    pr.state !== 'closed' ||
    pr.merged !== true ||
    typeof pr.merged_at !== 'string' ||
    pr.merged_at.trim().length === 0
  ) {
    throw new Error('The content pull request must be merged.')
  }
  if (
    typeof pr.base?.repo?.full_name !== 'string' ||
    pr.base.repo.full_name.toLowerCase() !== CONTENT_REPOSITORY ||
    typeof pr.base.ref !== 'string' ||
    pr.base.ref !== 'main'
  ) {
    throw new Error(`The content pull request must target ${CONTENT_REPOSITORY}:main.`)
  }
  if (
    typeof pr.head?.repo?.full_name !== 'string' ||
    pr.head.repo.full_name.toLowerCase() !== CONTENT_REPOSITORY ||
    typeof pr.head.ref !== 'string' ||
    pr.head.ref !== 'automation/generated-content'
  ) {
    throw new Error(`The content pull request must come from ${CONTENT_REPOSITORY}:automation/generated-content.`)
  }
  if (
    typeof pr.head.sha !== 'string' ||
    !shaPattern.test(pr.head.sha) ||
    typeof pr.merge_commit_sha !== 'string' ||
    !shaPattern.test(pr.merge_commit_sha)
  ) {
    throw new Error('GitHub did not provide full 40-character head and merge commit SHAs.')
  }
  if (
    !Number.isSafeInteger(pr.number) ||
    pr.number < 1 ||
    (number !== undefined && pr.number !== number) ||
    typeof pr.html_url !== 'string' ||
    pr.html_url !== `https://github.com/${CONTENT_REPOSITORY}/pull/${pr.number}`
  ) {
    throw new Error('The content pull request URL must match its number on the expected GitHub repository.')
  }
  if (headSha && pr.head.sha.toLowerCase() !== headSha.toLowerCase()) {
    throw new Error('The dispatch head_sha does not match the authoritative pull request head SHA.')
  }
  if (mergeSha && pr.merge_commit_sha.toLowerCase() !== mergeSha.toLowerCase()) {
    throw new Error('The dispatch merge_commit_sha does not match the authoritative pull request merge SHA.')
  }
  if (!pr.labels?.some((label) => label.name === 'generated-content')) {
    throw new Error('The content pull request must have the \'generated-content\' label.')
  }
}

function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cv-online-presenter-content-reconciler',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function isRetryableResponse(response) {
  return response.status === 429 ||
    (response.status >= 500 && response.status <= 599) ||
    response.status === 403
}

function retryAfterDelay(response) {
  const retryAfter = response?.headers.get('retry-after')
  if (retryAfter !== null && retryAfter !== undefined && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000
    }
  } else if (retryAfter !== null && retryAfter !== undefined) {
    const retryAt = Date.parse(retryAfter)
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now())
    }
  }
  return undefined
}

function rateLimitResetDelay(response) {
  const resetHeader = response?.headers.get('x-ratelimit-reset')
  if (resetHeader === null || resetHeader === undefined || !/^\d+(?:\.\d+)?$/.test(resetHeader.trim())) {
    return undefined
  }
  const resetAt = Number(resetHeader)
  return Number.isFinite(resetAt) && resetAt > 0
    ? Math.max(0, resetAt * 1_000 - Date.now())
    : undefined
}

function isRateLimitedResponse(response) {
  const primaryLimitExhausted = response.headers.get('x-ratelimit-remaining') === '0'
  return response.status === 429 ||
    (response.status === 403 && (
      primaryLimitExhausted ||
      retryAfterDelay(response) !== undefined ||
      (primaryLimitExhausted && rateLimitResetDelay(response) !== undefined)
    ))
}

function retryDelay(response, attempt) {
  const retryAfter = retryAfterDelay(response)
  const primaryLimitExhausted = response.headers.get('x-ratelimit-remaining') === '0'
  const reset = primaryLimitExhausted && [403, 429].includes(response.status)
    ? rateLimitResetDelay(response)
    : undefined
  const serverDelays = [retryAfter, reset].filter((delay) => delay !== undefined)
  return serverDelays.length > 0
    ? Math.max(...serverDelays)
    : retryDelaysMs[attempt] ?? retryDelaysMs.at(-1)
}

async function discardResponse(response) {
  try {
    await response.body?.cancel()
  } catch {
    // The response body is discarded only to avoid retaining an unused error payload.
  }
}

export async function getJson(url, token, endpoint) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let response
    try {
      response = await fetch(url, {
        headers: apiHeaders(token),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      if (attempt === retryDelaysMs.length) {
        const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? 'timed out'
          : 'temporarily unavailable'
        throw new ApiRequestError(endpoint, { reason })
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]))
      continue
    }

    if (!response.ok) {
      const status = Number.isInteger(response.status) ? response.status : undefined
      const shouldRetry = isRetryableResponse(response) && attempt < retryDelaysMs.length
      const rateLimited = isRateLimitedResponse(response)
      const requestedDelay = isRetryableResponse(response) &&
        (retryAfterDelay(response) !== undefined ||
        (response.headers.get('x-ratelimit-remaining') === '0' &&
          [403, 429].includes(response.status) &&
          rateLimitResetDelay(response) !== undefined))
      const delay = retryDelay(response, attempt)
      await discardResponse(response)
      if (delay > maxRetryDelayMs) {
        throw new ApiRequestError(endpoint, {
          status,
          reason: rateLimited
            ? 'rate limit window exceeds the safe retry bound'
            : requestedDelay
              ? 'server retry delay exceeds the safe retry bound'
              : 'request failed',
        })
      }
      if (shouldRetry) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw new ApiRequestError(endpoint, { status })
    }

    try {
      return await response.json()
    } catch {
      throw new ApiRequestError(endpoint, { status: response.status, reason: 'returned invalid JSON' })
    }
  }
  throw new ApiRequestError(endpoint, { reason: 'temporarily unavailable' })
}

async function getChangedFiles(number, token) {
  const files = []
  for (let page = 1; page <= 30; page += 1) {
    const pageFiles = await getJson(
      `${apiBase}/repos/${CONTENT_REPOSITORY}/pulls/${number}/files?per_page=100&page=${page}`,
      token,
      `/repos/${CONTENT_REPOSITORY}/pulls/${number}/files`,
    )
    if (!Array.isArray(pageFiles)) {
      throw latestDiscoveryError(`GitHub returned an invalid changed-files response for content PR #${number}; rerun reconciliation.`)
    }
    files.push(...pageFiles)
    if (pageFiles.length < 100) return files
  }
  throw latestDiscoveryError(`Changed-file listing for content PR #${number} exceeded the 3,000-file safety limit; latest eligible content cannot be proven. Rerun reconciliation.`)
}

export async function getClosedPullRequests(token) {
  const pullRequests = []
  for (let page = 1; page <= maxPullRequestPages; page += 1) {
    const pagePullRequests = await getJson(
      `${apiBase}/repos/${CONTENT_REPOSITORY}/pulls?state=closed&base=main&sort=created&direction=desc&per_page=${pullRequestPageSize}&page=${page}`,
      token,
      `/repos/${CONTENT_REPOSITORY}/pulls`,
    )
    if (!Array.isArray(pagePullRequests) || pagePullRequests.length > pullRequestPageSize) {
      throw latestDiscoveryError('GitHub returned an invalid closed pull-request listing; rerun reconciliation after checking API availability.')
    }
    const seenNumbers = new Set(pullRequests.map((pr) => pr?.number))
    for (const pr of pagePullRequests) {
      if (!Number.isSafeInteger(pr?.number) || pr.number < 1) {
        throw latestDiscoveryError('GitHub returned a closed pull request without a valid number; latest eligible content cannot be proven. Rerun reconciliation.')
      }
      if (seenNumbers.has(pr.number)) {
        throw latestDiscoveryError('Closed pull-request pagination changed while being read; latest eligible content cannot be proven. Rerun reconciliation.')
      }
      seenNumbers.add(pr.number)
    }
    pullRequests.push(...pagePullRequests)
    if (pagePullRequests.length < pullRequestPageSize) return pullRequests
  }
  throw latestDiscoveryError(`Closed pull-request discovery reached its ${pullRequestPageSize * maxPullRequestPages}-PR safety limit; latest eligible content cannot be proven. Rerun after reviewing the content PR history.`)
}

async function getEvent(eventPath) {
  return JSON.parse(await readFile(eventPath, 'utf8'))
}

function sourcePrNumber(eventName, event) {
  if (eventName === 'repository_dispatch') {
    const payload = event.client_payload
    if (!payload || payload.content_repository !== CONTENT_REPOSITORY) {
      throw new Error(`Dispatch content_repository must equal ${CONTENT_REPOSITORY}.`)
    }
    if (!Number.isSafeInteger(payload.pr_number) || payload.pr_number < 1) {
      throw new Error('Dispatch pr_number must be a positive integer.')
    }
    if (
      typeof payload.head_sha !== 'string' ||
      !shaPattern.test(payload.head_sha) ||
      typeof payload.merge_commit_sha !== 'string' ||
      !shaPattern.test(payload.merge_commit_sha)
    ) {
      throw new Error('Dispatch head_sha and merge_commit_sha must be full 40-character SHAs.')
    }
    return {
      number: payload.pr_number,
      headSha: payload.head_sha,
      mergeSha: payload.merge_commit_sha,
    }
  }
  if (eventName === 'workflow_dispatch') {
    const number = Number(event.inputs?.pr_number)
    if (!Number.isSafeInteger(number) || number < 1 || String(number) !== String(event.inputs?.pr_number)) {
      throw new Error('Manual recovery requires a positive integer content pr_number.')
    }
    return { number, headSha: undefined, mergeSha: undefined }
  }
  throw new Error('Unsupported event type.')
}

export function assertContentSubmoduleResponse(submodule) {
  if (
    !submodule ||
    submodule.type !== 'file' ||
    submodule.submodule_git_url !== CONTENT_SUBMODULE_URL ||
    typeof submodule.sha !== 'string' ||
    !shaPattern.test(submodule.sha)
  ) {
    throw new Error('The app main content entry is not a valid Git submodule gitlink.')
  }
  return submodule.sha.toLowerCase()
}

async function currentAppContentSha(token) {
  const submodule = await getJson(
    `${apiBase}/repos/${APP_REPOSITORY}/contents/content?ref=main`,
    token,
    `/repos/${APP_REPOSITORY}/contents/content`,
  )
  return assertContentSubmoduleResponse(submodule)
}

function validatePullRequestListingRecord(pr) {
  if (
    !pr ||
    !Number.isSafeInteger(pr.number) ||
    pr.number < 1 ||
    pr.state !== 'closed' ||
    (pr.merged_at !== null && (typeof pr.merged_at !== 'string' || !Number.isFinite(Date.parse(pr.merged_at)))) ||
    typeof pr.head?.repo?.full_name !== 'string' ||
    typeof pr.head?.ref !== 'string' ||
    typeof pr.head?.sha !== 'string' ||
    !shaPattern.test(pr.head.sha) ||
    typeof pr.base?.repo?.full_name !== 'string' ||
    typeof pr.base?.ref !== 'string' ||
    !Array.isArray(pr.labels) ||
    pr.labels.some((label) => typeof label?.name !== 'string')
  ) {
    throw latestDiscoveryError('GitHub returned incomplete closed pull-request data; latest eligible content cannot be proven. Rerun reconciliation.')
  }
  if (pr.merged_at !== null && (typeof pr.merge_commit_sha !== 'string' || !shaPattern.test(pr.merge_commit_sha))) {
    throw latestDiscoveryError('GitHub omitted a merged pull-request commit SHA; latest eligible content cannot be proven. Rerun reconciliation.')
  }
}

function isGeneratedContentListingCandidate(pr) {
  return pr.merged_at !== null &&
    pr.base.repo.full_name.toLowerCase() === CONTENT_REPOSITORY &&
    pr.base.ref === 'main' &&
    pr.head.repo.full_name.toLowerCase() === CONTENT_REPOSITORY &&
    pr.head.ref === 'automation/generated-content' &&
    pr.labels.some((label) => label.name === 'generated-content')
}

function assertListingMatchesPullRequest(listed, pullRequest) {
  if (
    listed.number !== pullRequest.number ||
    listed.merged_at !== pullRequest.merged_at ||
    listed.head.sha.toLowerCase() !== pullRequest.head.sha.toLowerCase() ||
    listed.merge_commit_sha.toLowerCase() !== pullRequest.merge_commit_sha.toLowerCase() ||
    listed.head.ref !== pullRequest.head.ref ||
    listed.head.repo.full_name.toLowerCase() !== pullRequest.head.repo.full_name.toLowerCase() ||
    listed.base.ref !== pullRequest.base.ref ||
    listed.base.repo.full_name.toLowerCase() !== pullRequest.base.repo.full_name.toLowerCase() ||
    !listed.labels.some((label) => label.name === 'generated-content')
  ) {
    throw latestDiscoveryError(`GitHub returned inconsistent data for content PR #${listed.number}; latest eligible content cannot be proven. Rerun reconciliation.`)
  }
}

async function verifyListedCandidate(listed, token) {
  const pr = await getJson(
    `${apiBase}/repos/${CONTENT_REPOSITORY}/pulls/${listed.number}`,
    token,
    `/repos/${CONTENT_REPOSITORY}/pulls/${listed.number}`,
  )
  try {
    assertPullRequestContract(pr, { number: listed.number })
  } catch {
    throw latestDiscoveryError(`GitHub could not reverify listed content PR #${listed.number}; latest eligible content cannot be proven. Rerun reconciliation.`)
  }
  assertListingMatchesPullRequest(listed, pr)

  const files = await getChangedFiles(listed.number, token)
  if (!Array.isArray(files) || files.length === 0) return undefined
  for (const file of files) {
    if (
      !file ||
      typeof file.filename !== 'string' ||
      file.filename.length === 0 ||
      (file.previous_filename !== undefined && typeof file.previous_filename !== 'string')
    ) {
      throw latestDiscoveryError(`GitHub returned incomplete changed-file data for content PR #${listed.number}; latest eligible content cannot be proven. Rerun reconciliation.`)
    }
  }
  if (files.some((file) => !isAllowedChangedFileChange(file))) return undefined

  const mergeSha = pr.merge_commit_sha.toLowerCase()
  const reachability = await getJson(
    `${apiBase}/repos/${CONTENT_REPOSITORY}/compare/${mergeSha}...main`,
    token,
    `/repos/${CONTENT_REPOSITORY}/compare/{commit}...main`,
  )
  let reachabilityRelation
  try {
    reachabilityRelation = classifyContentProgression(reachability)
  } catch {
    throw latestDiscoveryError(`GitHub returned incomplete merge reachability for content PR #${listed.number}; latest eligible content cannot be proven. Rerun reconciliation.`)
  }
  if (reachabilityRelation !== 'forward' && reachabilityRelation !== 'identical') {
    throw latestDiscoveryError(`Merged content PR #${listed.number} is not reachable from content main; latest eligible content cannot be proven. Rerun reconciliation after content main is repaired.`)
  }
  return {
    number: pr.number,
    headSha: pr.head.sha.toLowerCase(),
    mergeSha,
    mergedAt: pr.merged_at,
    url: pr.html_url,
    changedFiles: files.map((file) => file.filename),
  }
}

export async function discoverLatestEligiblePullRequest(eventResult, token) {
  const pullRequests = await getClosedPullRequests(token)
  const candidates = []
  let eventListing
  for (const pr of pullRequests) {
    validatePullRequestListingRecord(pr)
    if (pr.number === eventResult.number) eventListing = pr
    if (isGeneratedContentListingCandidate(pr)) candidates.push(pr)
  }

  if (!eventListing || !isGeneratedContentListingCandidate(eventListing)) {
    throw latestDiscoveryError(`Referenced content PR #${eventResult.number} is absent from the complete merged-PR listing; latest eligible content cannot be proven. Rerun reconciliation.`)
  }
  if (
    eventListing.head.sha.toLowerCase() !== eventResult.headSha ||
    eventListing.merge_commit_sha.toLowerCase() !== eventResult.mergeSha ||
    eventListing.merged_at !== eventResult.mergedAt
  ) {
    throw latestDiscoveryError(`Referenced content PR #${eventResult.number} changed during reconciliation; rerun the workflow.`)
  }

  candidates.sort((left, right) =>
    Date.parse(right.merged_at) - Date.parse(left.merged_at) || right.number - left.number,
  )
  for (const candidate of candidates) {
    const verified = await verifyListedCandidate(candidate, token)
    if (verified) return verified
  }
  throw latestDiscoveryError('No eligible merged generated-content PR could be proven from the complete listing; rerun reconciliation after checking content PR history.')
}

export function classifyContentProgression(comparison) {
  if (
    !comparison ||
    !Number.isSafeInteger(comparison.ahead_by) ||
    comparison.ahead_by < 0 ||
    !Number.isSafeInteger(comparison.behind_by) ||
    comparison.behind_by < 0
  ) {
    throw new Error('GitHub returned invalid compare ahead_by or behind_by counts.')
  }
  if (
    comparison.status === 'identical' &&
    comparison.ahead_by === 0 &&
    comparison.behind_by === 0
  ) {
    return 'identical'
  }
  if (comparison.status === 'ahead' && comparison.ahead_by > 0 && comparison.behind_by === 0) {
    return 'forward'
  }
  if (comparison.status === 'behind' && comparison.ahead_by === 0 && comparison.behind_by > 0) {
    return 'older'
  }
  throw new Error('Cannot prove the requested content commit is a descendant of the current pointer.')
}

export function parseReopenRequest(eventName, event) {
  const requested = eventName === 'workflow_dispatch' &&
    (event.inputs?.reopen_closed === true || event.inputs?.reopen_closed === 'true')
  const rawMarkReady = event.inputs?.mark_ready
  const markReadyRequested = eventName === 'workflow_dispatch' &&
    (rawMarkReady === true || rawMarkReady === 'true')
  if (
    rawMarkReady !== undefined &&
    rawMarkReady !== '' &&
    rawMarkReady !== true &&
    rawMarkReady !== false &&
    rawMarkReady !== 'true' &&
    rawMarkReady !== 'false'
  ) {
    throw new Error('mark_ready must be a boolean.')
  }
  if (markReadyRequested && !requested) {
    throw new Error('mark_ready may only be supplied with reopen_closed=true.')
  }
  const rawPullRequest = event.inputs?.app_pr_number
  if (!requested) {
    if (rawPullRequest !== undefined && rawPullRequest !== '') {
      throw new Error('app_pr_number may only be supplied with reopen_closed=true.')
    }
    return { requested: false, pullRequest: '', markReady: false }
  }
  const pullRequest = Number(rawPullRequest)
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1 || String(pullRequest) !== String(rawPullRequest)) {
    throw new Error('Reopening a closed app PR requires its positive app_pr_number.')
  }
  return { requested: true, pullRequest, markReady: markReadyRequested }
}

async function verifyEventPullRequest(eventName, event, token) {
  const source = sourcePrNumber(eventName, event)
  const pr = await getJson(
    `${apiBase}/repos/${CONTENT_REPOSITORY}/pulls/${source.number}`,
    token,
    `/repos/${CONTENT_REPOSITORY}/pulls/${source.number}`,
  )
  assertPullRequestContract(pr, { ...source, number: source.number })

  const files = await getChangedFiles(source.number, token)
  if (files.length === 0) throw new Error('The generated-content pull request has no changed files.')
  const disallowed = files.flatMap((file) => {
    const paths = [file.filename]
    if (file.previous_filename !== undefined) paths.push(file.previous_filename)
    return paths.filter((path) => !isAllowedChangedFile(path))
  })
  if (disallowed.length) {
    throw new Error('The content pull request contains files outside the generator allowlist.')
  }

  const mergeSha = pr.merge_commit_sha.toLowerCase()
  const reachability = await getJson(
    `${apiBase}/repos/${CONTENT_REPOSITORY}/compare/${mergeSha}...main`,
    token,
    `/repos/${CONTENT_REPOSITORY}/compare/{commit}...main`,
  )
  const reachabilityRelation = classifyContentProgression(reachability)
  if (reachabilityRelation !== 'forward' && reachabilityRelation !== 'identical') {
    throw new Error('The content PR merge commit is not reachable from content main.')
  }

  const reopenRequest = parseReopenRequest(eventName, event)

  return {
    number: source.number,
    headSha: pr.head.sha.toLowerCase(),
    mergeSha,
    mergedAt: pr.merged_at,
    reopenClosed: reopenRequest.requested,
    reopenPrNumber: reopenRequest.pullRequest,
    markReady: reopenRequest.markReady,
    url: pr.html_url,
    changedFiles: files.map((file) => file.filename),
  }
}

async function verify(eventName, event, token, discoverLatest = false) {
  const eventResult = await verifyEventPullRequest(eventName, event, token)
  const latest = discoverLatest ? await discoverLatestEligiblePullRequest(eventResult, token) : eventResult
  const appContentSha = await currentAppContentSha(token)
  const progression = await getJson(
    `${apiBase}/repos/${CONTENT_REPOSITORY}/compare/${appContentSha}...${latest.mergeSha}`,
    token,
    `/repos/${CONTENT_REPOSITORY}/compare/{app-content-commit}...{merge-commit}`,
  )
  const mainRelation = classifyContentProgression(progression)
  return {
    ...latest,
    appContentSha,
    noChange: mainRelation !== 'forward',
    reopenClosed: eventResult.reopenClosed,
    reopenPrNumber: eventResult.reopenPrNumber,
    markReady: eventResult.markReady,
  }
}

export function writeOutput(name, value) {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
    typeof value !== 'string' ||
    /[\r\n]/.test(name) ||
    /[\r\n]/.test(value)
  ) {
    throw new Error('GitHub output names and values must be valid strings without CR or LF characters.')
  }
  if (!process.env.GITHUB_OUTPUT) return
  return appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8')
}

export function formatSummary(result, error) {
  const lines = [
    '## Generated content reconciliation — verification',
    '',
    error ? '**Result:** Failed — verification failed.' : '**Result:** Verified.',
  ]
  if (error instanceof ApiRequestError) {
    if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) {
      lines.push(`- GitHub API status: HTTP ${error.status}`)
    }
    if (
      typeof error.endpoint === 'string' &&
      safeEndpointPattern.test(error.endpoint)
    ) {
      lines.push(`- Endpoint: \`${error.endpoint}\``)
    }
    lines.push('- Check API access or retry the workflow if the failure is transient.')
    if (error.rateLimitWindowExceeded) {
      lines.push(`- Wait for the GitHub API rate limit to reset, then rerun this workflow; automatic waits are capped at ${maxRetryDelayMs / 1_000} seconds.`)
    }
  }
  if (result) {
    lines.push(
      `- Content PR: [#${result.number}](${result.url})`,
      `- Merged content commit: \`${result.mergeSha}\``,
      `- App main content pointer: \`${result.appContentSha}\``,
      `- Changed files: ${result.changedFiles.map((path) => `\`${path}\``).join(', ')}`,
      `- Reconciliation: ${result.noChange ? 'not needed; already current' : 'forward update'}`,
    )
  }
  if (error instanceof LatestDiscoveryError) {
    lines.push('- Action: review the completed-listing safety/data failure, then rerun this workflow.')
  }
  if (error) lines.push('', 'Verification does not write repository content.')
  return `${lines.join('\n')}\n`
}

async function writeSummary(result, error) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  await appendFile(process.env.GITHUB_STEP_SUMMARY, formatSummary(result, error), 'utf8')
}

async function main() {
  let result
  let error
  try {
    const eventName = process.env.GITHUB_EVENT_NAME
    const event = await getEvent(process.env.GITHUB_EVENT_PATH)
    result = await verify(
      eventName,
      event,
      process.env.GH_TOKEN,
      process.env.VERIFY_LATEST === 'true',
    )
    await writeOutput('pr_number', String(result.number))
    await writeOutput('head_sha', result.headSha)
    await writeOutput('merge_sha', result.mergeSha)
    await writeOutput('no_change', String(result.noChange))
    await writeOutput('reopen_closed', String(result.reopenClosed))
    await writeOutput('reopen_pr_number', String(result.reopenPrNumber))
    await writeOutput('mark_ready', String(result.markReady))
    await writeOutput('source_pr_url', result.url)
    await writeOutput('candidate_pr_number', String(result.number))
    await writeOutput('candidate_head_sha', result.headSha)
    await writeOutput('candidate_merge_sha', result.mergeSha)
    await writeOutput('candidate_pr_url', result.url)
    console.log(`Verified content PR #${result.number}, merge ${result.mergeSha}.`)
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error('Verification failed.')
    console.error(
      error instanceof ApiRequestError || error instanceof LatestDiscoveryError
        ? error.message
        : 'Verification failed; inspect the step logs.',
    )
  }
  await writeSummary(result, error)
  if (error) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main()
}
