import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AMBIENTES = {
  UAT_ULTRASIST: {
    baseURL: 'https://front.v30.ultrasist.net',
    tramitesFile: 'tramites_UAT_ULTRASIST.json',
    baseURLFull: 'https://front.v30.ultrasist.net/seleccion-tramite'
  },
  UAT_SAT: {
    baseURL: 'http://10.218.140.246:8080',
    tramitesFile: 'tramites_UAT_SAT.json',
    baseURLFull: 'http://10.218.140.246:8080/seleccion-tramite'
  },
  DEV_SAT: {
    baseURL: 'https://wwwdev.ventanillaunica.gob.mx',
    tramitesFile: 'tramites_DEV_SAT.json',
    baseURLFull: 'https://wwwdev.ventanillaunica.gob.mx/seleccion-tramite'
  }
};

const KEYS = new Set(Object.keys(AMBIENTES));

export function getAmbienteConfig() {
  const key = (process.env.TRAMITES_AMBIENTE || '').trim();
  if (!KEYS.has(key)) {
    throw new Error(
      `Defina TRAMITES_AMBIENTE. Valores: ${[...KEYS].join(', ')}. ` +
        'Ej.: npm run test:tramites:uat-sat   o   PowerShell: $env:TRAMITES_AMBIENTE="UAT_ULTRASIST"; npx playwright test'
    );
  }
  return { ambienteKey: key, ...AMBIENTES[key] };
}

/** SAT usa departmento/URL; Ultrasist usa departamento/url */
export function normalizeTramites(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    id: String(t.id),
    departamento: t.departamento ?? t.departmento,
    tipoTramite: String(t.tipoTramite),
    url: t.url ?? t.URL,
  }));
}

/** @param {ReturnType<typeof getAmbienteConfig>} [config] evita leer getAmbienteConfig dos veces en el spec */
export function loadTramitesNormalized(config = getAmbienteConfig()) {
  const filePath = path.join(__dirname, 'data', config.tramitesFile);
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  return normalizeTramites(raw);
}
