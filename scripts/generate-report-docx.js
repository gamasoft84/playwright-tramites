/**
 * Reporte Word — estructura lógica:
 * 1) Portada (título, fecha) — sin nivel de esquema → no entra al TOC automático.
 * 2) Tabla «Resumen estadístico»: OK / fallidas / omitidas / total / % por dependencia
 *    (fuente: test-results/results.json si existe).
![1774821927529](image/generate-report-docx/1774821927529.png)![1774821931560](image/generate-report-docx/1774821931560.png)![1774821944044](image/generate-report-docx/1774821944044.png)![1774821946158](image/generate-report-docx/1774821946158.png)![1774821949861](image/generate-report-docx/1774821949861.png)![1774821968778](image/generate-report-docx/1774821968778.png) * 3) «Tramites con error por dependencia» (subtítulo, no entra al TOC) + tabla; columna Dependencia
 *    con enlace al marcador «Trámites con error» de esa dependencia si hay capturas -error.
 *    Índice de contenidos (TOC) siempre en nueva página.
 * 4) TOC de Word: H1 anteriores + una sección H1 por dependencia (saltos de página).
 * 5) Cuerpo: por dependencia (H1); miniaturas sin error primero; **Trámites con error** en página nueva
 *    con marcador (enlace desde la tabla de errores, columna Dependencia).
 *
 * Convención de archivos (alineada con tests/tramites.spec.js):
 *   screenshots/{dep}-{tipo}-{id}.png
 *   screenshots/{dep}-{tipo}-{id}-error.png
 *   Legacy (2 segmentos sin id): {dep}-{tipo}.png y -error / error/
 *   *-resultado.png (legacy)
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableOfContents,
  TableBorders,
  ShadingType,
  PageBreak,
  VerticalAlignTable,
  Bookmark,
  InternalHyperlink,
  UnderlineType,
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'results.json');
const PLAYWRIGHT_CONFIG = path.join(ROOT, 'playwright.config.js');
const TRAMITES_JSON = path.join(ROOT, 'data', 'tramites.json');
const AMBIENTES_MJS = path.join(ROOT, 'ambientes.mjs');

const PAIR_RE = /\[([^\]]+)\]\[([^\]]+)\]/;
/** Máximo de columnas por fila; el número real se elige con thumbColumnCount (evita 3+1 en Word). */
const THUMB_COLS_MAX = 3;
const THUMB_WIDTH_PX = 130;

/**
 * Con 3 columnas y 4 capturas la última fila queda con 1 imagen + 2 celdas vacías; Word a menudo no muestra esa fila.
 * Ajusta columnas para que la última fila no sea un “huérfano” suelto cuando hay alternativa razonable.
 */
function thumbColumnCount(n) {
  if (n <= 0) return THUMB_COLS_MAX;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n % 3 === 1) {
    if (n % 2 === 0) return 2;
    return 4;
  }
  return THUMB_COLS_MAX;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (PNG) sobre type + data del chunk. */
function pngCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * docx deduplica imágenes por SHA1 del buffer; dos PNG idénticos en bytes
 * comparten clave y el .docx puede dejar solo una relación / una imagen visible.
 * Un chunk tEXt (metadato, sin cambiar píxeles) fuerza hashes distintos por captura.
 */
function pngWithUniqueDocxKey(pngBuf, uniqueText) {
  if (pngBuf.length < 24 || !pngBuf.subarray(0, 8).equals(PNG_SIG)) return pngBuf;
  const kw = Buffer.from('docxref', 'latin1');
  const tx = Buffer.from(String(uniqueText), 'utf8');
  const data = Buffer.concat([kw, Buffer.from([0]), tx]);
  if (data.length > 65535) return pngBuf;
  const typeBuf = Buffer.from('tEXt');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  const injected = Buffer.concat([lenBuf, typeBuf, data, crcBuf]);

  let pos = 8;
  while (pos + 12 <= pngBuf.length) {
    const len = pngBuf.readUInt32BE(pos);
    const typ = pngBuf.slice(pos + 4, pos + 8).toString('ascii');
    if (typ === 'IEND') {
      return Buffer.concat([pngBuf.subarray(0, pos), injected, pngBuf.subarray(pos)]);
    }
    pos += 12 + len;
  }
  return pngBuf;
}

