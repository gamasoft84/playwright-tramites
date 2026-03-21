/**
 * Tras `npx playwright test` (con reporter json → test-results/results.json),
 * inyecta en playwright-report/index.html una banda al final del body con fallidos
 * agrupados por [dependencia] y tipos numerados.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'results.json');
const INDEX_HTML = path.join(ROOT, 'playwright-report', 'index.html');

const PAIR_RE = /\[([^\]]+)\]\[([^\]]+)\]/;
const MARK_START = '<!-- TRAMITES_RESUMEN_INICIO -->';
const MARK_END = '<!-- TRAMITES_RESUMEN_FIN -->';

function visitSpecs(suite, fn) {
  for (const spec of suite.specs || []) fn(spec);
  for (const s of suite.suites || []) visitSpecs(s, fn);
}

function specFailed(spec) {
  if (spec.ok === false) return true;
  return !!spec.tests?.some((t) =>
    t.results?.some((r) =>
      ['failed', 'timedOut', 'interrupted'].includes(r.status),
    ),
  );
}

function collectFailedPairs(report) {
  const rows = [];
  for (const root of report.suites || []) {
    visitSpecs(root, (spec) => {
      if (!specFailed(spec)) return;
      const m = spec.title.match(PAIR_RE);
      if (m) rows.push({ dep: m[1], tipo: m[2] });
    });
  }
  return rows;
}

function buildSummaryText(rows) {
  const byDep = new Map();
  for (const { dep, tipo } of rows) {
    if (!byDep.has(dep)) byDep.set(dep, new Set());
    byDep.get(dep).add(tipo);
  }
  const sortTipo = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };
  let out = '';
  for (const dep of [...byDep.keys()].sort((a, b) => a.localeCompare(b))) {
    const tipos = [...byDep.get(dep)].sort(sortTipo);
    out += `[${dep}]\n\n`;
    tipos.forEach((t, i) => {
      out += `        ${i + 1}. ${t}\n`;
    });
    out += '\n';
  }
  return out.trimEnd();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fechaHoraSistema() {
  const d = new Date();
  const fecha = d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hora = d.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${fecha} ${hora}`;
}

function buildInjectedBlock(summaryText, failCount) {
  const preContent =
    failCount > 0
      ? escapeHtml(summaryText)
      : escapeHtml('Sin pruebas fallidas en este run.');
  const cantidad =
    failCount === 1
      ? '1 trámite fallido por dependencia'
      : `${failCount} trámites fallidos por dependencia`;
  const titulo = `Resumen: ${cantidad}. ${fechaHoraSistema()} del sistema`;
  return `${MARK_START}
<div id="tramites-failed-resumen" style="margin:0;padding:14px 18px;background:#fff8e6;border-top:2px solidrgb(226, 210, 160);font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.45;">
  <strong style="display:block;margin-bottom:8px;color:#5c4a00;">${escapeHtml(titulo)}</strong>
  <pre style="margin:0;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;">${preContent}</pre>
</div>
${MARK_END}`;
}

function main() {
  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn(
      'enrich-playwright-report: falta test-results/results.json. Activa el reporter json en playwright.config.js y vuelve a correr los tests.',
    );
    process.exit(0);
  }
  if (!fs.existsSync(INDEX_HTML)) {
    console.warn('enrich-playwright-report: no existe playwright-report/index.html.');
    process.exit(0);
  }

  const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  const pairs = collectFailedPairs(report);
  const summaryText = buildSummaryText(pairs);
  const block = buildInjectedBlock(summaryText, pairs.length);

  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  const reOld = new RegExp(
    `\\n?${MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'g',
  );
  html = html.replace(reOld, '\n');

  if (!/<\/body>/i.test(html)) {
    console.error('enrich-playwright-report: no se encontró </body> en index.html');
    process.exit(1);
  }
  html = html.replace(/<\/body>/i, `\n${block}\n</body>`);

  fs.writeFileSync(INDEX_HTML, html);
  console.log(
    pairs.length > 0
      ? `enrich-playwright-report: inyectado resumen (${pairs.length} casos fallidos).`
      : 'enrich-playwright-report: sin fallos; banda informativa actualizada.',
  );
}

main();
