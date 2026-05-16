import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            // Prevent rAF throttling in background tabs — with multiple
            // parallel workers some tabs run offscreen and rAF slows to
            // ~1fps, causing the splash animation to never reach is-ready.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
          ],
        },
      },
    },
  ],

  webServer: {
    command: process.env.CI ? 'npx vite preview --port 5173' : 'npx vite --port 5173',
    port: 5173,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
  },
});
