#!/usr/bin/env node
// Genera n8n/workflows/wf1-recoleccion.json a partir de:
//   scripts/normalizers/<fuente>.js  (código probado con node --test)
//   n8n/sql/upsert_offers.sql
// Uso: node scripts/build_wf1.js  →  luego importar (ver docs/INFRA.md)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) job-hunter/0.1';
const PG_CRED = { postgres: { id: 'jhPgJobs00000001', name: 'Postgres jobs' } };

// Fuentes. Remotive pide ≤4 consultas/día → el cron va cada 6 h.
const SOURCES = [
  { key: 'remoteok', label: 'RemoteOK', fn: 'normalizeRemoteok', url: 'https://remoteok.com/api' },
  { key: 'remotive', label: 'Remotive', fn: 'normalizeRemotive', url: 'https://remotive.com/api/remote-jobs?category=software-dev' },
  { key: 'wwr', label: 'We Work Remotely', fn: 'normalizeWwr', url: 'https://weworkremotely.com/remote-jobs.rss' },
  { key: 'n8nforum', label: 'Foro n8n Jobs', fn: 'normalizeN8nforum', url: 'https://community.n8n.io/c/jobs/13.rss' },
  {
    // Varias URLs (categorías × páginas): un nodo previo emite un item por URL. Páginas de más devuelven [].
    key: 'getonbrd', label: 'GetOnBrd', fn: 'normalizeGetonbrd',
    urls: [['programming', 4], ['machine-learning-ai', 2], ['sysadmin-devops-qa', 3]].flatMap(([cat, pages]) =>
      Array.from({ length: pages }, (_, i) =>
        `https://www.getonbrd.com/api/v0/categories/${cat}/jobs?per_page=100&page=${i + 1}` +
        `&expand=${encodeURIComponent('["company","tags","seniority","modality","location_tenants","location_regions"]')}`)),
  },
];

const sql = read('n8n/sql/upsert_offers.sql');

const nodes = [];
const connections = {};
const link = (from, to) => {
  (connections[from] ??= { main: [[]] }).main[0].push({ node: to, type: 'main', index: 0 });
};

nodes.push({
  id: 'trigger-cron', name: 'Cada 6 horas', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
  position: [0, 200],
  parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } },
});
nodes.push({
  id: 'trigger-manual', name: 'Ejecutar a mano', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1,
  position: [0, 400], parameters: {},
});

SOURCES.forEach((s, i) => {
  const y = i * 220 + 100;
  const multi = Array.isArray(s.urls);
  const urlsNode = `URLs ${s.label}`;
  const http = `Descargar ${s.label}`;
  const code = `Normalizar ${s.label}`;
  const save = `Guardar ${s.label}`;
  const normalizer = read(`scripts/normalizers/${s.key}.js`)
    // Quita el export (una línea o bloque {…}): en n8n no existe module.
    .replace(/^if \(typeof module !== 'undefined'\)\s*(\{[\s\S]*?\n\}|[^\n]*)\s*$/m, '');
  if (/module\.exports/.test(normalizer)) throw new Error(`No se pudo quitar module.exports de ${s.key}.js`);

  if (multi) {
    nodes.push({
      id: `urls-${s.key}`, name: urlsNode, type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [260, y],
      parameters: { mode: 'runOnceForAllItems', jsCode: `return ${JSON.stringify(s.urls)}.map((url) => ({ json: { url } }));\n` },
    });
  }
  nodes.push({
    id: `http-${s.key}`, name: http, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [multi ? 400 : 260, y], onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2,
    parameters: {
      url: multi ? '={{ $json.url }}' : s.url,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: UA }] },
      options: {
        timeout: 30000,
        ...(multi && { batching: { batch: { batchSize: 1, batchInterval: 1500 } } }), // amable con la API
        response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
  });
  nodes.push({
    id: `code-${s.key}`, name: code, type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [520, y],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `// GENERADO por scripts/build_wf1.js desde scripts/normalizers/${s.key}.js — no editar aquí.\n` +
        `${normalizer}\n` +
        `// Une todas las respuestas (una por URL) y deduplica por source_id (el upsert no admite repetidos).\n` +
        `const seen = new Set();\n` +
        `const offers = $input.all().flatMap((it) => {\n` +
        `  const body = it.json?.data ?? '';\n` +
        `  return ${s.fn}(typeof body === 'string' ? body : JSON.stringify(body));\n` +
        `}).filter((o) => !seen.has(o.source_id) && seen.add(o.source_id));\n` +
        `return [{ json: { source: '${s.key}', count: offers.length, payload: JSON.stringify(offers) } }];\n`,
    },
  });
  nodes.push({
    id: `pg-${s.key}`, name: save, type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
    position: [780, y], credentials: PG_CRED,
    parameters: {
      operation: 'executeQuery',
      query: sql,
      options: { queryReplacement: '={{ [ $json.payload ] }}' },
    },
  });

  const first = multi ? urlsNode : http;
  link('Cada 6 horas', first);
  link('Ejecutar a mano', first);
  if (multi) link(urlsNode, http);
  link(http, code);
  link(code, save);
});

const workflow = {
  id: 'jhWf1Recoleccion',
  name: 'WF1 - Recolección de ofertas',
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Bogota' },
  pinData: {},
  active: false,
};

const out = path.join(ROOT, 'n8n/workflows/wf1-recoleccion.json');
// Claves ordenadas (igual que `jq -S` en scripts/n8n.sh pull) para diffs estables en git.
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
fs.writeFileSync(out, JSON.stringify(sortKeys(workflow), null, 2) + '\n');
console.log(`OK → ${path.relative(ROOT, out)} (${nodes.length} nodos)`);
