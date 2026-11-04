import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const realContentMode = process.env.PLAYWRIGHT_CONTENT_MODE === 'real';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (realContentMode && !process.env.EDITORIAL_CONTENT_PAGES) {
  throw new Error('PLAYWRIGHT_CONTENT_MODE=real requires EDITORIAL_CONTENT_PAGES.');
}
const editorialPagesRoot = realContentMode ? resolve(process.env.EDITORIAL_CONTENT_PAGES) : undefined;
if (editorialPagesRoot && isWithinRoot(repositoryRoot, editorialPagesRoot)) {
  throw new Error('Real editorial pages must be outside this checkout.');
}
if (realContentMode && process.env.BASE_URL) {
  throw new Error('Real-content mode starts its own dedicated server; do not set BASE_URL.');
}

function isWithinRoot(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

const serverUrl = realContentMode ? 'http://127.0.0.1:5188' : 'http://127.0.0.1:5187';
const baseURL = realContentMode ? serverUrl : process.env.BASE_URL ?? serverUrl;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: process.env.BASE_URL && !realContentMode ? undefined : {
    command: `dotnet run --project ../../src/Portfolio.Web --configuration Release --no-launch-profile --urls ${serverUrl}`,
    url: serverUrl,
    reuseExistingServer: realContentMode ? false : !process.env.CI,
    env: realContentMode ? { Content__PagesRoot: editorialPagesRoot } : undefined,
    timeout: 120_000
  }
});
