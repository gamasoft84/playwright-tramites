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
| `npm run test:tramites:grep` | Igual, pero el patrón de `--grep` lo pasas **tú** después de `--` (ver abajo). Siempre ejecuta el enrich al final. |
| `npm run test:tramites:aga-agace` | Atajo: mismo flujo con el patrón fijo `[(aga|agace)]` (equivale a un `test:tramites:grep` con ese regex). |
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

## Reporte Word desde capturas (`generate-report.js`)

Genera **`reporte-tramites.docx`** en la raíz del proyecto a partir de imágenes `screenshots/*-resultado.png`:

```bash
node generate-report.js
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

Equivalente manual + enrich:

```bash
npx playwright test tests/tramites.spec.js --grep '\[(aga|agace)\]' ; npm run report:enrich
```



## Prueabas por dependencias
```bash
npm run test:tramites
npm run test:tramites:grep -- '\[(aga|agace)\]'
npm run test:tramites:grep -- '\[cofepris\]'
npm run test:tramites:grep -- '\[(aga|agace|se)\]'
```



## Generar .DOCX
```bash
node generate-report-docx.js
```