/**
 * Lee `ambientes.mjs` sin ejecutarlo: el bloque del ambiente (env o UAT_SAT por defecto)
 * incluye baseURL entre comillas.
 */
function baseUrlFromAmbientesMjs() {
  if (!fs.existsSync(AMBIENTES_MJS)) return null;
  const txt = fs.readFileSync(AMBIENTES_MJS, 'utf8');
  const key = (process.env.TRAMITES_AMBIENTE || 'UAT_SAT').replace(/[^a-zA-Z0-9_]/g, '');
  if (!key) return null;
  const blockRe = new RegExp(
    `\\b${key}\\s*:\\s*\\{[\\s\\S]*?\\bbaseURL\\s*:\\s*['"]([^'"]+)['"]`,
  );
  const m = txt.match(blockRe);
  if (m) return m[1].trim();
  const any = txt.match(/baseURL:\s*['"]([^'"]+)['"]/);
  return any ? any[1].trim() : null;
}

/** Origen del front (misma idea que `use.baseURL` en Playwright). */
function resolveBaseUrl() {
  if (fs.existsSync(PLAYWRIGHT_CONFIG)) {
    const txt = fs.readFileSync(PLAYWRIGHT_CONFIG, 'utf8');
    // Literal en config (legacy); si es `baseURL` desde getAmbienteConfig(), falla y se usa ambientes.mjs
    const m = txt.match(/baseURL\s*:\s*['"]([^'"]+)['"]/);
    if (m) return m[1].trim();
  }
  const fromAmbientes = baseUrlFromAmbientesMjs();
  if (fromAmbientes) return fromAmbientes;
  if (fs.existsSync(TRAMITES_JSON)) {
    try {
      const arr = JSON.parse(fs.readFileSync(TRAMITES_JSON, 'utf8'));
      const u = Array.isArray(arr) && arr[0]?.url;
      if (u && /^https?:\/\//i.test(String(u))) {
        return new URL(String(u)).origin;
      }
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(RESULTS_JSON)) {
    try {
      const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
      const u = firstStdoutOkUrl(report);
      if (u) return new URL(u).origin;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const OK_URL_IN_STDOUT = /✅ OK:\s*(https?:\/\/\S+)/;

function firstStdoutOkUrl(report) {
  function visit(spec) {
    for (const t of spec.tests || []) {
      for (const r of t.results || []) {
        for (const o of r.stdout || []) {
          const m = (o.text || '').match(OK_URL_IN_STDOUT);
          if (m) return m[1];
        }
      }
    }
  }
  function walk(suite) {
    for (const s of suite.specs || []) visit(s);
    for (const su of suite.suites || []) walk(su);
  }
  for (const root of report.suites || []) walk(root);
  return null;
}

function sectionTitle(text) {
  return new Paragraph({
    spacing: { before: 400, after: 200 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,
        font: 'Arial',
        color: '2E4057',
      }),
    ],
  });
}

/** Subtítulo dentro de cada dependencia (no va al TOC). */
function depSubsectionTitle(text) {
  return new Paragraph({
    spacing: { before: 240, after: 140 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 24,
        font: 'Arial',
        color: '1A5276',
      }),
    ],
  });
}

