#!/usr/bin/env node
// Genera n8n/workflows/wf2-filtro-avisos.json:
//   cada hora → clasificar por reglas (n8n/sql/classify_offers.sql) → candidatas sin avisar
//   → mensajes de Telegram (uno por oferta, o resumen si hay muchas) → marcar notified_at.
// Lee TELEGRAM_CHAT_ID de infra/.env. Uso: node scripts/build_wf2.js && scripts/n8n.sh push n8n/workflows/wf2-filtro-avisos.json
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const env = Object.fromEntries(read('infra/.env').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=([^#\s]*)/)).filter(Boolean).map((m) => [m[1], m[2]]));
const CHAT_ID = env.TELEGRAM_CHAT_ID;
if (!CHAT_ID) throw new Error('Falta TELEGRAM_CHAT_ID en infra/.env');

const PG = { postgres: { id: 'jhPgJobs00000001', name: 'Postgres jobs' } };
const TG = { telegramApi: { id: '0oBvnvYgYSOOhmhG', name: 'Telegram Empliosbot' } };
const MAX_INDIVIDUAL = 8; // más candidatas que esto → un solo mensaje resumen
const DIGEST_TOP = 12;

const pendingSql = `SELECT id, title, company, location, salary_min, salary_max, url, source, score, reasons, lang, job_type,
       published_at
FROM offers WHERE status = 'candidate' AND notified_at IS NULL
ORDER BY score DESC, published_at DESC NULLS LAST LIMIT 300;`;

const markSql = `UPDATE offers SET notified_at = now()
WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::bigint)
RETURNING id;`;

// Código del nodo de formato (se ejecuta en n8n). Escapa HTML: títulos y empresas son contenido externo.
const formatCode = `// GENERADO por scripts/build_wf2.js — no editar aquí.
const MAX_INDIVIDUAL = ${MAX_INDIVIDUAL}, DIGEST_TOP = ${DIGEST_TOP};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => /^https?:\\/\\//i.test(String(u || '')) ? esc(u) : '';
const money = (o) => o.salary_min ? \`💰 $\${Math.round(o.salary_min / 1000)}k\${o.salary_max && o.salary_max !== o.salary_min ? '–' + Math.round(o.salary_max / 1000) + 'k' : ''} USD/año\` : '';
const flag = (o) => (o.reasons || []).includes('pide inglés') || o.lang === 'en' ? '🇬🇧' : '🇪🇸';
const link = (o, label) => safeUrl(o.url) ? \`<a href="\${safeUrl(o.url)}">\${esc(label)}</a>\` : esc(label);

const offers = $input.all().map((i) => i.json).filter((o) => o && o.id);
if (offers.length === 0) return [];

if (offers.length <= MAX_INDIVIDUAL) {
  return offers.map((o) => ({ json: { ids: [o.id], text: [
    \`⭐ <b>\${o.score}</b> \${flag(o)} \${link(o, o.title)}\`,
    [o.company && \`🏢 \${esc(o.company)}\`, o.location && \`📍 \${esc(o.location)}\`].filter(Boolean).join(' · '),
    [money(o), o.job_type && \`⏱ \${esc(o.job_type)}\`].filter(Boolean).join(' · '),
    \`🏷 \${esc((o.reasons || []).join(', '))}\`,
    \`<i>\${esc(o.source)}</i>\`,
  ].filter(Boolean).join('\\n') } }));
}

const top = offers.slice(0, DIGEST_TOP).map((o, n) =>
  \`\${n + 1}. ⭐\${o.score} \${flag(o)} \${link(o, o.title)}\${o.company ? ' — ' + esc(o.company) : ''}\${money(o) ? ' · ' + money(o) : ''}\`);
const rest = offers.length - DIGEST_TOP;
return [{ json: { ids: offers.map((o) => o.id), text: [
  \`📋 <b>\${offers.length} ofertas nuevas</b> que encajan contigo. Las mejores:\`, '', ...top,
  rest > 0 ? \`\\n…y \${rest} más (status = 'candidate' en la base jobs).\` : '',
].join('\\n') } }];
`;

const nodes = [
  { id: 'trigger-cron', name: 'Cada hora', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 200],
    parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 20 }] } } },
  { id: 'trigger-manual', name: 'Ejecutar a mano', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 400], parameters: {} },
  { id: 'pg-classify', name: 'Clasificar por reglas', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [240, 300],
    credentials: PG, parameters: { operation: 'executeQuery', query: read('n8n/sql/classify_offers.sql'), options: {} } },
  { id: 'pg-pending', name: 'Candidatas sin avisar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [480, 300],
    credentials: PG, executeOnce: true, parameters: { operation: 'executeQuery', query: pendingSql, options: {} } },
  { id: 'code-format', name: 'Formatear avisos', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 300],
    parameters: { mode: 'runOnceForAllItems', jsCode: formatCode } },
  { id: 'tg-send', name: 'Enviar a Telegram', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [960, 300],
    credentials: TG,
    parameters: { chatId: CHAT_ID, text: '={{ $json.text }}',
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false } } },
  { id: 'pg-mark', name: 'Marcar avisadas', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1200, 300],
    credentials: PG, executeOnce: true,
    parameters: { operation: 'executeQuery', query: markSql,
      options: { queryReplacement: "={{ [ JSON.stringify($('Formatear avisos').all().flatMap((i) => i.json.ids)) ] }}" } } },
];

const connections = {};
const link = (a, b) => { (connections[a] ??= { main: [[]] }).main[0].push({ node: b, type: 'main', index: 0 }); };
link('Cada hora', 'Clasificar por reglas');
link('Ejecutar a mano', 'Clasificar por reglas');
link('Clasificar por reglas', 'Candidatas sin avisar');
link('Candidatas sin avisar', 'Formatear avisos');
link('Formatear avisos', 'Enviar a Telegram');
link('Enviar a Telegram', 'Marcar avisadas');

const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const workflow = { id: 'taJY42QX0FhEhUse', name: 'WF2 - Filtro y avisos por Telegram', nodes, connections,
  settings: { executionOrder: 'v1', timezone: 'America/Bogota' }, pinData: {}, active: false };
const out = path.join(ROOT, 'n8n/workflows/wf2-filtro-avisos.json');
fs.writeFileSync(out, JSON.stringify(sortKeys(workflow), null, 2) + '\n');
console.log(`OK → ${path.relative(ROOT, out)} (${nodes.length} nodos)`);
