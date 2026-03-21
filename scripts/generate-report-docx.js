/**
 * Reporte Word — estructura lógica:
 * 1) Portada (título, fecha) — sin nivel de esquema → no entra al TOC automático.
 * 2) Tabla «Resumen estadístico»: OK / fallidas / omitidas / total / % por dependencia
 *    (fuente: test-results/results.json si existe).
 * 3) Tabla «Errores por dependencia»: tipos fallidos según JSON + tipos con captura
 *    *-error.png o screenshots/error/* (cruce informativo).
 * 4) TOC de Word: solo títulos H1 = una sección por dependencia (saltos de página).
 * 5) Cuerpo: por dependencia, rejilla de miniaturas (varias por fila).
 *
 * Convención de archivos (alineada con tests/tramites.spec.js):
 *   screenshots/{dep}-{tipo}.png
 *   screenshots/{dep}-{tipo}-error.png
 *   screenshots/error/{dep}-{tipo}.png (legacy)
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
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const RESULTS_JSON = path.join(ROOT, 'test-results', 'results.json');

const PAIR_RE = /\[([^\]]+)\]\[([^\]]+)\]/;
const THUMB_COLS = 3;
const THUMB_WIDTH_PX = 130;

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
  return {
    departamento: partes.slice(0, partes.length - 1).join('-'),
    tipoTramite: partes[partes.length - 1],
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
      });
    }
  }

  entries.sort((a, b) => {
    const d = a.departamento.localeCompare(b.departamento, 'es');
    if (d !== 0) return d;
    if (a.isError !== b.isError) return a.isError ? 1 : -1;
    const na = Number(a.tipoTramite);
    const nb = Number(b.tipoTramite);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a.tipoTramite).localeCompare(String(b.tipoTramite), undefined, {
      numeric: true,
    });
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

/** Tabla: dep | # fallos JSON | tipos (JSON) | tipos con PNG error */
function buildErrorsTable(failedByDep, errorPngByDep) {
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
        headerCell('Tipos fallidos (test)'),
        headerCell('Tipos con captura error'),
      ],
    }),
  ];

  for (const dep of sorted) {
    const jsonSet = failedByDep.get(dep) || new Set();
    const pngSet = errorPngByDep[dep] || new Set();
    rows.push(
      new TableRow({
        children: [
          bodyCell(dep),
          bodyCell(jsonSet.size),
          bodyCell(formatTipoList(jsonSet)),
          bodyCell(formatTipoList(pngSet)),
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
  const buf = fs.readFileSync(imagePath);
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
            text: `Tipo ${item.tipoTramite}${item.isError ? '  ⚠ error' : ''}`,
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

function buildThumbnailTable(items) {
  const colW = Math.floor(9000 / THUMB_COLS);
  const columnWidths = Array(THUMB_COLS).fill(colW);
  const rows = [];

  for (let i = 0; i < items.length; i += THUMB_COLS) {
    const chunk = items.slice(i, i + THUMB_COLS);
    const cells = chunk.map((it) => thumbCell(it));
    while (cells.length < THUMB_COLS) {
      cells.push(
        new TableCell({
          children: [new Paragraph({})],
        }),
      );
    }
    rows.push(new TableRow({ children: cells }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    columnWidths,
    rows,
  });
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

console.log(`🏢 Dependencias con captura: ${departamentosOrdenados.join(', ') || '(ninguna)'}`);

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
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: `Generado: ${ahora.toLocaleString('es-MX', {
          dateStyle: 'long',
          timeStyle: 'short',
        })}`,
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
        text: 'Miniaturas por dependencia · Estadísticas desde results.json',
        italics: true,
        size: 20,
        color: '888888',
        font: 'Arial',
      }),
    ],
  }),
);

children.push(sectionTitle('Resumen estadístico (por dependencia)'));
children.push(
  new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: 'Fuente: test-results/results.json (última corrida de Playwright).',
        size: 20,
        color: '666666',
        font: 'Arial',
      }),
    ],
  }),
);
children.push(buildStatsTable(statsByDep));

children.push(sectionTitle('Índice de errores por dependencia'));
children.push(
  new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: 'Fallos según results.json; capturas *-error.png o carpeta error/ (pueden contrastarse).',
        size: 20,
        color: '666666',
        font: 'Arial',
      }),
    ],
  }),
);
children.push(buildErrorsTable(failedByDep, errorPngByDep));

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
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 },
      },
      children: [
        new TextRun({
          text: `${tramites.length} captura(s) · ${statLine}`,
          size: 20,
          color: '666666',
          font: 'Arial',
        }),
      ],
    }),
  );

  children.push(buildThumbnailTable(tramites));
}

if (archivos.length === 0) {
  children.push(
    new Paragraph({
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: 'No hay PNG en screenshots/. Esperados: {dep}-{tipo}.png, {dep}-{tipo}-error.png o error/*.png',
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

const outputPath = path.join(ROOT, 'reporte-tramites.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log(`\n✅ Word: ${outputPath}`);
  console.log(`📊 Capturas en documento: ${archivos.length}`);
  console.log('💡 En Word: actualizar campos del índice (clic derecho → Actualizar campo).');
});
