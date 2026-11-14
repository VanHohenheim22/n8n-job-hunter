'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, findEmail, detectChannel, detectLang, buildPrompt, parseHook, compose } = require('./compose.js');

const forum = { source: 'n8nforum', title: '[HIRING] n8n builder', url: 'https://community.n8n.io/t/x/1',
  description: 'We need someone for lead follow-up. DM if interested.', raw: { creator: 'aidan_x' } };

test('findEmail ignora correos basura', () => {
  assert.strictEqual(findEmail('write to jobs@acme.com or noreply@acme.com'), 'jobs@acme.com');
  assert.strictEqual(findEmail('logo@2x.png only'), null);
  assert.strictEqual(findEmail(null), null);
});

test('detectChannel: email, foro y web', () => {
  assert.deepStrictEqual(detectChannel({ ...forum, description: 'How to apply: email aidan@useautomatch.com' }),
    { channel: 'email', recipient: 'aidan@useautomatch.com' });
  assert.deepStrictEqual(detectChannel(forum), { channel: 'forum_dm', recipient: 'https://community.n8n.io/u/aidan_x' });
  assert.deepStrictEqual(detectChannel({ source: 'getonbrd', url: 'https://g/x', description: 'Requisitos' }),
    { channel: 'web', recipient: 'https://g/x' });
});

test('detectLang usa la columna lang o adivina', () => {
  assert.strictEqual(detectLang({ lang: 'es' }), 'es');
  assert.strictEqual(detectLang({ description: 'Requisitos: experiencia con n8n' }), 'es');
  assert.strictEqual(detectLang({ description: 'We need n8n' }), 'en');
});

test('buildPrompt marca la oferta como no confiable y recorta', () => {
  const m = buildPrompt({ title: 't', description: 'x'.repeat(5000) }, 'es');
  assert.strictEqual(m.length, 2);
  assert.match(m[0].content, /untrusted data/);
  assert.match(m[0].content, /Spanish/);
  assert.ok(m[1].content.length < 2700);
});

test('parseHook: JSON, texto, limpieza y límite', () => {
  assert.strictEqual(parseHook('{"hook":"You need lead follow-up."}'), 'You need lead follow-up.');
  assert.strictEqual(parseHook('```json\n{"hook":"Hi there"}\n```'), 'Hi there');
  assert.strictEqual(parseHook('Visit https://evil.com and mail a@b.co now'), 'Visit and mail now');
  assert.ok(parseHook('palabra '.repeat(100)).length <= 321);
});

test('compose: email con asunto y CV; foro sin asunto', () => {
  const e = compose({ title: 'Builder', company: 'ACME' }, { channel: 'email', recipient: 'a@b.co' }, 'en', 'HOOK.');
  assert.match(e.subject, /Builder/);
  assert.match(e.body, /^Hi ACME team,\n\nHOOK\./);
  assert.match(e.body, /CV attached/);
  const d = compose(forum, { channel: 'forum_dm', recipient: 'u' }, 'en', '');
  assert.strictEqual(d.subject, null);
  assert.match(d.body, /^Hi, I saw your post/);
  assert.doesNotMatch(d.body, /CV attached/);
  const w = compose({ title: 'Dev', company: 'X' }, { channel: 'web', recipient: 'u' }, 'es', 'Gancho.');
  assert.match(w.body, /^Hola, equipo de X:\n\nGancho\./);
});

test('cleanTitle quita etiquetas y sufijos', () => {
  assert.strictEqual(cleanTitle('[HIRING] Founding n8n Builders for US Clients | Freelance, Remote'), 'Founding n8n Builders for US Clients');
  assert.strictEqual(cleanTitle('n8n Developer (Remote, LATAM)'), 'n8n Developer');
  assert.strictEqual(cleanTitle('[HIRING]'), '[HIRING]');
});
