// tg-poller: lee el bot de Telegram con long polling y reenvía las actualizaciones a n8n por la red interna.
// Evita exponer n8n a internet (los webhooks de Telegram exigen una URL pública con HTTPS).
// Sin dependencias (Node ≥ 18). Solo reenvía mensajes del chat autorizado.
'use strict';

const { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, FORWARD_URL, WEBHOOK_SECRET } = process.env;
for (const [k, v] of Object.entries({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, FORWARD_URL, WEBHOOK_SECRET })) {
  if (!v) { console.error(`Falta la variable ${k}`); process.exit(1); }
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a); // nunca imprimir el token

const chatOf = (u) => String(u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? '');

async function forward(update) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(120_000),
      });
      if (r.ok) return;
      log(`n8n respondió ${r.status} (intento ${attempt})`);
    } catch (e) {
      log(`n8n no disponible: ${e.message} (intento ${attempt})`);
    }
    await sleep(Math.min(60_000, 2_000 * attempt)); // no se pierde: el offset no avanza hasta reenviar
  }
}

async function main() {
  let offset; // Telegram guarda las actualizaciones no confirmadas 24 h: no hace falta persistir el offset
  log('tg-poller iniciado');
  for (;;) {
    try {
      const qs = new URLSearchParams({ timeout: '50', allowed_updates: JSON.stringify(['message', 'callback_query']) });
      if (offset) qs.set('offset', String(offset));
      const r = await fetch(`${API}/getUpdates?${qs}`, { signal: AbortSignal.timeout(65_000) });
      const data = await r.json();
      if (!data.ok) { log(`Telegram: ${data.error_code} ${data.description}`); await sleep(10_000); continue; }
      for (const u of data.result) {
        if (chatOf(u) === String(CHAT)) {
          await forward(u);
          log(`reenviado update ${u.update_id} (${u.callback_query ? 'botón' : 'mensaje'})`);
        } else {
          log(`ignorado update ${u.update_id}: chat no autorizado`);
        }
        offset = u.update_id + 1;
      }
    } catch (e) {
      log(`error: ${e.message}`);
      await sleep(5_000);
    }
  }
}

main();
