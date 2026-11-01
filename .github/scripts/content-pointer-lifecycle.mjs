const shaPattern = /^[0-9a-f]{40}$/
const relations = new Set(['forward', 'older', 'identical'])

function isContentPointerBranchName(branchName) {
  if (typeof branchName !== 'string' || branchName.length === 0) {
    throw new Error('Open pull request has an invalid branch/API response field.')
  }
  if (
    branchName === 'automation/content-pointer' ||
    branchName === 'automation/content-update'
  ) {
    return true
  }
  if (
    !branchName.startsWith('automation/content-pointer-') &&
    !branchName.startsWith('automation/content-update-')
  ) {
    return false
  }
  return /^automation\/content-(pointer|update)-[0-9a-f]{40}$/.test(branchName)
}

export function discoverContentPointerPullRequests(openPullRequests) {
  if (!Array.isArray(openPullRequests)) {
    throw new Error('Open pull-request listing is invalid.')
  }

  return openPullRequests.filter((pr) => {
    const branchName = pr?.headRefName
    if (typeof branchName !== 'string' || branchName.length === 0) {
      throw new Error('Open pull request has an invalid branch/API response field.')
    }
    const candidateBranch =
      branchName === 'automation/content-pointer' ||
      branchName === 'automation/content-update' ||
      branchName.startsWith('automation/content-pointer-') ||
      branchName.startsWith('automation/content-update-')
    if (!candidateBranch) {
      return false
    }

    if (!isContentPointerBranchName(branchName)) {
      throw new Error(`Open content-pointer PR has an invalid branch name: ${branchName}.`)
    }
    if (
      !Number.isSafeInteger(pr.number) ||
      pr.number < 1 ||
      typeof pr.url !== 'string' ||
      pr.url.length === 0 ||
      pr.baseRefName !== 'main' ||
      typeof pr.headRepository?.nameWithOwner !== 'string' ||
      pr.headRepository.nameWithOwner.length === 0 ||
      typeof pr.createdAt !== 'string' ||
      pr.createdAt.length === 0
    ) {
      throw new Error(`Open content-pointer PR #${pr.number ?? '?'} has invalid API response fields.`)
    }
    return true
  })
}

function assertRelation(value, description) {
  if (!relations.has(value)) {
    throw new Error(`Cannot prove a linear content relationship for ${description}.`)
  }
}

function isRecognizedBranch(branchName, contentSha) {
  if (typeof branchName !== 'string') return false
  if (branchName === 'automation/content-pointer' || branchName === 'automation/content-update') return true
  if (typeof contentSha !== 'string') return false
  const match = /^automation\/content-(pointer|update)-([0-9a-f]{40})$/.exec(branchName)
  return Boolean(match && match[2] === contentSha)
}

function isLegacyStableBranch(branchName) {
  return branchName === 'automation/content-pointer' || branchName === 'automation/content-update'
}

