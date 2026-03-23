# Comandos del proyecto

## Requisitos previos

- Node.js instalado.
- Dependencias: `npm install`
- Navegadores de Playwright (si no los tienes): `npx playwright install`

---

## Scripts npm (`package.json`)

| Comando | Qué hace |
|--------|-----------|
| `npm run test:tramites` | Ejecuta `tests/tramites.spec.js` y **después** corre `scripts/enrich-playwright-report.mjs`. Usa `;` entre comandos: el enriquecimiento del HTML corre **aunque haya tests fallidos**. |
| `npm run test:tramites:grep` | `--grep` con patrón que pasas tras `--`, luego **enrich** del HTML y **`npx playwright show-report`** (abre el reporte en el navegador; el proceso sigue hasta que cierres el servidor, p. ej. Ctrl+C en la terminal). |
| `npm run test:tramites:aga-agace` | Atajo con patrón fijo `[(aga|agace)]`; mismo flujo (tests → enrich → **show-report**). |
| `npm run report:enrich` | Solo inyecta el resumen por dependencia en `playwright-report/index.html` (lee `test-results/results.json`). Útil si ya corriste los tests y quieres regenerar la banda sin repetir la suite. |

El script `test` por defecto del `package.json` no está configurado para este proyecto; usa `test:tramites` para las pruebas de trámites.

---

## Playwright (CLI directa)

Desde la raíz del proyecto:

```bash
# Todos los tests del directorio tests/ (según config)
npx playwright test

# Solo trámites
npx playwright test tests/tramites.spec.js

# Salida en consola tipo lista
npx playwright test --reporter=list

# Reporte HTML (además de lo definido en playwright.config.js)
npx playwright test --reporter=html

# List + HTML en la misma corrida
npx playwright test --reporter=list --reporter=html

# Ajustar workers en esta ejecución (pisa el valor del config)
npx playwright test --workers=4
```

Abrir el último reporte HTML generado:

```bash
npx playwright show-report
```

---

## Configuración relevante (`playwright.config.js`)

- **Reporters:** `list`, `html` (sin abrir navegador al terminar), `json` → `test-results/results.json`.
- **Paralelo:** `fullyParallel` y `workers` (número o ajústalo según CPU y carga del servidor).
- **`maxFailures: 0`:** no se detiene el run al primer fallo; se ejecutan todos los tests.

Carpetas generadas (suelen estar en `.gitignore`): `test-results/`, `playwright-report/`.

---

## Resumen en el reporte HTML (`enrich-playwright-report.mjs`)

El script lee fallidos desde `test-results/results.json`, agrupa por dependencia y título `[dep][tipo]` e inserta una banda al final del `<body>` en `playwright-report/index.html` (justo antes de `</body>`).

```bash
node scripts/enrich-playwright-report.mjs
# equivalente:
npm run report:enrich
```

Requiere haber corrido los tests al menos una vez con el reporter `json` activo (como en el config actual).

---

## Reporte Word desde capturas (`scripts/generate-report-docx.js`)

Genera **`reporte-tramites.docx`** en la **raíz**.

**Orden del documento:** portada → **tabla resumen** (correctas / fallidas / omitidas / total / % por dependencia desde `test-results/results.json`) → **tabla índice de errores** (fallos JSON + listas de tipos; columnas comparan con capturas `*-error.png` y `screenshots/error/`) → **TOC de Word** (solo secciones H1 = cada dependencia) → cuerpo con **rejilla de miniaturas** (3 columnas, ~130 px de ancho) para meter varias capturas por página.

**Capturas:** `screenshots/{dep}-{tipo}.png`, `{dep}-{tipo}-error.png`, `error/{dep}-{tipo}.png`, `*-resultado.png` (legacy).

Tras las pruebas conviene tener `test-results/results.json` actualizado para las tablas estadísticas.

```bash
node scripts/generate-report-docx.js
```

---

## Otros archivos de prueba

- `tests/tramites.spec_Login.js` — variante con flujo de login (si la usas):  
  `npx playwright test tests/tramites.spec_Login.js`
- `playwright.config_Login.js` — config alternativa; solo aplica si la pasas con `--config` o la renombras según tu flujo.

```bash
npx playwright test --config=playwright.config_Login.js
```

## Filtrar por dependencia en el título (`--grep`)

Playwright filtra por el **título completo** del test (incluye el `describe`), p. ej. `Trámites › [aga][40401] ID 132`.

**Patrón parametrizable (npm):** todo lo que va después de `--` se pasa a Playwright como único argumento de `--grep`.

```bash
# Cofepris solamente
npm run test:tramites:grep -- '\[cofepris\]'

# Varias dependencias (regex)
npm run test:tramites:grep -- '\[(aga|agace|se)\]'

# Atajo fijo aga + agace
npm run test:tramites:aga-agace
```

`test:tramites:grep` y `test:tramites:aga-agace` ejecutan al final **`npx playwright show-report`** (servidor local del reporte HTML). Cierra la terminal o interrumpe con Ctrl+C cuando termines de revisarlo.

Equivalente manual + enrich (sin abrir el navegador):

```bash
npx playwright test tests/tramites.spec.js --grep '\[(aga|agace)\]' ; npm run report:enrich
```



## Pruebas por dependencias
```bash
npm run test:tramites
npm run test:tramites:grep -- '\[(aga|agace)\]'
npm run test:tramites:grep -- '\[cofepris\]'
npm run test:tramites:grep -- '\[(aga|agace|se)\]'

npm run test:tramites:grep -- '\[(semarnat|agricultura|inbal)\]'
```



## Generar .DOCX
```bash
node ./scripts/generate-report-docx.js
```


## Usar ambientes
```bash
npm run test:tramites:uat-ultrasist 
npm run test:tramites:uat-sat       
npm run test:tramites (default uat-sat)
```