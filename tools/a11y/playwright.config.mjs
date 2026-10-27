import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5187',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'dotnet run --project ../../src/Portfolio.Web --configuration Release --no-launch-profile --urls http://127.0.0.1:5187',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
