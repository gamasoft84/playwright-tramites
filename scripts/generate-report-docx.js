import {
  Document, Packer, Paragraph, TextRun, ImageRun,
  HeadingLevel, AlignmentType, BorderStyle
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageSize } from 'image-size';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 📁 Carpeta donde están los screenshots
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// ─────────────────────────────────────────
// 1️⃣ Lee todas las imágenes de resultado
// ─────────────────────────────────────────
const archivos = fs.readdirSync(SCREENSHOTS_DIR)
  .filter(f => f.endsWith('-resultado.png'))
  .sort();

console.log(`📸 Imágenes encontradas: ${archivos.length}`);

// ─────────────────────────────────────────
// 2️⃣ Agrupa por departamento
// ─────────────────────────────────────────
const porDepartamento = {};

for (const archivo of archivos) {
  const sinExtension = archivo.replace('-resultado.png', '');
  const partes = sinExtension.split('-');
  const tipoTramite = partes[partes.length - 1];
  const departamento = partes.slice(0, partes.length - 1).join('-');

  if (!porDepartamento[departamento]) {
    porDepartamento[departamento] = [];
  }

  porDepartamento[departamento].push({ archivo, tipoTramite, departamento });
}

console.log(`🏢 Departamentos encontrados: ${Object.keys(porDepartamento).join(', ')}`);

// ─────────────────────────────────────────
// 3️⃣ Genera el contenido del Word
// ─────────────────────────────────────────
const children = [];

// Título principal
children.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 400 },
    children: [
      new TextRun({
        text: 'Reporte de Trámites',
        bold: true,
        size: 40,
        font: 'Arial',
      })
    ]
  })
);

// Fecha de generación
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 600 },
    children: [
      new TextRun({
        text: `Generado: ${new Date().toLocaleDateString('es-MX', {
          year: 'numeric', month: 'long', day: 'numeric'
        })}`,
        size: 20,
        color: '666666',
        font: 'Arial',
      })
    ]
  })
);

// ─── Por cada departamento ───
for (const [departamento, tramites] of Object.entries(porDepartamento)) {

  // Título del departamento
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      children: [
        new TextRun({
          text: `Departamento: ${departamento.toUpperCase()}`,
          bold: true,
          size: 32,
          font: 'Arial',
          color: '2E4057',
        })
      ]
    })
  );

  // Línea separadora
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 300 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 }
      },
      children: [new TextRun({ text: '' })]
    })
  );

  // ─── Por cada trámite del departamento ───
  for (const tramite of tramites) {

    // Subtítulo del trámite
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
        children: [
          new TextRun({
            text: `Tipo de Trámite: ${tramite.tipoTramite}`,
            bold: true,
            size: 26,
            font: 'Arial',
            color: '1A5276',
          })
        ]
      })
    );

    // Carga la imagen como Buffer y calcula el 70%
    const imagePath = path.join(SCREENSHOTS_DIR, tramite.archivo);
    const imageBuffer = fs.readFileSync(imagePath);
    const dimensions = imageSize(imageBuffer);
    const width = Math.round(dimensions.width * 0.30);
    const height = Math.round(dimensions.height * 0.30);

    console.log(`  📐 ${tramite.archivo}: ${dimensions.width}x${dimensions.height} → ${width}x${height}`);

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 300 },
        children: [
          new ImageRun({
            data: imageBuffer,
            type: 'png',
            transformation: { width, height }
          })
        ]
      })
    );
  }
}

// ─────────────────────────────────────────
// 4️⃣ Crea el documento Word
// ─────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 24 } }
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 }
      },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children
  }]
});

// ─────────────────────────────────────────
// 5️⃣ Guarda el archivo
// ─────────────────────────────────────────
Packer.toBuffer(doc).then(buffer => {
  const outputPath = path.join(__dirname, 'reporte-tramites.docx');
  fs.writeFileSync(outputPath, buffer);
  console.log(`\n✅ Word generado: reporte-tramites.docx`);
  console.log(`📊 Total trámites incluidos: ${archivos.length}`);
});
