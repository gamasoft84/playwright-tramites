import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Paralelo: ~mitad de CPUs por defecto si omites workers. Baja a 1 si el servidor aguanta mal muchas sesiones.
  fullyParallel: true,
  maxFailures: 0,
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'https://front.v30.ultrasist.net',
  }
});