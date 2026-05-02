import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const envChromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const systemChromiumExecutable = '/usr/bin/chromium';
const chromiumExecutable = envChromiumExecutable
  || (fs.existsSync(systemChromiumExecutable) ? systemChromiumExecutable : null);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'on-first-retry',
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : {}
  },
  webServer: {
    command: 'node tools/test-server.js --port 4173',
    url: 'http://127.0.0.1:4173/player.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
