import { test, expect } from '@playwright/test';
import tramites from '../data/tramites.json' assert { type: 'json' };

const BASE = 'https://front.v30.ultrasist.net';

function isTimeoutError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'TimeoutError') return true;
  return /timeout|timed out|exceeded/i.test(String(error.message));
}

test.describe('Trámites', () => {
  // Paralelo entre trámites (cada test tiene su propia page). Timeout por test.
  test.describe.configure({ timeout: 45_000 });

  for (const tramite of tramites) {
    test(`[${tramite.departamento}][${tramite.tipoTramite}] ID ${tramite.id}`, async ({ page }) => {

      // 1️⃣ Carga la lista de trámites
      await page.goto(`${BASE}/seleccion-tramite`);
      await page.waitForLoadState('networkidle');

      // 2️⃣ Busca el enlace por href — maneja duplicados y con/sin barra final
      const path = tramite.url.replace(BASE, '');
      const trimmed = path.replace(/\/$/, '') || '/';
      const withSlash = trimmed === '/' ? '/' : `${trimmed}/`;
      const hrefVariants = [...new Set([path, trimmed, withSlash, tramite.url])];
      const locator = page.locator(hrefVariants.map((h) => `a[href="${h}"]`).join(', '));
      const count = await locator.count();
      if (count > 1) {
        console.warn(`⚠️  WARNING: ${count} enlaces duplicados para ${path} — usando el primero`);
      }
      await locator.first().click();

      try {
        // ⏳ Espera que salga de seleccion-tramite
        await page.waitForURL(url => !url.href.includes('seleccion-tramite'), { timeout: 30000 });

        // ⏳ Espera que Angular termine de renderizar
        await page.waitForLoadState('networkidle');

        // ⏳ Espera a que el spinner desaparezca (máximo 10s, no falla si no existe)
        await page.locator('ngx-spinner[name="spinner"] .ngx-spinner-overlay')
          .waitFor({ state: 'hidden', timeout: 10000 })
          .catch(() => console.warn(`⚠️  Spinner no encontrado en ${tramite.tipoTramite}`));

        console.log(`✅ OK: ${tramite.url}`);

        // 📸 Screenshot del trámite cargado
        await page.screenshot({
          path: `screenshots/${tramite.departamento}-${tramite.tipoTramite}-resultado.png`,
          fullPage: true
        });

        // 3️⃣ Verifica que cargó correctamente
        const body = await page.locator('body').textContent();
        expect(body).not.toContain('NG04002');
        expect(body).not.toContain('Cannot match any routes');

      } catch (error) {
        const msg = error.message.split('\n')[0];
        test.info().annotations.push({
          type: isTimeoutError(error) ? 'tramite-timeout' : 'tramite-error',
          description: `${tramite.departamento} ${tramite.tipoTramite} (id ${tramite.id}): ${msg}`,
        });

        if (!page.isClosed()) {
          try {
            await page.screenshot({
              path: `screenshots/${tramite.departamento}-${tramite.tipoTramite}-error.png`,
              fullPage: true,
            });
          } catch {
            console.warn(`⚠️  No se pudo tomar screenshot de error para ${tramite.tipoTramite}`);
          }
        } else {
          console.warn(`⚠️  No se pudo tomar screenshot de error para ${tramite.tipoTramite} — página cerrada`);
        }

        console.error(`❌ ERROR [${tramite.departamento}][${tramite.tipoTramite}] ID ${tramite.id}: ${msg}`);
        // No relanzamos: el siguiente trámite en la serie siempre se ejecuta.
      }

    });
  }
});