import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const readWorkflow = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
// Publishers whose actions may be referenced by an exact version tag (vX.Y.Z). Every other action must be pinned to a full commit SHA.
const VERSION_TAG_ACTION_OWNERS = new Set(['actions']);
const validation = readWorkflow('validate-content.yml');
const deployment = readWorkflow('deploy-content.yml');
const provisioning = readWorkflow('provision-activation-token.yml');
const quality = readWorkflow('quality.yml');

function getIndentedBlock(source, indentation, key) {
  const lines = source.split('\n');
  const expected = `${' '.repeat(indentation)}${key}:`;
  const start = lines.findIndex(line => line === expected);
  assert.notEqual(start, -1, `${key} block exists at indentation ${indentation}`);

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      end += 1;
      continue;
    }
    const lineIndentation = line.match(/^ */u)[0].length;
    if (lineIndentation <= indentation) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

function getSteps(job) {
  const lines = job.split('\n');
  const start = lines.findIndex(line => line === '    steps:');
  assert.notEqual(start, -1, 'job has steps');
  const steps = [];
  let current = [];

  for (const line of lines.slice(start + 1)) {
    if (/^    [A-Za-z_][A-Za-z0-9_-]*:/u.test(line)) break;
    if (/^      - /u.test(line)) {
      if (current.length > 0) steps.push(current.join('\n'));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) steps.push(current.join('\n'));
  return steps;
}

function getStep(steps, name) {
  const step = steps.find(candidate => candidate.includes(`name: ${name}`));
  assert.ok(step, `${name} step exists`);
  return step;
}

function assertRequiredInput(workflow, name) {
  const input = getIndentedBlock(workflow, 6, name);
  assert.match(input, /^        required: true$/m);
  assert.match(input, /^        type: string$/m);
}

function assertRepositoryBinding(workflow) {
  const input = getIndentedBlock(workflow, 6, 'app_repository');
  assert.match(input, /Exact owner\/repository from the caller's uses reference/);
  assert.doesNotMatch(workflow, /fredrik-hellmangroup\/cv-online-presenter/);
}

function assertRequiredSecret(workflow, name) {
  const secret = getIndentedBlock(workflow, 6, name);
  assert.match(secret, /^        required: true$/m);
}

function assertOptionalSecret(workflow, name) {
  const secret = getIndentedBlock(workflow, 6, name);
  assert.match(secret, /^        required: false$/m);
}

function assertNoAppShaInput(workflow) {
  assert.doesNotMatch(workflow, /app_sha/);
}

function assertWorkflowIdentityGuard(step) {
  assert.match(step, /WORKFLOW_REPOSITORY: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(step, /WORKFLOW_REF: \$\{\{ job\.workflow_ref \}\}/);
  assert.match(step, /WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(step, /\$env:APP_REPOSITORY -cne \$env:WORKFLOW_REPOSITORY/);
  assert.match(step, /\$env:WORKFLOW_SHA -cnotmatch '\^\[a-f0-9\]\{40\}\$'/);
  assert.match(step, /\[string\]::IsNullOrWhiteSpace\(\$env:WORKFLOW_REPOSITORY\)/);
  assert.match(step, /refs\/tags\/\(v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\)\$/);
  assert.match(step, /exact release tag such as @v0\.1\.0/);
  assert.match(step, /"APP_SHA=\$\(\$env:WORKFLOW_SHA\)" \| Out-File -FilePath \$env:GITHUB_ENV/);
  assert.match(step, /"APP_VERSION=\$\(\$ref\.Groups\[1\]\.Value\)" \| Out-File -FilePath \$env:GITHUB_ENV/);
  assert.match(step, /GitHub\.com-only; missing values on GHES fail closed/);
}

function assertAppCheckout(step) {
  assert.match(step, /^          repository: \$\{\{ inputs\.app_repository \}\}$/m);
  assert.match(step, /^          ref: \$\{\{ job\.workflow_sha \}\}$/m);
  assert.match(step, /^          fetch-depth: 0$/m);
}

function assertVerifyAppRelease(steps) {
  const verifyApp = getStep(steps, 'Verify exact application release');
  assert.match(verifyApp, /git -C app fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main "\+refs\/tags\/\$\(\$env:APP_VERSION\):refs\/tags\/\$\(\$env:APP_VERSION\)"/);
  assert.match(verifyApp, /git -C app merge-base --is-ancestor \$env:APP_SHA refs\/remotes\/origin\/main/);
  assert.match(verifyApp, /git -C app rev-parse HEAD/);
  assert.match(verifyApp, /git -C app rev-parse --verify "refs\/tags\/\$\(\$env:APP_VERSION\)\^\{commit\}"/);
  assert.match(verifyApp, /"v\$fileVersion" -cne \$env:APP_VERSION/);
}

function assertCallWorkflow(workflow) {
  assert.match(getIndentedBlock(workflow, 0, 'on'), /^  workflow_call:$/m);
}

test('reusable validation checks app identity and validates all caller content', () => {
  assertCallWorkflow(validation);
  assertRequiredInput(validation, 'app_repository');
  assertRepositoryBinding(validation);
  assertNoAppShaInput(validation);

  const steps = getSteps(getIndentedBlock(validation, 2, 'validate'));
  const validateInputs = getStep(steps, 'Validate application checkout inputs');
  assertWorkflowIdentityGuard(validateInputs);
  assert.match(validateInputs, /APP_REPOSITORY -cnotmatch '\^\[A-Za-z0-9-\]\+\/\[A-Za-z0-9._-\]\+\$'/);
  const contentCheckout = steps.find(step => step.includes('path: content-repo'));
  const appCheckout = steps.find(step => step.includes('path: app'));
  assert.ok(contentCheckout);
  assert.match(contentCheckout, /^          ref: \$\{\{ github\.sha \}\}$/m);
  assert.ok(appCheckout);
  assert.ok(steps.indexOf(validateInputs) < steps.indexOf(appCheckout), 'workflow identity is verified before app checkout');
  assertAppCheckout(appCheckout);
  assertVerifyAppRelease(steps);

  const validationSteps = [
    'Validate source and generated content',
    'Validate content with the Node.js validator',
    'Validate content with the .NET validator',
  ].map(name => steps.findIndex(step => step.includes(`name: ${name}`)));
  assert.ok(validationSteps.every(index => index >= 0));
  assert.deepEqual(validationSteps, [...validationSteps].sort((a, b) => a - b));
  assert.match(getStep(steps, 'Validate source and generated content'), /content:source:validate.*--app-version \$env:APP_VERSION/);
  assert.match(getStep(steps, 'Validate source and generated content'), /content:check.*--app-version \$env:APP_VERSION/);
  assert.match(getStep(steps, 'Validate content with the Node.js validator'), /content:validate/);
  assert.match(getStep(steps, 'Validate content with the .NET validator'), /dotnet run --project tools\/Portfolio\.Content\.Validator/);
  assert.match(getStep(steps, 'Audit trusted content tooling dependencies'), /npm audit --audit-level=moderate/);
  assert.match(getStep(steps, 'Scan caller content repository for secrets'), /gitleaks:v8\.30\.1/);
});

test('deployment gates all writes on validation and retains protected deployment semantics', () => {
  assertCallWorkflow(deployment);
  assertRequiredInput(deployment, 'app_repository');
  assertRepositoryBinding(deployment);
  assertNoAppShaInput(deployment);
  assertRequiredSecret(deployment, 'DEPLOY_PASSWORD');
  assertRequiredSecret(deployment, 'CONTENT_ACTIVATION_TOKEN');

  const concurrency = getIndentedBlock(deployment, 0, 'concurrency');
  assert.match(concurrency, /^  group: deploy-content$/m);
  assert.match(concurrency, /^  cancel-in-progress: false$/m);
  const validationJob = getIndentedBlock(deployment, 2, 'validate');
  assert.match(validationJob, /^    if: inputs\.activate_release_id == ''$/m);
  assert.match(validationJob, /^    uses: \.\/\.github\/workflows\/validate-content\.yml$/m);
  assert.match(validationJob, /app_repository: \$\{\{ inputs\.app_repository \}\}/);
  assert.doesNotMatch(validationJob, /app_sha/);
  const deployJobDefinition = getIndentedBlock(deployment, 2, 'deploy');
  assert.match(deployJobDefinition, /^    needs: validate$/m);
  assert.match(deployJobDefinition, /!cancelled\(\)/);
  assert.match(deployJobDefinition, /needs\.validate\.result == 'success'/);
  assert.match(deployJobDefinition, /inputs\.activate_release_id != '' && needs\.validate\.result == 'skipped'/);
  assert.match(deployJobDefinition, /github\.ref == 'refs\/heads\/main'/);
  const deployJob = deployJobDefinition;
  assert.match(deployJob, /^    environment: production-content$/m);

  const steps = getSteps(deployJob);
  const workflowIdentity = getStep(steps, 'Verify reusable workflow identity');
  assertWorkflowIdentityGuard(workflowIdentity);
  assert.doesNotMatch(workflowIdentity, /secrets\./);
  const appCheckout = steps.find(step => step.includes('path: app'));
  assert.ok(appCheckout, 'application checkout is unconditional, including rollback runs');
  assertAppCheckout(appCheckout);
  assert.doesNotMatch(appCheckout, /^        if:/m);
  assertVerifyAppRelease(steps);
  assert.match(getStep(steps, 'Validate deployment configuration and required secrets'), /CONTENT_ACTIVATION_TOKEN is required/);
  assert.ok(steps.indexOf(workflowIdentity) < steps.indexOf(appCheckout), 'workflow identity is verified before checkouts');
  const contentCheckout = steps.find(step => step.includes('path: content-repo'));
  assert.ok(contentCheckout);
  assert.match(contentCheckout, /^        if: env\.ROLLBACK_RELEASE_ID == ''$/m);

  const packageIndex = steps.findIndex(step => step.includes('name: Package release'));
  const uploadIndex = steps.findIndex(step => step.includes('name: Upload release folder with Web Deploy'));
  const activationIndex = steps.findIndex(step => step.includes('name: Preview, activate, and verify release'));
  assert.ok(packageIndex >= 0 && packageIndex < uploadIndex && uploadIndex < activationIndex);
  const uploadStep = getStep(steps, 'Upload release folder with Web Deploy');
  assert.match(uploadStep, /^        shell: powershell$/m);
  assert.match(uploadStep, /^          DEPLOY_PASSWORD: \$\{\{ secrets\.DEPLOY_PASSWORD \}\}$/m);
  const activationStep = getStep(steps, 'Preview, activate, and verify release');
  assert.doesNotMatch(activationStep, /^        if:/m);
  assert.match(activationStep, /CONTENT_ACTIVATION_TOKEN: \$\{\{ secrets\.CONTENT_ACTIVATION_TOKEN \}\}/);
  assert.match(activationStep, /preview\/\$releaseId.*-TimeoutSec 30/);
  assert.match(activationStep, /activate\/\$releaseId.*-TimeoutSec 30/);
  assert.match(activationStep, /Invoke-WebRequest .* -TimeoutSec 30/);
  assert.match(activationStep, /app\/scripts\/content\/verify-active-release\.mjs/);
  assert.doesNotMatch(deployment, /^ *secrets: inherit$/m);
});

test('provisioning is main-only, serialized, and protects the selected token', () => {
  assertCallWorkflow(provisioning);
  assertRequiredInput(provisioning, 'app_repository');
  assertRepositoryBinding(provisioning);
  assertNoAppShaInput(provisioning);
  assertRequiredSecret(provisioning, 'DEPLOY_PASSWORD');
  assertOptionalSecret(provisioning, 'CONTENT_ACTIVATION_TOKEN_NEXT');
  assertRequiredSecret(provisioning, 'CONTENT_ACTIVATION_TOKEN');
  assert.match(getIndentedBlock(provisioning, 0, 'concurrency'), /^  group: deploy-content$/m);
  assert.match(getIndentedBlock(provisioning, 0, 'concurrency'), /^  cancel-in-progress: false$/m);

  const provisionJob = getIndentedBlock(provisioning, 2, 'provision');
  assert.match(provisionJob, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(provisionJob, /^    environment: production-content$/m);
  const steps = getSteps(provisionJob);
  const workflowIdentity = getStep(steps, 'Validate deployment configuration');
  assertWorkflowIdentityGuard(workflowIdentity);
  const appCheckout = steps.find(step => step.includes('path: app'));
  assert.ok(appCheckout);
  assert.ok(steps.indexOf(workflowIdentity) < steps.indexOf(appCheckout), 'workflow identity is verified before app checkout');
  assertAppCheckout(appCheckout);
  assertVerifyAppRelease(steps);

  const upload = getStep(steps, 'Upload activation token to releases root');
  assert.match(upload, /^        shell: powershell$/m);
  assert.match(upload, /DEPLOY_PASSWORD: \$\{\{ secrets\.DEPLOY_PASSWORD \}\}/);
  assert.match(upload, /CONTENT_ACTIVATION_TOKEN_NEXT: \$\{\{ secrets\.CONTENT_ACTIVATION_TOKEN_NEXT \}\}/);
  assert.match(upload, /CONTENT_ACTIVATION_TOKEN_PRIMARY: \$\{\{ secrets\.CONTENT_ACTIVATION_TOKEN \}\}/);
  assert.match(upload, /CONTENT_ACTIVATION_TOKEN_NEXT -ErrorAction SilentlyContinue/);
  assert.match(upload, /CONTENT_ACTIVATION_TOKEN_PRIMARY -ErrorAction SilentlyContinue/);
  assert.match(upload, /if \(\$env:USE_PRIMARY_SECRET -ceq 'true'\)[\s\S]*?\$env:CONTENT_ACTIVATION_TOKEN_PRIMARY[\s\S]*?else[\s\S]*?\$env:CONTENT_ACTIVATION_TOKEN_NEXT/);
  assert.doesNotMatch(upload, /IsNullOrWhiteSpace\(\$env:CONTENT_ACTIVATION_TOKEN_NEXT\)/);
  assert.match(upload, /IsNullOrWhiteSpace\(\$token\)/);
  assert.match(upload, /WriteAllText\(\(Join-Path \$tokenDirectory 'activation-token\.txt'\), \$token/);
});

test('workflow action references are exact versions for verified publishers and SHAs otherwise', () => {
  const workflowDirectory = new URL('.', import.meta.url);
  const names = readdirSync(workflowDirectory).filter(name => /\.ya?ml$/u.test(name));
  assert.ok(names.length > 0);
  let checked = 0;
  for (const name of names) {
    for (const [, reference] of readWorkflow(name).matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gmu)) {
      if (reference.startsWith('./')) continue;
      checked += 1;
      const [action, ref] = reference.split('@');
      const owner = action.split('/')[0];
      const versionTag = /^v[0-9]+\.[0-9]+\.[0-9]+$/u.test(ref ?? '');
      if (VERSION_TAG_ACTION_OWNERS.has(owner)) {
        assert.ok(versionTag, `${name}: ${reference} must use an exact version tag (vX.Y.Z), not a floating ref`);
      } else {
        assert.match(ref ?? '', /^[a-f0-9]{40}$/u, `${name}: ${reference} is not a verified publisher and must be pinned to a full commit SHA`);
      }
    }
  }
  assert.ok(checked > 0, 'workflows reference external actions');
});

test('quality gates skip irrelevant work without leaving required checks pending', () => {
  const jobs = getIndentedBlock(quality, 0, 'jobs');
  assert.match(getIndentedBlock(jobs, 2, 'build-and-security'), /^    if: needs\.changes\.outputs\.any == 'true'$/m);
  assert.match(getIndentedBlock(jobs, 2, 'deployment-safety-tests'), /^    if: needs\.changes\.outputs\.scripts == 'true'$/m);
  const browser = getIndentedBlock(jobs, 2, 'browser-quality');
  assert.doesNotMatch(browser, /^    if: .*outputs\./m, 'a job-level skip leaves the expanded matrix check names pending');
  const steps = getSteps(browser);
  assert.ok(steps.length > 0 && steps.every(step => /^      - if: needs\.changes\.outputs\.browser == 'true'/u.test(step)));

  const buildSteps = getSteps(getIndentedBlock(jobs, 2, 'build-and-security'));
  const alwaysOn = buildSteps.filter(step => !/^      - if: needs\.changes\.outputs\.app == 'true'/u.test(step));
  assert.deepEqual(alwaysOn.map(step => /actions\/checkout|workflow-contracts|gitleaks/u.exec(step)?.[0]), ['actions/checkout', 'workflow-contracts', 'gitleaks'], 'only checkout, the workflow-contract tests and the secret scan run for every non-release change');
});

test('quality required job keeps its existing name and runs content checks', () => {
  const jobs = getIndentedBlock(quality, 0, 'jobs');
  const buildAndSecurity = getIndentedBlock(jobs, 2, 'build-and-security');
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm run test:content$/m);
  assert.match(buildAndSecurity, /^      - run: node --test \.github\/workflows\/workflow-contracts\.test\.mjs$/m);
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm run content:source:validate$/m);
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm run content:check$/m);
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm run content:validate$/m);
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm audit --audit-level=moderate$/m);
  assert.match(buildAndSecurity, /^      - if: needs\.changes\.outputs\.app == 'true'\n        run: npm run validate:content$/m);
  assert.match(quality, /Run VERSION bump validation tests/);
});
