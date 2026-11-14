#!/usr/bin/env node
// Genera n8n/workflows/wf3-telegram-acciones.json: acciones desde Telegram (botones y comandos).
//   tg-poller → Webhook (cabecera secreta) → Parse update (solo el chat autorizado)
//     ├─ draft/regen → cargar oferta → prompt → Gemini (OpenAI-compatible) → plantilla → guardar → borrador con botones
//     └─ skip/approve/sent/nogo/discard/edit/help → una consulta SQL → respuesta
// Lee TELEGRAM_CHAT_ID y GEMINI_MODEL de infra/.env. Lógica de plantillas: scripts/applications/compose.js (con pruebas).
'use strict';
const { read, COLOR, sticky, doc, connector, writeWorkflow } = require('./lib/wf');

const env = Object.fromEntries(read('infra/.env').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=([^#\s]*)/)).filter(Boolean).map((m) => [m[1], m[2]]));
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const MODEL = env.GEMINI_MODEL || 'gemini-3.5-flash';
const LLM_URL = env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
if (!CHAT_ID) throw new Error('Falta TELEGRAM_CHAT_ID en infra/.env');

const PG = { postgres: { id: 'jhPgJobs00000001', name: 'Postgres jobs' } };
const TG = { telegramApi: { id: '0oBvnvYgYSOOhmhG', name: 'Telegram Empliosbot' } };
const HOOK_AUTH = { httpHeaderAuth: { id: 'jhTgPollerSecret', name: 'tg-poller secret' } };
const LLM_AUTH = { httpHeaderAuth: { id: 'jhGeminiApiKey01', name: 'Gemini API' } };

const compose = read('scripts/applications/compose.js')
  .replace(/^if \(typeof module !== 'undefined'\)\s*(\{[\s\S]*?\n\}|[^\n]*)\s*$/m, '');
if (/module\.exports/.test(compose)) throw new Error('No se pudo quitar module.exports de compose.js');

const N = {
  hook: 'Telegram update', parse: 'Parse update', answer: 'Answer button', route: 'Route action',
  load: 'Load offer', prompt: 'Build prompt', llm: 'Ask LLM for hook', compose: 'Compose draft',
  save: 'Save draft', fmt: 'Format draft message', sendDraft: 'Send draft', remember: 'Remember message id',
  act: 'Apply action', reply: 'Format reply', isAppr: 'Approved?', sendAppr: 'Send approved text', sendReply: 'Send reply',
};

// ---------- Código de los nodos ----------
const parseCode = `// Solo el chat autorizado (el tg-poller ya filtra; esto es una segunda barrera).
const CHAT_ID = '${CHAT_ID}';
const u = $input.first().json.body ?? $input.first().json;
const cb = u.callback_query, msg = u.message;
const chat = String(cb?.message?.chat?.id ?? msg?.chat?.id ?? '');
if (chat !== CHAT_ID) return [];
const out = { action: 'help', offer_id: '', app_id: '', text: '', reply_to: '', callback_id: cb?.id ?? '' };
if (cb) {
  const [action, id] = String(cb.data || '').split(':');
  out.action = action;
  if (['draft', 'skip'].includes(action)) out.offer_id = id; else out.app_id = id;
} else if (msg?.reply_to_message && msg.text && !msg.text.startsWith('/')) {
  Object.assign(out, { action: 'edit', text: msg.text, reply_to: String(msg.reply_to_message.message_id) });
} else {
  const m = String(msg?.text || '').match(/^\\/(?:aplicar|apply)\\s+#?(\\d+)/i);
  if (m) Object.assign(out, { action: 'draft', offer_id: m[1] });
}
if (!['draft', 'regen', 'skip', 'approve', 'sent', 'nogo', 'discard', 'edit', 'help'].includes(out.action)) out.action = 'help';
return [{ json: out }];
`;

const promptCode = `// GENERATED from scripts/applications/compose.js (unit-tested) — do not edit here.
${compose}
const o = $input.first().json;
const ch = detectChannel(o);
const lang = detectLang(o);
return [{ json: { offer: o, ch, lang, body: { model: '${MODEL}', temperature: 0.4, reasoning_effort: 'none',
  response_format: { type: 'json_object' }, messages: buildPrompt(o, lang) } } }];
`;

const composeCode = `// GENERATED from scripts/applications/compose.js (unit-tested) — do not edit here.
${compose}
const p = $('${N.prompt}').first().json;
const r = $input.first().json;
const hook = parseHook(r?.choices?.[0]?.message?.content ?? ''); // si la IA falla: borrador sin hook
const d = compose(p.offer, p.ch, p.lang, hook);
return [{ json: { ...d, hook, model: r?.model || (hook ? '${MODEL}' : 'none'), offer_id: String(p.offer.id),
  regen_id: String(p.offer.regen_id || ''), title: p.offer.title, company: p.offer.company || '' } }];
`;

const fmtCode = `const d = $('${N.compose}').first().json;
const id = $input.first().json.id;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const where = { email: '✉️ Email a ' + esc(d.recipient), forum_dm: '💬 DM en el foro: ' + esc(d.recipient), web: '🌐 Aplicar en: ' + esc(d.recipient) }[d.channel];
const text = [
  \`✍️ <b>Borrador #\${id}</b> · oferta #\${d.offer_id} · \${d.lang === 'es' ? '🇪🇸' : '🇬🇧'}\`,
  \`<b>\${esc(d.title)}</b>\${d.company ? ' — ' + esc(d.company) : ''}\`,
  where,
  d.subject ? '📌 Asunto: ' + esc(d.subject) : '',
  '', '<pre>' + esc(d.body) + '</pre>', '',
  d.hook ? '' : '⚠️ <i>La IA no respondió: borrador sin frase personalizada.</i>',
  '<i>Para editar: responde a este mensaje con el texto corregido.</i>',
].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\\n');
return [{ json: { app_id: String(id), text: text.slice(0, 4000) } }];
`;

const replyCode = `const r = $input.first().json;
const a = $('${N.parse}').first().json.action;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let text;
if (a === 'help') {
  text = ['🤖 <b>Job Hunter</b>', '',
    '• En cada oferta: <b>✍️ Preparar aplicación</b> o <b>🗑 No me interesa</b>.',
    '• En cada borrador: <b>✅ Aprobar</b>, <b>🔁 Otra versión</b> o <b>🗑 Descartar</b>.',
    '• Al aprobar: <b>📤 Ya lo envié</b> (queda registrada) o <b>🚫 No se pudo</b> (canal cerrado).',
    '• Para editar un borrador, respóndele con el texto corregido.',
    '• Para preparar cualquier oferta: <code>/aplicar 123</code> (el número es el #id).'].join('\\n');
} else if (a === 'skip') {
  text = r.title ? '🗑 Descartada: ' + esc(r.title) : '⚠️ No encontré esa oferta.';
} else if (a === 'discard') {
  text = r.app_id ? '🗑 Borrador #' + r.app_id + ' descartado.' : '⚠️ Ese borrador ya no está activo.';
} else if (a === 'edit') {
  text = r.app_id ? '✏️ Borrador #' + r.app_id + ' actualizado con tu texto. Pulsa ✅ en el borrador para aprobarlo.'
    : '⚠️ Responde directamente al mensaje de un borrador activo para editarlo.';
} else if (a === 'sent') {
  text = r.app_id ? '📤 Aplicación #' + r.app_id + ' registrada como enviada. ¡Suerte!' : '⚠️ Esa aplicación no estaba aprobada.';
} else if (a === 'nogo') {
  text = r.app_id ? '🚫 Aplicación #' + r.app_id + ' cerrada: no se pudo enviar. La oferta queda descartada.' : '⚠️ Esa aplicación no estaba aprobada.';
} else if (a === 'approve') {
  if (!r.app_id) text = '⚠️ Ese borrador ya no está activo.';
  else {
    const how = { email: '✉️ Envíalo a <b>' + esc(r.recipient) + '</b>' + (r.subject ? ' con el asunto:\\n<code>' + esc(r.subject) + '</code>' : '') +
        '\\n📎 Adjunta <code>profile/out/cv-' + r.lang + '.pdf</code>',
      forum_dm: '💬 Abre el perfil y pulsa <b>Message</b>: ' + esc(r.recipient),
      web: '🌐 Aplica aquí: ' + esc(r.recipient) }[r.channel];
    text = ['✅ <b>Aprobado #' + r.app_id + '</b>', how, '',
      'Texto listo para copiar (tócalo):', '<pre>' + esc(r.body) + '</pre>', '',
      '<i>Cuando lo envíes, pulsa 📤.</i>'].join('\\n');
  }
}
return [{ json: { text: String(text).slice(0, 4000), approved: a === 'approve' && !!r.app_id, app_id: String(r.app_id ?? '') } }];
`;

// ---------- SQL ----------
const loadSql = `SELECT o.id, o.title, o.company, o.url, o.source, o.lang, o.description, o.raw,
       NULLIF($2, '') AS regen_id
FROM offers o
WHERE o.id = COALESCE(NULLIF($1, '')::bigint, (SELECT offer_id FROM applications WHERE id = NULLIF($2, '')::bigint));`;

const saveSql = `WITH old AS (
  UPDATE applications SET status = 'discarded', updated_at = now()
  WHERE id = NULLIF($1, '')::bigint AND status = 'draft' RETURNING id
)
INSERT INTO applications (offer_id, channel, recipient, lang, subject, body, hook, model)
VALUES ($2::bigint, $3, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''), $9)
RETURNING id;`;

const rememberSql = 'UPDATE applications SET tg_message_id = $1::bigint WHERE id = $2::bigint RETURNING id;';

// Una sola consulta para todas las acciones simples (CTEs que modifican datos: solo actúa la que coincide).
const actSql = `WITH p AS (SELECT $1::text AS a, NULLIF($2, '')::bigint AS oid, NULLIF($3, '')::bigint AS aid,
                         $4::text AS txt, NULLIF($5, '')::bigint AS rto),
skip AS (UPDATE offers o SET status = 'discarded' FROM p WHERE p.a = 'skip' AND o.id = p.oid RETURNING o.title),
appr AS (UPDATE applications ap SET status = 'approved', approved_at = now(), updated_at = now()
         FROM p WHERE p.a = 'approve' AND ap.id = p.aid AND ap.status = 'draft' RETURNING ap.*),
appr_o AS (UPDATE offers o SET status = 'applied' FROM appr WHERE o.id = appr.offer_id RETURNING o.id),
sent AS (UPDATE applications ap SET status = 'sent', sent_at = now(), updated_at = now()
         FROM p WHERE p.a = 'sent' AND ap.id = p.aid AND ap.status = 'approved' RETURNING ap.id),
nogo AS (UPDATE applications ap SET status = 'discarded', updated_at = now()
         FROM p WHERE p.a = 'nogo' AND ap.id = p.aid AND ap.status = 'approved' RETURNING ap.id, ap.offer_id),
nogo_o AS (UPDATE offers o SET status = 'discarded' FROM nogo WHERE o.id = nogo.offer_id RETURNING o.id),
disc AS (UPDATE applications ap SET status = 'discarded', updated_at = now()
         FROM p WHERE p.a = 'discard' AND ap.id = p.aid AND ap.status = 'draft' RETURNING ap.id),
edit AS (UPDATE applications ap SET body = p.txt, updated_at = now()
         FROM p WHERE p.a = 'edit' AND ap.tg_message_id = p.rto AND ap.status = 'draft' RETURNING ap.id)
SELECT p.a AS action,
       (SELECT title FROM skip) AS title,
       COALESCE((SELECT id FROM appr), (SELECT id FROM disc), (SELECT id FROM edit), (SELECT id FROM sent), (SELECT id FROM nogo)) AS app_id,
       (SELECT channel FROM appr) AS channel, (SELECT recipient FROM appr) AS recipient,
       (SELECT subject FROM appr) AS subject, (SELECT body FROM appr) AS body, (SELECT lang FROM appr) AS lang,
       (SELECT count(*) FROM appr_o) + (SELECT count(*) FROM nogo_o) AS offers_changed
FROM p;`;

const pgParams = (exprs) => ({ queryReplacement: `={{ [ ${exprs.join(', ')} ] }}` });
const P = `$('${N.parse}').first().json`;

// ---------- Nodos ----------
const Y = 420, Y2 = 760;
const nodes = [
  sticky('header', [
    '## WF3 · Telegram actions (apply with approval)',
    'Buttons and commands from the Telegram bot arrive through **tg-poller** (long polling, no public URL) with a secret header.',
    '**✍️ Draft:** template from the CV + 1–2 personalized sentences by an LLM (OpenAI-compatible endpoint) → you approve.',
    'The LLM never invents experience: it only writes the hook, the rest is fixed text. Offer text is treated as untrusted.',
    '',
    '⚙️ Generated by `scripts/build_wf3.js` · templates in `scripts/applications/compose.js` (tested) — **do not edit here**.',
  ].join('\n'), [-60, 0], [2380, 240], COLOR.header),
  sticky('in', '### Receive\nOnly the authorized chat.\nButtons are answered at once.', [-60, 280], [740, 620], COLOR.trigger),
  sticky('draft', '### ✍️ Draft (draft / regen)\nLLM writes only the hook.\nIf the LLM fails → draft without hook.', [700, 280], [1660, 300], COLOR.transform),
  sticky('simple', '### Simple actions (one SQL)\nskip · approve · sent · nogo · discard · edit · help', [700, 620], [1280, 300], COLOR.output),

  doc({ id: 'webhook', name: N.hook, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, Y + 160],
    webhookId: 'b7e3c1a2-5d4f-4e8a-9c1b-2f3e4d5a6b7c', credentials: HOOK_AUTH,
    parameters: { httpMethod: 'POST', path: 'tg-actions', authentication: 'headerAuth', responseMode: 'onReceived', options: {} } },
    'POST from tg-poller · X-Webhook-Secret'),
  doc({ id: 'parse', name: N.parse, type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, Y + 160],
    parameters: { mode: 'runOnceForAllItems', jsCode: parseCode } }, 'Button / command / reply → action'),
  doc({ id: 'answer', name: N.answer, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [480, Y + 360],
    credentials: TG, onError: 'continueRegularOutput',
    parameters: { resource: 'callback', operation: 'answerQuery', queryId: '={{ $json.callback_id }}',
      additionalFields: { text: '⏳' } } }, 'Stops the button spinner'),
  doc({ id: 'route', name: N.route, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [480, Y + 80],
    parameters: { rules: { values: [
      rule('needs LLM', "={{ ['draft','regen'].includes($json.action) }}"),
      rule('simple', "={{ ['skip','approve','sent','nogo','discard','edit','help'].includes($json.action) }}"),
      rule('button', "={{ !!$json.callback_id }}"),
    ] }, options: { allMatchingOutputs: true } } }, 'LLM path / SQL path'),

  doc({ id: 'load', name: N.load, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [760, Y], credentials: PG,
    parameters: { operation: 'executeQuery', query: loadSql, options: pgParams(['$json.offer_id', '$json.app_id']) } }, 'Offer by id (or by draft)'),
  doc({ id: 'prompt', name: N.prompt, type: 'n8n-nodes-base.code', typeVersion: 2, position: [1000, Y],
    parameters: { mode: 'runOnceForAllItems', jsCode: promptCode } }, 'Channel, language, prompt'),
  doc({ id: 'llm', name: N.llm, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1240, Y],
    credentials: LLM_AUTH, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2,
    parameters: { method: 'POST', url: LLM_URL, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 60000 } } },
    `${MODEL} · OpenAI-compatible`),
  doc({ id: 'compose', name: N.compose, type: 'n8n-nodes-base.code', typeVersion: 2, position: [1480, Y],
    parameters: { mode: 'runOnceForAllItems', jsCode: composeCode } }, 'Template + hook'),
  doc({ id: 'save', name: N.save, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1720, Y], credentials: PG,
    parameters: { operation: 'executeQuery', query: saveSql, options: pgParams(['$json.regen_id', '$json.offer_id',
      '$json.channel', '$json.recipient', '$json.lang', "$json.subject || ''", '$json.body', '$json.hook', '$json.model']) } },
    'New draft (regen discards old)'),
  doc({ id: 'fmt', name: N.fmt, type: 'n8n-nodes-base.code', typeVersion: 2, position: [1960, Y],
    parameters: { mode: 'runOnceForAllItems', jsCode: fmtCode } }, 'HTML-escaped'),
  doc({ id: 'send-draft', name: N.sendDraft, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [2200, Y], credentials: TG,
    parameters: { chatId: CHAT_ID, text: '={{ $json.text }}', replyMarkup: 'inlineKeyboard',
      inlineKeyboard: { rows: [{ row: { buttons: [
        { text: '✅ Aprobar', additionalFields: { callback_data: '=approve:{{ $json.app_id }}' } },
        { text: '🔁 Otra versión', additionalFields: { callback_data: '=regen:{{ $json.app_id }}' } },
        { text: '🗑 Descartar', additionalFields: { callback_data: '=discard:{{ $json.app_id }}' } },
      ] } }] },
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false } } }, 'With buttons'),
  doc({ id: 'remember', name: N.remember, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2440, Y], credentials: PG,
    parameters: { operation: 'executeQuery', query: rememberSql,
      options: pgParams(['$json.result?.message_id ?? $json.message_id', `$('${N.fmt}').first().json.app_id`]) } },
    'Lets you edit by replying'),

  doc({ id: 'act', name: N.act, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [760, Y2], credentials: PG,
    parameters: { operation: 'executeQuery', query: actSql,
      options: pgParams(['$json.action', '$json.offer_id', '$json.app_id', '$json.text', '$json.reply_to']) } },
    'One query for all simple actions'),
  doc({ id: 'reply', name: N.reply, type: 'n8n-nodes-base.code', typeVersion: 2, position: [1000, Y2],
    parameters: { mode: 'runOnceForAllItems', jsCode: replyCode } }, 'Approve → copy-ready text'),
  doc({ id: 'is-appr', name: N.isAppr, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1240, Y2],
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{ leftValue: '={{ $json.approved }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' }, options: {} } }, 'Approve → buttons 📤 / 🚫'),
  doc({ id: 'send-appr', name: N.sendAppr, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1480, Y2 - 80], credentials: TG,
    parameters: { chatId: CHAT_ID, text: '={{ $json.text }}', replyMarkup: 'inlineKeyboard',
      inlineKeyboard: { rows: [{ row: { buttons: [
        { text: '📤 Ya lo envié', additionalFields: { callback_data: '=sent:{{ $json.app_id }}' } },
        { text: '🚫 No se pudo', additionalFields: { callback_data: '=nogo:{{ $json.app_id }}' } },
      ] } }] },
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false } } }, 'Copy-ready text + buttons'),
  doc({ id: 'send-reply', name: N.sendReply, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1480, Y2 + 80], credentials: TG,
    parameters: { chatId: CHAT_ID, text: '={{ $json.text }}',
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false } } }, 'HTML'),
];

function rule(name, expr) {
  return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
    conditions: [{ leftValue: expr, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and' }, renameOutput: true, outputKey: name };
}

const { connections, link } = connector();
link(N.hook, N.parse);
link(N.parse, N.route);
connections[N.route] = { main: [
  [{ node: N.load, type: 'main', index: 0 }],
  [{ node: N.act, type: 'main', index: 0 }],
  [{ node: N.answer, type: 'main', index: 0 }],
] };
[[N.load, N.prompt], [N.prompt, N.llm], [N.llm, N.compose], [N.compose, N.save], [N.save, N.fmt],
  [N.fmt, N.sendDraft], [N.sendDraft, N.remember], [N.act, N.reply], [N.reply, N.isAppr]].forEach(([a, b]) => link(a, b));
connections[N.isAppr] = { main: [[{ node: N.sendAppr, type: 'main', index: 0 }], [{ node: N.sendReply, type: 'main', index: 0 }]] };

writeWorkflow('n8n/workflows/wf3-telegram-acciones.json', { id: 'nMieRoY568VMJJLC', name: 'WF3 · Telegram actions (apply with approval)',
  nodes, connections, settings: { executionOrder: 'v1', timezone: 'America/Bogota' }, pinData: {}, active: false });
