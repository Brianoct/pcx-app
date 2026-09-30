// Copia DEFAULT_HOME (backend/lib/site.js) a frontend/src/siteDefaults.js para
// que el inicio público tenga el mismo contenido inicial sin esperar la API.
//   cd backend && node scripts/exportSiteDefaults.js
const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === '../db') return { pool: {} };
  return originalLoad.call(this, request, ...rest);
};
const { DEFAULT_HOME } = require('../lib/site');

const target = path.join(__dirname, '..', '..', 'frontend', 'src', 'siteDefaults.js');
fs.writeFileSync(target, [
  '// Generado desde backend/lib/site.js (DEFAULT_HOME): contenido inicial del',
  '// inicio público, usado mientras carga /api/site/home o si la API falla.',
  '// Para cambiar el contenido inicial, editar el backend y volver a generar:',
  '//   cd backend && node scripts/exportSiteDefaults.js',
  `export const DEFAULT_HOME = ${JSON.stringify(DEFAULT_HOME, null, 2)};`,
  ''
].join('\n'));
console.log(`Escrito ${target}`);