export function decideContentPointerLifecycle({
  candidateSha,
  candidateRelationToMain,
  openPullRequests,
  closedCandidatePullRequests,
  reopenRequest,
}) {
  if (typeof candidateSha !== 'string' || !shaPattern.test(candidateSha)) {
    throw new Error('The requested content candidate must be a full lowercase 40-character SHA.')
  }
  assertRelation(candidateRelationToMain, 'the requested candidate and app main')
  if (!Array.isArray(openPullRequests) || !Array.isArray(closedCandidatePullRequests)) {
    throw new Error('Pull-request listings are invalid.')
  }

  for (const pr of openPullRequests) {
    if (
      !pr ||
      typeof pr !== 'object' ||
      !Number.isSafeInteger(pr.number) ||
      typeof pr.url !== 'string' ||
      typeof pr.contentSha !== 'string' ||
      !shaPattern.test(pr.contentSha) ||
      pr.mode !== '160000' ||
      !Array.isArray(pr.diffPaths) ||
      (pr.relationToMain === 'forward' &&
        (pr.diffPaths.length !== 1 || pr.diffPaths[0] !== 'content')) ||
      (pr.relationToMain !== 'forward' &&
        (pr.diffPaths.length > 1 || (pr.diffPaths.length === 1 && pr.diffPaths[0] !== 'content'))) ||
      !isRecognizedBranch(pr.branchName, pr.contentSha)
    ) {
      throw new Error(`Open app PR #${pr.number ?? '?'} has an invalid content-pointer ref or diff.`)
    }
    assertRelation(pr.relationToMain, `app PR #${pr.number} and app main`)
    assertRelation(pr.relationToCandidate, `app PR #${pr.number} and the requested candidate`)
  }

  const sameShaClosed = closedCandidatePullRequests.filter(
    (pr) =>
      pr.mergedAt === null &&
      [`automation/content-pointer-${candidateSha}`, `automation/content-update-${candidateSha}`].includes(
        pr.branchName,
      ),
  )
  if (reopenRequest?.requested) {
    if (candidateRelationToMain !== 'forward') {
      throw new Error('A closed app PR cannot be reopened when the verified candidate is not newer than app main.')
    }
    if (sameShaClosed.length === 1 && sameShaClosed[0].branchName !== `automation/content-pointer-${candidateSha}`) {
      throw new Error(
        `Legacy app PR ${sameShaClosed[0].url} cannot be reopened; the candidate-specific branch is required.`,
      )
    }
    if (sameShaClosed.length !== 1 || sameShaClosed[0].number !== reopenRequest.pullRequest) {
      const found = sameShaClosed[0]
      throw new Error(found
        ? `Closed, unmerged app PR ${found.url} must be reopened with its exact app_pr_number.`
        : `App PR #${reopenRequest.pullRequest} is not the closed, unmerged PR for candidate ${candidateSha}.`)
    }
  } else if (sameShaClosed.length > 0) {
    throw new Error(
      `Closed, unmerged app PR ${sameShaClosed[0].url} remains closed; rerun manually with reopen_closed=true and app_pr_number=${sameShaClosed[0].number}.`,
    )
  }

  const closeNumbers = new Set(
    openPullRequests.filter((pr) => isLegacyStableBranch(pr.branchName)).map((pr) => pr.number),
  )
  const newerThanMain = openPullRequests.filter(
    (pr) => pr.relationToMain === 'forward' && !isLegacyStableBranch(pr.branchName),
  )
  for (const pr of openPullRequests) {
    if (pr.relationToMain !== 'forward') closeNumbers.add(pr.number)
  }

  let newest
  for (const pr of newerThanMain) {
    assertRelation(pr.relationToCandidate, `app PR #${pr.number} and the requested candidate`)
    if (!newest) {
      newest = pr
      continue
    }
    const relation = pr.relationToOthers?.[String(newest.number)]
    assertRelation(relation, `app PR #${pr.number} and app PR #${newest.number}`)
    if (relation === 'forward') {
      newest = pr
    } else if (relation === 'identical') {
      const prTime = Date.parse(pr.createdAt ?? '')
      const newestTime = Date.parse(newest.createdAt ?? '')
      if (!Number.isFinite(prTime) || !Number.isFinite(newestTime)) {
        throw new Error('Cannot determine which duplicate content-pointer PR is newest.')
      }
      if (prTime > newestTime || (prTime === newestTime && pr.number > newest.number)) newest = pr
    }
  }

  const candidateAdvancesPastNewest =
    candidateRelationToMain === 'forward' && newest?.relationToCandidate === 'older'
  if (candidateAdvancesPastNewest) {
    for (const pr of newerThanMain) closeNumbers.add(pr.number)
    newest = undefined
  } else {
    for (const pr of newerThanMain) {
      if (pr.number !== newest?.number) closeNumbers.add(pr.number)
    }
  }

  if (reopenRequest?.requested && newest) {
    throw new Error(`A newer open content-pointer PR ${newest.url} already exists; refusing to reopen another PR.`)
  }

  let action = 'noop'
  let pullRequestNumber = ''
  if (candidateRelationToMain === 'forward') {
    if (!newest || newest.relationToCandidate === 'older') {
      action = 'create'
    } else if (newest.relationToCandidate === 'identical') {
      action = 'noop'
    } else {
      action = 'noop'
    }
    if (reopenRequest?.requested) {
      action = 'reopen'
      pullRequestNumber = reopenRequest.pullRequest
    }
  } else if (reopenRequest?.requested) {
    throw new Error('A closed app PR cannot be reopened when the verified candidate is not newer than app main.')
  }

  return {
    action,
    closeNumbers: [...closeNumbers],
    pullRequestNumber,
    preserveNumber: newest?.number ?? '',
  }
}
