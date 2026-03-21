import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'https://front.v30.ultrasist.net',
  }
});