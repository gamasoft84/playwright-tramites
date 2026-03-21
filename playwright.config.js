import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  // Paralelo: sube el número si tu máquina y el servidor lo aguantan (p. ej. 4 u 8). % porcentaje = CPUs.
  fullyParallel: true,
  workers: 16,
  maxFailures: 0,
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'https://front.v30.ultrasist.net',
  }
});