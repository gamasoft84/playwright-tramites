/**
 * Ejecuta tests/tramites.spec.js con ambiente obligatorio y filtros opcionales.
 * Luego enrich del HTML y, salvo --no-show-report, npx playwright show-report.
 *
 * Uso:
 *   npm run test:tramites -- --ambiente UAT_SAT
 *   npm run test:tramites -- --ambiente UAT_SAT --deps aga,agace
 *   npm run test:tramites -- --ambiente UAT_SAT --tipos 103,104,105
 *   npm run test:tramites -- --ambiente UAT_SAT --ids 604,172
 *   npm run test:tramites -- --ambiente UAT_ULTRASIST --deps aga --tipos 103
 *   npm run test:tramites -- --ambiente UAT_SAT --grep '\[cofepris\]'
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { AMBIENTES } from '../ambientes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const AMBIENTE_KEYS = new Set(Object.keys(AMBIENTES));

function printHelp() {
  console.log(`
Uso: npm run test:tramites -- --ambiente <UAT_SAT|UAT_ULTRASIST> [opciones]

  --ambiente (obligatorio)   UAT_SAT | UAT_ULTRASIST
  --deps a,b,c               Departamentos (ej. aga,agace). Regex sobre el primer [dep] del título del test.
  --tipos 103,104            tipoTramite (segundo corchete en el título).
  --ids 604,172              id del trámite en JSON (parte "ID xxx" del título).
  --grep '<regex>'           Patrón manual para --grep de Playwright (anula la composición de --deps/--tipos/--ids).
  --no-show-report           No abre el reporte HTML al final (sí corre enrich).

Los filtros --deps, --tipos e --ids se combinan con Y lógico. Sin filtros ni --grep: corre todos los trámites del ambiente.

Título de cada test: [departamento][tipoTramite] ID <id>
`.trim());
}

function parseList(s) {
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const out = {
    ambiente: null,
    deps: [],
    tipos: [],
    ids: [],
    grep: null,
    noShowReport: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '-h' || raw === '--help') {
      out.help = true;
      continue;
    }
    const eq = raw.indexOf('=');
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const valEq = eq >= 0 ? raw.slice(eq + 1) : undefined;

    function take() {
      if (valEq !== undefined) return valEq;
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return undefined;
      i += 1;
      return next;
    }

    if (key === '--ambiente') {
      out.ambiente = take();
    } else if (key === '--deps') {
      const v = take();
      if (v) out.deps = parseList(v);
    } else if (key === '--tipos') {
      const v = take();
      if (v) out.tipos = parseList(v);
    } else if (key === '--ids') {
      const v = take();
      if (v) out.ids = parseList(v);
    } else if (key === '--grep') {
      out.grep = take();
    } else if (key === '--no-show-report') {
      out.noShowReport = true;
    } else {
      console.error(`Argumento desconocido: ${raw}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function reEsc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {{ deps: string[]; tipos: string[]; ids: string[] }} f
 * @returns {string | null} patrón para Playwright --grep, o null = sin filtro
 */
function buildGrepFromFilters(f) {
  const hasDeps = f.deps.length > 0;
  const hasTipos = f.tipos.length > 0;
  const hasIds = f.ids.length > 0;
  if (!hasDeps && !hasTipos && !hasIds) return null;

  const depAlt = hasDeps ? f.deps.map(reEsc).join('|') : null;
  const tipoAlt = hasTipos ? f.tipos.map(reEsc).join('|') : null;
  const idAlt = hasIds ? f.ids.map(reEsc).join('|') : null;

  if (hasDeps && hasTipos && hasIds) {
    return `\\[(${depAlt})\\]\\[(${tipoAlt})\\] ID (${idAlt})$`;
  }
  if (hasDeps && hasTipos) {
    return `\\[(${depAlt})\\]\\[(${tipoAlt})\\]`;
  }
  if (hasDeps && hasIds) {
    return `\\[(${depAlt})\\].*ID (${idAlt})$`;
  }
  if (hasTipos && hasIds) {
    return `\\[[^\\]]+\\]\\[(${tipoAlt})\\].*ID (${idAlt})$`;
  }
  if (hasDeps) return `\\[(${depAlt})\\]`;
  if (hasTipos) return `\\[[^\\]]+\\]\\[(${tipoAlt})\\]`;
  if (hasIds) return `ID (${idAlt})$`;
  return null;
}

/** Ruta al CLI de Playwright (evita `npx` en Windows, donde a veces falla con "path specified"). */
const PLAYWRIGHT_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const ambiente = (args.ambiente || '').trim();
  if (!ambiente) {
    console.error('Falta --ambiente UAT_SAT | UAT_ULTRASIST\n');
    printHelp();
    process.exit(1);
  }
  if (!AMBIENTE_KEYS.has(ambiente)) {
    console.error(`Ambiente no válido: ${ambiente}. Use: ${[...AMBIENTE_KEYS].join(', ')}`);
    process.exit(1);
  }

  let grepPattern = args.grep?.trim() || null;
  if (grepPattern && (args.deps.length || args.tipos.length || args.ids.length)) {
    console.warn('⚠️  --grep tiene prioridad; se ignoran --deps / --tipos / --ids en esta corrida.');
  }
  if (!grepPattern) {
    grepPattern = buildGrepFromFilters({
      deps: args.deps,
      tipos: args.tipos,
      ids: args.ids,
    });
  }

  const pwArgs = ['test', 'tests/tramites.spec.js'];
  if (grepPattern) {
    pwArgs.push('--grep', grepPattern);
    console.log(`🔎 --grep: ${grepPattern}`);
  }

  const env = { ...process.env, TRAMITES_AMBIENTE: ambiente };
  console.log(`🌐 TRAMITES_AMBIENTE=${ambiente}`);

  const pw = spawnSync(process.execPath, [PLAYWRIGHT_CLI, ...pwArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });

  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'enrich-playwright-report.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (!args.noShowReport) {
    spawnSync(process.execPath, [PLAYWRIGHT_CLI, 'show-report'], {
      cwd: ROOT,
      stdio: 'inherit',
      env,
    });
  }

  const code = pw.status == null ? (pw.error ? 1 : 0) : pw.status;
  process.exit(code);
}

main();
