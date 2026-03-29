/**
 * Tras `npx playwright test` (con reporter json → test-results/results.json),
 * inyecta en playwright-report/index.html una banda al final del body con:
 * - Totales (OK / fallidos / omitidos / total)
 * - Tabla por idTipoTramite (agrupa todos los [dep][tipo] con el mismo tipo)
 * - Listado de fallidos por dependencia (como antes)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'results.json');
const INDEX_HTML = path.join(ROOT, 'playwright-report', 'index.html');

const PAIR_RE = /\[([^\]]+)\]\[([^\]]+)\]/;
const TITLE_RE = /\[([^\]]+)\]\[([^\]]+)\] ID (.+)/;
const MARK_START = '<!-- TRAMITES_RESUMEN_INICIO -->';
const MARK_END = '<!-- TRAMITES_RESUMEN_FIN -->';

function visitSpecs(suite, fn) {
  for (const spec of suite.specs || []) fn(spec);
  for (const s of suite.suites || []) visitSpecs(s, fn);
}

function specFailed(spec) {
  if (spec.ok === false) return true;
  return !!spec.tests?.some((t) =>
    t.results?.some((r) => ['failed', 'timedOut', 'interrupted'].includes(r.status)),
  );
}

function specSkipped(spec) {
  return !!spec.tests?.some((t) => t.results?.some((r) => r.status === 'skipped'));
}

/** @returns {'passed' | 'failed' | 'skipped'} */
function specOutcome(spec) {
  if (specFailed(spec)) return 'failed';
  if (specSkipped(spec)) return 'skipped';
  return 'passed';
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

/** @returns {{ dep: string, tipo: string, id: string, outcome: 'passed'|'failed'|'skipped' }[]} */
function collectAllTramiteRows(report) {
  const rows = [];
  for (const root of report.suites || []) {
    visitSpecs(root, (spec) => {
      const m = spec.title.match(TITLE_RE);
      if (!m) return;
      rows.push({
        dep: m[1],
        tipo: m[2],
        id: m[3].trim(),
        outcome: specOutcome(spec),
      });
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

function sortTipoKey(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** @param {ReturnType<typeof collectAllTramiteRows>} rows */
function aggregateByTipoTramite(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.tipo)) {
      map.set(r.tipo, { passed: 0, failed: 0, skipped: 0, cases: [] });
    }
    const a = map.get(r.tipo);
    if (r.outcome === 'passed') a.passed++;
    else if (r.outcome === 'failed') a.failed++;
    else a.skipped++;
    a.cases.push({ dep: r.dep, id: r.id, outcome: r.outcome });
  }
  return map;
}

function estadoTipoCell(stats) {
  const { passed, failed, skipped } = stats;
  if (failed > 0 && passed === 0 && skipped === 0) return '✗';
  if (failed === 0 && skipped === 0 && passed > 0) return '✓';
  if (failed === 0 && passed === 0 && skipped > 0) return '○';
  if (failed > 0) return '⚠';
  return '—';
}

function outcomeLabel(o) {
  if (o === 'passed') return 'ok';
  if (o === 'failed') return 'fallido';
  return 'omitido';
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

/** @param {ReturnType<typeof collectAllTramiteRows>} allRows */
function buildInjectedBlock(allRows, failedSummaryText, failPairCount) {
  const passed = allRows.filter((r) => r.outcome === 'passed').length;
  const failed = allRows.filter((r) => r.outcome === 'failed').length;
  const skipped = allRows.filter((r) => r.outcome === 'skipped').length;
  const total = allRows.length;

  const byTipo = aggregateByTipoTramite(allRows);
  const tiposSorted = [...byTipo.keys()].sort(sortTipoKey);

  const tableRows = tiposSorted
    .map((tipo) => {
      const s = byTipo.get(tipo);
      const tot = s.passed + s.failed + s.skipped;
      const est = estadoTipoCell(s);
      const detail =
        s.cases.length > 1
          ? `<div style="font-size:11px;color:#555;margin-top:4px;">${escapeHtml(
              s.cases.map((c) => `[${c.dep}] id ${c.id}: ${outcomeLabel(c.outcome)}`).join(' · '),
            )}</div>`
          : '';
      return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;"><strong>${escapeHtml(tipo)}</strong>${detail}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;text-align:right;">${s.passed}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;text-align:right;">${s.failed}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;text-align:right;">${s.skipped}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;text-align:right;">${tot}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e8e0c8;text-align:center;">${est}</td>
  </tr>`;
    })
    .join('\n');

  const preContent =
    failPairCount > 0
      ? escapeHtml(failedSummaryText)
      : escapeHtml('Sin pruebas fallidas en este run.');

  const cantidad =
    failPairCount === 1
      ? '1 trámite fallido por dependencia'
      : `${failPairCount} trámites fallidos por dependencia`;

  const titulo = `Resumen trámites · ${fechaHoraSistema()}`;
  const globalLine = `Total: <strong>${total}</strong> · OK: <strong style="color:#166534;">${passed}</strong> · Fallidos: <strong style="color:#991b1b;">${failed}</strong> · Omitidos: <strong>${skipped}</strong>`;

  const leyenda = `<p style="margin:8px 0 0;font-size:12px;color:#5c4a00;">Leyenda columna «Est.»: ✓ todos OK en ese idTipoTramite · ✗ todos fallidos · ○ solo omitidos · ⚠ mezcla (OK y fallos). Si un mismo tipo aparece en varias dependencias, ves el desglose bajo el número.</p>`;

  const tabla =
    tiposSorted.length === 0
      ? '<p style="margin:0;color:#666;">No se encontraron títulos <code>[dep][tipo] ID …</code> en el JSON.</p>'
      : `<table style="width:100%;max-width:920px;border-collapse:collapse;margin:12px 0;font-size:13px;">
  <thead>
    <tr style="background:#f5efd8;">
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #c4b896;">idTipoTramite</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #c4b896;">OK</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #c4b896;">Fallidos</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #c4b896;">Omitidos</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #c4b896;">Total</th>
      <th style="text-align:center;padding:8px 10px;border-bottom:2px solid #c4b896;">Est.</th>
    </tr>
  </thead>
  <tbody>
${tableRows}
  </tbody>
</table>`;

  return `${MARK_START}
<div id="tramites-failed-resumen" style="margin:0;padding:14px 18px;background:#fff8e6;border-top:2px solid rgb(202, 186, 140);font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.45;">
  <strong style="display:block;margin-bottom:8px;color:#5c4a00;">${escapeHtml(titulo)}</strong>
  <p style="margin:0 0 12px;">${globalLine}</p>
  ${tabla}
  ${leyenda}
  <strong style="display:block;margin:18px 0 8px;color:#5c4a00;">${escapeHtml(cantidad)}</strong>
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
  const allRows = collectAllTramiteRows(report);
  const pairs = collectFailedPairs(report);
  const summaryText = buildSummaryText(pairs);
  const block = buildInjectedBlock(allRows, summaryText, pairs.length);

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
    `enrich-playwright-report: inyectado resumen (${allRows.length} casos, ${pairs.length} pares fallidos en listado).`,
  );
}

main();
