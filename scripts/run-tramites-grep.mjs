/**
 * Ejecuta tramites.spec.js con --grep <patrón> y luego enrich-playwright-report.mjs.
 * Uso: npm run test:tramites:grep -- '<regex>'
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const pattern = process.argv.slice(2).join(' ').trim();
if (!pattern) {
  console.error('Uso: npm run test:tramites:grep -- \'<regex para --grep>\'');
  console.error('Ej.: npm run test:tramites:grep -- \'\\[(aga|agace)\\]\'');
  console.error('     npm run test:tramites:aga-agace   (atajo para aga + agace)');
  process.exit(1);
}

const shell = process.platform === 'win32';
const pw = spawnSync(
  'npx',
  ['playwright', 'test', 'tests/tramites.spec.js', '--grep', pattern],
  { cwd: ROOT, stdio: 'inherit', shell },
);

spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'enrich-playwright-report.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

const code = pw.status == null ? (pw.error ? 1 : 0) : pw.status;
process.exit(code);