/** Marcador estable para hipervínculos internos (solo letras, números y _). */
function tramErrBookmarkId(departamento) {
  return `tram_err_${String(departamento).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function compareTramiteItems(a, b) {
  const na = Number(a.tipoTramite);
  const nb = Number(b.tipoTramite);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  const tc = String(a.tipoTramite).localeCompare(String(b.tipoTramite), undefined, {
    numeric: true,
  });
  if (tc !== 0) return tc;
  const ia = a.idTramite != null ? String(a.idTramite) : '';
  const ib = b.idTramite != null ? String(b.idTramite) : '';
  return ia.localeCompare(ib, undefined, { numeric: true });
}

/** Por dependencia: primero capturas sin error, al final las de error; cada bloque ordenado por tipo. */
function splitTramitesOkThenError(items) {
  const ok = items.filter((t) => !t.isError).sort(compareTramiteItems);
  const err = items.filter((t) => t.isError).sort(compareTramiteItems);
  return { ok, err };
}

/** Fecha/hora local para portada: dd/mm/yyyy HH:mm:ss */
function formatReporteFechaHora(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const HH = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${mi}:${ss}`;
}

/**
 * Sufijo para nombre de archivo: dd-mm-yyyy-hhmmss (hora en bloque de 6 dígitos;
 * en Windows no se pueden usar / ni : en el nombre).
 */
