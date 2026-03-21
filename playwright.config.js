import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Paralelo: sube el número si tu máquina y el servidor lo aguantan (p. ej. 4 u 8). % porcentaje = CPUs.
  fullyParallel: true,
  workers: 8,
  maxFailures: 0,
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'https://front.v30.ultrasist.net',
  }
});