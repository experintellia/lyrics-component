import { defineConfig, devices } from '@playwright/test';

export const webServer = {
  command: 'pnpm build:demo && pnpm exec vite preview --port 4173 --strictPort',
  port: 4173,
  reuseExistingServer: !process.env.CI,
};

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'screenshots.spec.ts', // `pnpm screenshots` (playwright.screenshots.config.ts)
  use: { baseURL: 'http://localhost:4173' },
  webServer,
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
});
