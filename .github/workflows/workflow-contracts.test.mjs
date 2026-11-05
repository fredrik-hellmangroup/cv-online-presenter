import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readWorkflow = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
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

function assertPinnedAppShaInput(workflow) {
  const input = getIndentedBlock(workflow, 6, 'app_sha');
  assert.match(input, /Same immutable 40-character literal SHA as the caller's uses reference and generated content provenance/);
}

function assertWorkflowIdentityGuard(step) {
  assert.match(step, /WORKFLOW_REPOSITORY: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(step, /WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(step, /\$env:APP_REPOSITORY -cne \$env:WORKFLOW_REPOSITORY/);
  assert.match(step, /\$env:APP_SHA -cne \$env:WORKFLOW_SHA/);
  assert.match(step, /\[string\]::IsNullOrWhiteSpace\(\$env:WORKFLOW_REPOSITORY\)/);
  assert.match(step, /\[string\]::IsNullOrWhiteSpace\(\$env:WORKFLOW_SHA\)/);
  assert.match(step, /GitHub\.com-only; missing values on GHES fail closed/);
}

function assertCallWorkflow(workflow) {
  assert.match(getIndentedBlock(workflow, 0, 'on'), /^  workflow_call:$/m);
}

test('reusable validation checks app identity and validates all caller content', () => {
  assertCallWorkflow(validation);
  assertRequiredInput(validation, 'app_repository');
  assertRequiredInput(validation, 'app_sha');
  assertRepositoryBinding(validation);
  assertPinnedAppShaInput(validation);

  const steps = getSteps(getIndentedBlock(validation, 2, 'validate'));
  const validateInputs = getStep(steps, 'Validate application checkout inputs');
  assertWorkflowIdentityGuard(validateInputs);
  assert.match(validateInputs, /APP_SHA/);
  assert.match(validateInputs, /APP_REPOSITORY -cnotmatch '\^\[A-Za-z0-9-\]\+\/\[A-Za-z0-9._-\]\+\$'/);
  const contentCheckout = steps.find(step => step.includes('path: content-repo'));
  const appCheckout = steps.find(step => step.includes('path: app'));
  assert.ok(contentCheckout);
  assert.match(contentCheckout, /^          ref: \$\{\{ github\.sha \}\}$/m);
  assert.ok(appCheckout);
  assert.ok(steps.indexOf(validateInputs) < steps.indexOf(appCheckout), 'workflow identity is verified before app checkout');
  assert.match(appCheckout, /^          repository: \$\{\{ inputs\.app_repository \}\}$/m);
  assert.match(appCheckout, /^          ref: \$\{\{ inputs\.app_sha \}\}$/m);
  assert.match(appCheckout, /^          fetch-depth: 0$/m);
  const verifyApp = getStep(steps, 'Verify exact application commit');
  assert.match(verifyApp, /git -C app fetch --no-tags origin refs\/heads\/main/);
  assert.match(verifyApp, /git -C app merge-base --is-ancestor \$env:APP_SHA FETCH_HEAD/);
  assert.match(verifyApp, /git -C app rev-parse HEAD/);

  const validationSteps = [
    'Validate source and generated content',
    'Validate content with the Node.js validator',
    'Validate content with the .NET validator',
  ].map(name => steps.findIndex(step => step.includes(`name: ${name}`)));
  assert.ok(validationSteps.every(index => index >= 0));
  assert.deepEqual(validationSteps, [...validationSteps].sort((a, b) => a - b));
  assert.match(getStep(steps, 'Validate source and generated content'), /content:source:validate/);
  assert.match(getStep(steps, 'Validate source and generated content'), /content:check/);
  assert.match(getStep(steps, 'Validate content with the Node.js validator'), /content:validate/);
  assert.match(getStep(steps, 'Validate content with the .NET validator'), /dotnet run --project tools\/Portfolio\.Content\.Validator/);
  assert.match(getStep(steps, 'Audit trusted content tooling dependencies'), /npm audit --audit-level=moderate/);
  assert.match(getStep(steps, 'Scan caller content repository for secrets'), /gitleaks:v8\.30\.1/);
});

test('deployment gates all writes on validation and retains protected deployment semantics', () => {
  assertCallWorkflow(deployment);
  assertRequiredInput(deployment, 'app_repository');
  assertRequiredInput(deployment, 'app_sha');
  assertRepositoryBinding(deployment);
  assertPinnedAppShaInput(deployment);
  assertRequiredSecret(deployment, 'DEPLOY_PASSWORD');
  assertRequiredSecret(deployment, 'CONTENT_ACTIVATION_TOKEN');

  const concurrency = getIndentedBlock(deployment, 0, 'concurrency');
  assert.match(concurrency, /^  group: deploy-content$/m);
  assert.match(concurrency, /^  cancel-in-progress: false$/m);
  const validationJob = getIndentedBlock(deployment, 2, 'validate');
  assert.match(validationJob, /^    if: inputs\.activate_release_id == ''$/m);
  assert.match(validationJob, /^    uses: \.\/\.github\/workflows\/validate-content\.yml$/m);
  assert.match(validationJob, /app_repository: \$\{\{ inputs\.app_repository \}\}/);
  assert.match(validationJob, /app_sha: \$\{\{ inputs\.app_sha \}\}/);
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
  assert.match(appCheckout, /^          repository: \$\{\{ inputs\.app_repository \}\}$/m);
  assert.match(appCheckout, /^          ref: \$\{\{ inputs\.app_sha \}\}$/m);
  assert.match(appCheckout, /^          fetch-depth: 0$/m);
  assert.doesNotMatch(appCheckout, /^        if:/m);
  const verifyApp = getStep(steps, 'Verify exact application commit');
  assert.match(verifyApp, /git -C app fetch --no-tags origin refs\/heads\/main/);
  assert.match(verifyApp, /git -C app merge-base --is-ancestor \$env:APP_SHA FETCH_HEAD/);
  assert.match(verifyApp, /git -C app rev-parse HEAD/);
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
  assertRequiredInput(provisioning, 'app_sha');
  assertRepositoryBinding(provisioning);
  assertPinnedAppShaInput(provisioning);
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
  assert.match(appCheckout, /^          repository: \$\{\{ inputs\.app_repository \}\}$/m);
  assert.match(appCheckout, /^          ref: \$\{\{ inputs\.app_sha \}\}$/m);
  assert.match(appCheckout, /^          fetch-depth: 0$/m);
  const verifyApp = getStep(steps, 'Verify exact application commit');
  assert.match(verifyApp, /git -C app fetch --no-tags origin refs\/heads\/main/);
  assert.match(verifyApp, /git -C app merge-base --is-ancestor \$env:APP_SHA FETCH_HEAD/);
  assert.match(verifyApp, /git -C app rev-parse HEAD/);

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

test('quality required job keeps its existing name and runs content checks', () => {
  const jobs = getIndentedBlock(quality, 0, 'jobs');
  const buildAndSecurity = getIndentedBlock(jobs, 2, 'build-and-security');
  assert.match(buildAndSecurity, /^      - run: npm run test:content$/m);
  assert.match(buildAndSecurity, /^      - run: node --test \.github\/workflows\/workflow-contracts\.test\.mjs$/m);
  assert.match(buildAndSecurity, /^      - run: npm run content:source:validate$/m);
  assert.match(buildAndSecurity, /^      - run: npm run content:check$/m);
  assert.match(buildAndSecurity, /^      - run: npm run content:validate$/m);
  assert.match(buildAndSecurity, /^      - run: npm audit --audit-level=moderate$/m);
  assert.match(buildAndSecurity, /^      - run: npm run validate:content$/m);
  assert.match(quality, /Run VERSION bump validation tests/);
});
