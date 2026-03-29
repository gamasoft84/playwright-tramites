import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { getAmbienteConfig, loadTramitesNormalized } from '../ambientes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Siempre raíz del repo; rutas relativas `screenshots/...` fallan si cwd ≠ proyecto (p. ej. tras vaciar carpetas se nota que “no hay PNG”). */
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

const ambiente = getAmbienteConfig();
const BASE = ambiente.baseURL;
const tramites = loadTramitesNormalized(ambiente);

function isTimeoutError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'TimeoutError') return true;
  return /timeout|timed out|exceeded/i.test(String(error.message));
}

function capturaNombreBase(tramite) {
  return `${tramite.departamento}-${tramite.tipoTramite}-${String(tramite.id)}`;
}

test.describe('Trámites', () => {
  // Paralelo entre trámites (cada test tiene su propia page). Timeout por test.
  test.describe.configure({ timeout: 45_000 });

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  });

  for (const tramite of tramites) {
    test(`[${tramite.departamento}][${tramite.tipoTramite}] ID ${tramite.id}`, async ({ page }) => {

      // 1️⃣ Carga la lista de trámites
      await page.goto(`${BASE}/seleccion-tramite`);
      await page.waitForLoadState('networkidle');

      // 2️⃣ Busca el enlace por href — maneja duplicados y con/sin barra final
      // (no usar el nombre `path`: enmascararía el módulo `path` de Node y rompe path.join en screenshots)
      const urlPath = tramite.url.replace(BASE, '');
      const trimmed = urlPath.replace(/\/$/, '') || '/';
      const withSlash = trimmed === '/' ? '/' : `${trimmed}/`;
      const hrefVariants = [...new Set([urlPath, trimmed, withSlash, tramite.url])];
      const locator = page.locator(hrefVariants.map((h) => `a[href="${h}"]`).join(', '));
      const count = await locator.count();
      if (count > 1) {
        console.warn(`⚠️  WARNING: ${count} enlaces duplicados para ${urlPath} — usando el primero`);
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

        // 3️⃣ Verifica que cargó correctamente (antes del screenshot OK para no sobrescribir PNG bueno si hay toast de error)
        const body = await page.locator('body').textContent();
        expect(body).not.toContain('NG04002');
        expect(body).not.toContain('Cannot match any routes');
        // Toast / alerta de error (p. ej. div.toast-message, role="alert")
        expect(body).not.toMatch(/Ocurrió un error\.?/i);

        // 📸 Screenshot del trámite cargado
        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, `${capturaNombreBase(tramite)}.png`),
          fullPage: true,
        });

      } catch (error) {
        const msg = error.message.split('\n')[0];
        test.info().annotations.push({
          type: isTimeoutError(error) ? 'tramite-timeout' : 'tramite-error',
          description: `${tramite.departamento} ${tramite.tipoTramite} (id ${tramite.id}): ${msg}`,
        });

        if (!page.isClosed()) {
          try {
            await page.screenshot({
              path: path.join(SCREENSHOTS_DIR, `${capturaNombreBase(tramite)}-error.png`),
              fullPage: true,
            });
          } catch {
            console.warn(`⚠️  No se pudo tomar screenshot de error para ${tramite.tipoTramite}`);
          }
        } else {
          console.warn(`⚠️  No se pudo tomar screenshot de error para ${tramite.tipoTramite} — página cerrada`);
        }

        console.error(`❌ ERROR [${tramite.departamento}][${tramite.tipoTramite}] ID ${tramite.id}: ${msg}`);
        // Relanzar para que el reporte HTML marque Failed. Con maxFailures: 0 el resto de pruebas igual se ejecutan.
        throw error;
      }

    });
  }
});