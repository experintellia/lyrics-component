import { defineConfig, devices } from '@playwright/test';
import { webServer } from './playwright.config';

// `pnpm screenshots`: PNGs of the key states for human review, written to screenshots/. Not part of `pnpm e2e`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'screenshots.spec.ts',
  use: { baseURL: 'http://localhost:4173' },
  webServer,
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
