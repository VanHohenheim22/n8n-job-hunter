#!/usr/bin/env node
// Migración única: recalcula `description` (límite 20000) desde raw.description (HTML)
// y deja `raw` sin description/logos. Lee JSON lines {id, raw} por stdin, escribe un JSON array por stdout.
'use strict';
const fs = require('fs');
const path = require('path');
// Reutiliza stripHtml/decodeEntities/clean del normalizador (son idénticos en todos los archivos).
const src = fs.readFileSync(path.join(__dirname, '../normalizers/common.js'), 'utf8');
const { stripHtml } = new Function('module', src + '\nreturn module.exports;')({});
const DROP = ['description', 'company_logo', 'company_logo_url', 'logo', 'image'];
const out = [];
for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const { id, raw } = JSON.parse(line);
  out.push({
    id,
    description: stripHtml(raw.description),
    raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !DROP.includes(k))),
  });
}
process.stdout.write(JSON.stringify(out));
