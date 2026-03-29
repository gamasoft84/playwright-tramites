# Comandos del proyecto

## Requisitos previos

- Node.js instalado.
- Dependencias: `npm install`
- Navegadores de Playwright (si no los tienes): `npx playwright install`

---

## Scripts npm (`package.json`)

| Comando | Qué hace |
|--------|-----------|
| `npm run test:tramites` | **Único** punto de entrada: ambiente **obligatorio** (`--ambiente`), filtros opcionales (`--deps`, `--tipos`, `--ids`, o `--grep`). **Antes** de correr Playwright vacía `screenshots/` y `test-results/`. Luego ejecuta los tests, `enrich` del HTML y abre el reporte (salvo `--no-show-report`). |
| `npm run report:enrich` | Solo inyecta el resumen por dependencia en `playwright-report/index.html` (lee `test-results/results.json`). Útil si ya corriste los tests y quieres regenerar la banda sin repetir la suite. |

El script `test` por defecto del `package.json` no está configurado para este proyecto; usa `test:tramites` para las pruebas de trámites.

### `test:tramites` — ambiente y filtros

Siempre debes indicar el ambiente:

- `UAT_SAT` → `https://wwwdev.ventanillaunica.gob.mx` y `data/tramites_UAT_SAT.json`
- `UAT_ULTRASIST` → `https://front.v30.ultrasist.net` y `data/tramites_UAT_ULTRASIST.json`

Título de cada test (para `--grep` interno): **`[departamento][tipoTramite] ID <id>`** (ej. `[aga][103] ID 604`).

| Opción | Descripción |
|--------|-------------|
| `--ambiente UAT_SAT` \| `UAT_ULTRASIST` | Obligatorio. |
| `--deps aga,agace` | Filtra por departamento (primer corchete). |
| `--tipos 103,104,105` | Filtra por `tipoTramite` (segundo corchete). |
| `--ids 604,172` | Filtra por el `id` del JSON (texto `ID xxx` al final del título). |
| `--grep '<regex>'` | Patrón manual para Playwright; **tiene prioridad** sobre `--deps` / `--tipos` / `--ids`. |
| `--no-show-report` | No abre el reporte HTML al final (sí ejecuta enrich). |

`--deps`, `--tipos` e `--ids` se pueden **combinar** (se traducen a un solo `--grep` con lógica **Y**).



Ayuda en consola:

```bash
npm run test:tramites -- --help
```

Tras `test:tramites`, el servidor de **`show-report`** sigue activo hasta que lo cierres (Ctrl+C en la terminal).

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

Si llamas a Playwright **sin** pasar por `npm run test:tramites`, debes definir **`TRAMITES_AMBIENTE`** (`UAT_SAT` o `UAT_ULTRASIST`), porque `playwright.config.js` lo exige:

```bash
TRAMITES_AMBIENTE=UAT_SAT npx playwright test tests/tramites.spec.js
```

Equivalente manual + enrich (sin abrir el navegador):

```bash
TRAMITES_AMBIENTE=UAT_SAT npx playwright test tests/tramites.spec.js --grep '\[(aga|agace)\]' ; npm run report:enrich
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

Genera **`reporte-tramites-<dd-mm-yyyy-hhmmss>.docx`** en la **raíz** (fecha/hora local; la hora va en bloque `hhmmss`; guiones solo en la fecha porque `/` y `:` no son válidos en Windows).

**Orden del documento:** portada → **tabla resumen** (correctas / fallidas / omitidas / total / % por dependencia desde `test-results/results.json`) → **tabla índice de errores** (fallos JSON + listas de tipos; columnas comparan con capturas `*-error.png` y `screenshots/error/`) → **TOC de Word** (solo secciones H1 = cada dependencia) → cuerpo por **dependencia** (H1): subtítulos **Sin error** y **Con error** (capturas OK primero, `-error` / `error/` al final), miniaturas ~130 px.

**Capturas:** `screenshots/{dep}-{tipo}.png`, `{dep}-{tipo}-error.png`, `error/{dep}-{tipo}.png`, `*-resultado.png` (legacy).

Tras las pruebas conviene tener `test-results/results.json` actualizado para las tablas estadísticas.

```bash
node ./scripts/generate-report-docx.js
```

---

## Otros archivos de prueba

- `tests/tramites.spec_Login.js` — variante con flujo de login (si la usas):  
  `npx playwright test tests/tramites.spec_Login.js`
- `playwright.config_Login.js` — config alternativa; solo aplica si la pasas con `--config` o la renombras según tu flujo.

```bash
npx playwright test --config=playwright.config_Login.js
```




Ejemplos:

```bash
# Todos los trámites del ambiente SAT
npm run test:tramites -- --ambiente UAT_SAT

# Ultrasist completo
npm run test:tramites -- --ambiente UAT_ULTRASIST

# Solo aga y agace
npm run test:tramites -- --ambiente UAT_SAT --deps aga,agace

# Por tipos de trámite (cualquier dependencia)
npm run test:tramites -- --ambiente UAT_SAT --tipos 103,104,105


# Por ids del JSON
npm run test:tramites -- --ambiente UAT_SAT --ids 604,172

# Sin abrir el navegador al final
npm run test:tramites -- --ambiente UAT_SAT --deps cofepris --no-show-report

# Regex a mano (equivalente a varias dependencias)
npm run test:tramites -- --ambiente UAT_SAT --grep '\[(aga|agace)\]' --no-show-report

# aga + tipos concretos
npm run test:tramites -- --ambiente UAT_SAT --deps aga --tipos 103,104 --no-show-report

#Genera la documentación de las pruebas
node ./scripts/generate-report-docx.js


```