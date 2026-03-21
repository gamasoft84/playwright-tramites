import { test, expect } from '@playwright/test';
import tramites from '../data/tramites.json' assert { type: 'json' };

const BASE = 'https://front.v30.ultrasist.net';

test.use({ storageState: 'session/login.json' });

// 🔑 Un contexto compartido — Angular se inicializa una sola vez
test.describe.serial('Trámites', () => {

  test.beforeAll(async ({ browser }) => {
    // Guarda la página inicializada para reutilizarla
    const context = await browser.newContext({ storageState: 'session/login.json' });
    const page = await context.newPage();
    await page.goto(`${BASE}/seleccion-tramite`);
    await page.waitForLoadState('networkidle');
    await context.storageState({ path: 'session/login.json' }); // refresca sesión
    await context.close();
  });

  for (const tramite of tramites) {
    test(`[${tramite.departamento}] ${tramite.tipoTramite} - ID ${tramite.id}`, async ({ page }) => {

      // Angular ya conoce las rutas, navega directo
      await page.goto(tramite.url);
      await page.waitForLoadState('networkidle');

      const body = await page.locator('body').textContent();

      expect(body).not.toContain('NG04002');
      expect(body).not.toContain('Cannot match any routes');
      await expect(page.locator('body')).toBeVisible();

    });
  }
});