function formatReporteNombreArchivo(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const HH = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}-${HH}${mi}${ss}`;
}

/** Quita sufijos -error / -resultado antes de partir por guiones. */
function parseNombreCaptura(filename) {
  let base = path.basename(filename, path.extname(filename));
  let isErrorSuffix = false;
  if (base.endsWith('-error')) {
    isErrorSuffix = true;
    base = base.slice(0, -'-error'.length);
  }
  if (base.endsWith('-resultado')) {
    base = base.slice(0, -'-resultado'.length);
  }
  const partes = base.split('-');
  if (partes.length < 2) return null;
  // Nuevo: {dep}-{tipo}-{idTramite} (≥3 segmentos; el último es id del JSON)
  if (partes.length >= 3) {
    const idTramite = partes[partes.length - 1];
    const tipoTramite = partes[partes.length - 2];
    const departamento = partes.slice(0, -2).join('-');
    return {
      departamento,
      tipoTramite,
      idTramite,
      isErrorSuffix,
    };
  }
  return {
    departamento: partes.slice(0, -1).join('-'),
    tipoTramite: partes[partes.length - 1],
    idTramite: null,
    isErrorSuffix,
  };
}

function collectScreenshotEntries() {
  const entries = [];
  if (!fs.existsSync(SCREENSHOTS_DIR)) return entries;

  for (const f of fs.readdirSync(SCREENSHOTS_DIR)) {
    if (f.startsWith('.')) continue;
    const full = path.join(SCREENSHOTS_DIR, f);
    if (!f.toLowerCase().endsWith('.png') || fs.statSync(full).isDirectory()) continue;
    const parsed = parseNombreCaptura(f);
    if (!parsed) continue;
    entries.push({
      relPath: f,
      archivoDisplay: f,
      isError: parsed.isErrorSuffix,
      departamento: parsed.departamento,
      tipoTramite: parsed.tipoTramite,
      idTramite: parsed.idTramite,
    });
  }

  const errDir = path.join(SCREENSHOTS_DIR, 'error');
  if (fs.existsSync(errDir)) {
    for (const f of fs.readdirSync(errDir)) {
      if (f.startsWith('.') || !f.toLowerCase().endsWith('.png')) continue;
      const parsed = parseNombreCaptura(f);
      if (!parsed) continue;
      entries.push({
        relPath: path.join('error', f),
        archivoDisplay: `error/${f}`,
        isError: true,
        departamento: parsed.departamento,
        tipoTramite: parsed.tipoTramite,
        idTramite: parsed.idTramite,
      });
    }
  }

  entries.sort((a, b) => {
    const d = a.departamento.localeCompare(b.departamento, 'es');
    if (d !== 0) return d;
    if (a.isError !== b.isError) return a.isError ? 1 : -1;
    const na = Number(a.tipoTramite);
    const nb = Number(b.tipoTramite);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    const tc = String(a.tipoTramite).localeCompare(String(b.tipoTramite), undefined, {
      numeric: true,
    });
    if (tc !== 0) return tc;
    const ia = a.idTramite != null ? String(a.idTramite) : '';
    const ib = b.idTramite != null ? String(b.idTramite) : '';
    return ia.localeCompare(ib, undefined, { numeric: true });
  });

  return entries;
}

function specOutcome(spec) {
  if (spec.ok === false) return 'failed';
  if (spec.ok === true) return 'passed';
  const statuses =
    spec.tests?.flatMap((t) => t.results?.map((r) => r.status) || []) || [];
  if (statuses.some((s) => ['failed', 'timedOut', 'interrupted'].includes(s))) return 'failed';
  if (statuses.length && statuses.every((s) => s === 'skipped')) return 'skipped';
  if (statuses.some((s) => s === 'passed')) return 'passed';
  return 'failed';
}

function visitSpecs(suite, fn) {
  for (const spec of suite.specs || []) fn(spec);
  for (const s of suite.suites || []) visitSpecs(s, fn);
}

/** statsByDep: { [dep]: { passed, failed, skipped } }; failedByDep: Map<dep, Set<tipo>> */
function analyzeResultsJson() {
  const statsByDep = {};
  const failedByDep = new Map();

  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn(`⚠️  No existe ${RESULTS_JSON} — tablas JSON vacías (solo capturas).`);
    return { statsByDep, failedByDep };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  } catch (e) {
    console.warn('⚠️  No se pudo leer results.json:', e.message);
    return { statsByDep, failedByDep };
  }

  for (const root of report.suites || []) {
    visitSpecs(root, (spec) => {
      const m = spec.title?.match(PAIR_RE);
      if (!m) return;
      const dep = m[1];
      const tipo = m[2];
      if (!statsByDep[dep]) {
        statsByDep[dep] = { passed: 0, failed: 0, skipped: 0 };
      }
      const o = specOutcome(spec);
      statsByDep[dep][o] += 1;
      if (o === 'failed') {
        if (!failedByDep.has(dep)) failedByDep.set(dep, new Set());
        failedByDep.get(dep).add(tipo);
      }
    });
  }

  return { statsByDep, failedByDep };
}

function headerCell(text) {
  return new TableCell({
    shading: { fill: '2E75B6', type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            color: 'FFFFFF',
            size: 20,
            font: 'Arial',
          }),
        ],
      }),
    ],
  });
}

function bodyCell(text, opts = {}) {
  return new TableCell({
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text),
            size: 21,
            font: 'Arial',
            color: opts.color,
            bold: opts.bold,
            italics: opts.italics,
          }),
        ],
      }),
    ],
  });
}

/** Celda dependencia: hipervínculo al marcador tram_err_* si hay sección con capturas de error. */
function bodyCellDependenciaConEnlaceTramErr(dep, tieneMarcador) {
  if (!tieneMarcador) return bodyCell(dep);
  return new TableCell({
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new InternalHyperlink({
            anchor: tramErrBookmarkId(dep),
            children: [
              new TextRun({
                text: dep,
                size: 21,
                font: 'Arial',
                color: '0563C1',
                underline: { type: UnderlineType.SINGLE },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildStatsTable(statsByDep) {
  const deps = Object.keys(statsByDep).sort((a, b) => a.localeCompare(b, 'es'));
  if (deps.length === 0) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TableBorders.NONE,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: 'No hay datos de results.json. Ejecuta: npx playwright test (o npm run test:tramites).',
                      italics: true,
                      color: '994444',
                      size: 22,
                      font: 'Arial',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  const rows = [
    new TableRow({
      children: [
        headerCell('Dependencia'),
        headerCell('Correctas'),
        headerCell('Fallidas'),
        headerCell('Omitidas'),
        headerCell('Total'),
        headerCell('% éxito'),
      ],
    }),
  ];

  let tPass = 0;
  let tFail = 0;
  let tSkip = 0;

  for (const dep of deps) {
    const s = statsByDep[dep];
    const total = s.passed + s.failed + s.skipped;
    const pct = total ? Math.round((s.passed / total) * 1000) / 10 : 0;
    tPass += s.passed;
    tFail += s.failed;
    tSkip += s.skipped;
    rows.push(
      new TableRow({
        children: [
          bodyCell(dep),
          bodyCell(s.passed),
          bodyCell(s.failed, s.failed > 0 ? { color: 'B00020', bold: true } : {}),
          bodyCell(s.skipped),
          bodyCell(total),
          bodyCell(`${pct}%`),
        ],
      }),
    );
  }

  const gTotal = tPass + tFail + tSkip;
  const gPct = gTotal ? Math.round((tPass / gTotal) * 1000) / 10 : 0;
  rows.push(
    new TableRow({
      children: [
        headerCell('TOTAL'),
        headerCell(String(tPass)),
        headerCell(String(tFail)),
        headerCell(String(tSkip)),
        headerCell(String(gTotal)),
        headerCell(`${gPct}%`),
      ],
    }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    columnWidths: [2200, 1200, 1200, 1200, 1200, 1400],
    rows,
  });
}

function formatTipoList(set) {
  if (!set || set.size === 0) return '—';
  return [...set].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b))).join(', ');
}

/** Tabla: dep | # fallos JSON | tipos (JSON) | tipos con PNG error. `depsConMarcadorTramErr`: deps con sección «Trámites con error» en el cuerpo. */
function buildErrorsTable(failedByDep, errorPngByDep, depsConMarcadorTramErr) {
  const deps = new Set([...failedByDep.keys(), ...Object.keys(errorPngByDep)]);
  const sorted = [...deps].filter((d) => {
    const fj = failedByDep.get(d)?.size || 0;
    const fp = errorPngByDep[d]?.size || 0;
    return fj > 0 || fp > 0;
  }).sort((a, b) => a.localeCompare(b, 'es'));

  if (sorted.length === 0) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TableBorders.NONE,
      rows: [
        new TableRow({
          children: [bodyCell('No hay errores registrados en results.json ni capturas *-error.png / error/.')],
        }),
      ],
    });
  }

  const rows = [
    new TableRow({
      children: [
        headerCell('Dependencia'),
        headerCell('Fallos'),
        headerCell('Tipos de tramites con error'),
      ],
    }),
  ];

  for (const dep of sorted) {
    const jsonSet = failedByDep.get(dep) || new Set();
    const pngSet = errorPngByDep[dep] || new Set();
    const tieneMarcador = depsConMarcadorTramErr.has(dep);
    rows.push(
      new TableRow({
        children: [
          bodyCellDependenciaConEnlaceTramErr(dep, tieneMarcador),
          bodyCell(jsonSet.size),
          bodyCell(formatTipoList(jsonSet))
        ],
      }),
    );
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    columnWidths: [2000, 1200, 4500, 4500],
    rows,
  });
}

function thumbCell(item) {
  const imagePath = path.join(SCREENSHOTS_DIR, item.relPath);
  const raw = fs.readFileSync(imagePath);
  const buf = pngWithUniqueDocxKey(raw, item.archivoDisplay || item.relPath);
  const dim = imageSize(buf);
  const w = THUMB_WIDTH_PX;
  const h = Math.max(1, Math.round((dim.height * w) / dim.width));

  return new TableCell({
    margins: { top: 80, bottom: 80, left: 60, right: 60 },
    verticalAlign: VerticalAlignTable.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new ImageRun({
            data: buf,
            type: 'png',
            transformation: { width: w, height: h },
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: `Tipo ${item.tipoTramite}${
              item.idTramite != null ? ` (id ${item.idTramite})` : ''
            }${item.isError ? '  ⚠ error' : ''}`,
            bold: true,
            size: 18,
            color: item.isError ? 'B00020' : '1A5276',
            font: 'Arial',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: item.archivoDisplay,
            size: 14,
            italics: true,
            color: '888888',
            font: 'Arial',
          }),
        ],
      }),
    ],
  });
}

function emptyThumbCell() {
  return new TableCell({
    children: [new Paragraph({ text: '\u00a0', spacing: { after: 120 } })],
  });
}

/**
 * Varias tablas de 1 fila en lugar de una tabla multirrelacionada: Word a veces no pinta
 * la 2.ª fila si además se fija altura/cantSplit, o colapsa filas con celdas vacías.
 */
function buildThumbnailTables(items) {
  const cols = thumbColumnCount(items.length);
  const colW = Math.floor(9000 / cols);
  const columnWidths = Array(cols).fill(colW);
  const tables = [];

  for (let i = 0; i < items.length; i += cols) {
    const chunk = items.slice(i, i + cols);
    const cells = chunk.map((it) => thumbCell(it));
    while (cells.length < cols) cells.push(emptyThumbCell());
    tables.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TableBorders.NONE,
        columnWidths,
        rows: [new TableRow({ children: cells })],
      }),
    );
  }
  return tables;
}

// ─── Datos ───
const archivos = collectScreenshotEntries();
console.log(`📸 Capturas: ${archivos.length} (${SCREENSHOTS_DIR})`);

const { statsByDep, failedByDep } = analyzeResultsJson();

const errorPngByDep = {};
for (const e of archivos) {
  if (!e.isError) continue;
  if (!errorPngByDep[e.departamento]) errorPngByDep[e.departamento] = new Set();
  errorPngByDep[e.departamento].add(e.tipoTramite);
}

const porDepartamento = {};
for (const item of archivos) {
  if (!porDepartamento[item.departamento]) porDepartamento[item.departamento] = [];
  porDepartamento[item.departamento].push(item);
}
const departamentosOrdenados = Object.keys(porDepartamento).sort((a, b) =>
  a.localeCompare(b, 'es'),
);

/** Dependencias que tendrán marcador «Trámites con error» (enlace desde la tabla de errores). */
const depsConMarcadorTramErr = new Set();
for (const d of departamentosOrdenados) {
  const { err } = splitTramitesOkThenError(porDepartamento[d]);
  if (err.length > 0) depsConMarcadorTramErr.add(d);
}

console.log(`🏢 Dependencias con captura: ${departamentosOrdenados.join(', ') || '(ninguna)'}`);

const baseUrl = resolveBaseUrl();
if (baseUrl) {
  console.log(`🌐 Base URL del entorno: ${baseUrl}`);
} else {
  console.warn(
    '⚠️  No se detectó baseURL (playwright.config literal, ambientes.mjs, data/tramites.json o results.json).',
  );
}

const children = [];

children.push(
  new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200 },
    children: [
      new TextRun({
        text: 'Reporte de trámites',
        bold: true,
        size: 56,
        font: 'Arial',
        color: '1A5276',
      }),
    ],
  }),
);

const ahora = new Date();
const fechaHoraDoc = formatReporteFechaHora(ahora);
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: `Generado: ${fechaHoraDoc}`,
        size: 22,
        color: '666666',
        font: 'Arial',
      }),
    ],
  }),
);

children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: baseUrl
          ? `Pruebas ejecutadas contra: ${baseUrl}`
          : 'Pruebas ejecutadas contra: (no detectado — use.baseURL en playwright.config.js o ejecuta tests y vuelve a generar el reporte)',
        italics: true,
        size: 20,
        color: '888888',
        font: 'Arial',
      }),
    ],
  }),
);

children.push(sectionTitle('Resumen estadístico (por dependencia)'));

children.push(buildStatsTable(statsByDep));

children.push(
  new Paragraph({
    children: [new PageBreak()],
  }),
);
children.push(sectionTitle('Tramites con error por dependencia'));

children.push(buildErrorsTable(failedByDep, errorPngByDep, depsConMarcadorTramErr));

children.push(
  new Paragraph({
    children: [new PageBreak()],
  }),
);

children.push(sectionTitle('Índice de contenidos (secciones por dependencia)'));
children.push(
  new TableOfContents('Contenido', {
    hyperlink: true,
    headingStyleRange: '1-1',
  }),
);

children.push(
  new Paragraph({
    children: [new PageBreak()],
  }),
);

for (let di = 0; di < departamentosOrdenados.length; di++) {
  const departamento = departamentosOrdenados[di];
  const tramites = porDepartamento[departamento];

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: di > 0,
      spacing: { before: di > 0 ? 0 : 120, after: 160 },
      children: [
        new TextRun({
          text: departamento.toUpperCase(),
          bold: true,
          size: 36,
          font: 'Arial',
          color: '2E4057',
        }),
      ],
    }),
  );

  const st = statsByDep[departamento];
  const statLine =
    st != null
      ? `Estadística: ${st.passed} OK · ${st.failed} fallidas · ${st.skipped} omitidas`
      : 'Sin datos de results.json para esta dependencia.';
  const { ok: tramitesOk, err: tramitesErr } = splitTramitesOkThenError(tramites);
  const nOk = tramitesOk.length;
  const nErr = tramitesErr.length;
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 },
      },
      children: [
        new TextRun({
          text: `${tramites.length} captura(s) (${nOk} sin error · ${nErr} con error) · ${statLine}`,
          size: 20,
          color: '666666',
          font: 'Arial',
        }),
      ],
    }),
  );

  if (nOk > 0) {
    children.push(depSubsectionTitle('Trámites Sin error'));
    for (const tbl of buildThumbnailTables(tramitesOk)) {
      children.push(tbl);
      children.push(new Paragraph({ spacing: { after: 160 } }));
    }
  }

  if (nErr > 0) {
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        spacing: { before: 240, after: 140 },
        children: [
          new Bookmark({
            id: tramErrBookmarkId(departamento),
            children: [
              new TextRun({
                text: 'Trámites con error',
                bold: true,
                size: 24,
                font: 'Arial',
                color: '1A5276',
              }),
            ],
          }),
        ],
      }),
    );
    for (const tbl of buildThumbnailTables(tramitesErr)) {
      children.push(tbl);
      children.push(new Paragraph({ spacing: { after: 160 } }));
    }
  }
}

if (archivos.length === 0) {
  children.push(
    new Paragraph({
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: 'No hay PNG en screenshots/. Esperados: {dep}-{tipo}-{id}.png, -error, legacy {dep}-{tipo}.png o error/*.png',
          italics: true,
          color: '994444',
        }),
      ],
    }),
  );
}

const doc = new Document({
  features: {
    updateFields: true,
  },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 24 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '2E4057' },
        paragraph: { spacing: { before: 200, after: 160 }, outlineLevel: 0 },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: 'Reporte de trámites',
                  size: 18,
                  color: 'AAAAAA',
                  italics: true,
                  font: 'Arial',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 40 },
              children: [
                new TextRun({
                  text: fechaHoraDoc,
                  size: 16,
                  color: 'BBBBBB',
                  font: 'Arial',
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 100 },
              children: [
                new TextRun({ text: 'Página ', size: 20, color: '666666', font: 'Arial' }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 20,
                  color: '666666',
                  font: 'Arial',
                }),
                new TextRun({ text: ' de ', size: 20, color: '666666', font: 'Arial' }),
                new TextRun({
                  children: [PageNumber.TOTAL_PAGES],
                  size: 20,
                  color: '666666',
                  font: 'Arial',
                }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const outputPath = path.join(
  ROOT,
  `reporte-tramites-${formatReporteNombreArchivo(ahora)}.docx`,
);

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log(`\n✅ Word: ${outputPath}`);
  console.log(`📊 Capturas en documento: ${archivos.length}`);
  console.log('💡 En Word: actualizar campos del índice (clic derecho → Actualizar campo).');
});
