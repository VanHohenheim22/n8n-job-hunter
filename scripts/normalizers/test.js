const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeRemoteok } = require('./remoteok');
const { normalizeRemotive } = require('./remotive');
const { normalizeWwr } = require('./wwr');
const { parseSalary, decodeEntities, stripHtml, toIso, clean } = require('./common');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

test('Unit tests: parseSalary', () => {
  // "$35,3k- $52k" → 35300, 52000
  let res = parseSalary('$35,3k- $52k');
  assert.strictEqual(res.min, 35300);
  assert.strictEqual(res.max, 52000);
  assert.strictEqual(res.currency, 'USD');

  // "$60,000 - $80,000" → 60000, 80000
  res = parseSalary('$60,000 - $80,000');
  assert.strictEqual(res.min, 60000);
  assert.strictEqual(res.max, 80000);
  assert.strictEqual(res.currency, 'USD');

  // "Competitive" → null, null
  res = parseSalary('Competitive');
  assert.strictEqual(res.min, null);
  assert.strictEqual(res.max, null);
  assert.strictEqual(res.currency, null);

  // Basura / texto no salarial
  res = parseSalary('See description for details');
  assert.strictEqual(res.min, null);
  assert.strictEqual(res.max, null);
});

test('Unit tests: decodeEntities', () => {
  const input = '&amp; &lt; &gt; &quot; &#39; &#38; &#x26;';
  const expected = '& < > " \' & &';
  assert.strictEqual(decodeEntities(input), expected);
});

test('Unit tests: stripHtml and clean', () => {
  const html = '<p>Hello <strong>World</strong>!</p><script>alert(1)</script>';
  assert.strictEqual(stripHtml(html), 'Hello World !');
  assert.strictEqual(clean('   foo   bar  '), 'foo bar');
  assert.strictEqual(clean('   '), null);
  assert.strictEqual(clean(null), null);
});

test('Unit tests: toIso', () => {
  // Con zona horaria
  assert.strictEqual(toIso('2026-11-13T00:00:15+00:00'), '2026-11-13T00:00:15.000Z');
  // Sin zona horaria (debe asumir UTC)
  assert.strictEqual(toIso('2026-11-11T20:17:48'), '2026-11-11T20:17:48.000Z');
  // Formato RFC/HTTP de RSS
  assert.strictEqual(toIso('Fri, 13 Nov 2026 21:41:29 +0000'), '2026-11-13T21:41:29.000Z');
  // Invalido
  assert.strictEqual(toIso('not a date'), null);
});

test('RemoteOK: fixture processing', () => {
  const rawData = fs.readFileSync(path.join(FIXTURES_DIR, 'remoteok.json'), 'utf-8');
  const jobs = normalizeRemoteok(rawData);

  // Número de ofertas esperado: 3 (el elemento legal inicial es ignorado)
  assert.strictEqual(jobs.length, 3);

  for (const job of jobs) {
    assert.strictEqual(job.source, 'remoteok');
    assert.ok(job.source_id && typeof job.source_id === 'string');
    assert.ok(job.url && typeof job.url === 'string');
    assert.ok(job.title && typeof job.title === 'string');
    assert.ok(job.published_at && !isNaN(new Date(job.published_at).getTime()));
    assert.strictEqual(job.published_at, new Date(job.published_at).toISOString());
    assert.ok(Array.isArray(job.tags));
    assert.ok(typeof job.raw === 'object' && job.raw !== null);
  }

  // Comprobar primer trabajo Supabase
  const supabase = jobs[0];
  assert.strictEqual(supabase.company, 'Supabase');
  assert.strictEqual(supabase.title, 'Software Engineer AI Tooling');
  assert.strictEqual(supabase.source_id, '1137793');
  assert.strictEqual(supabase.salary_min, null);
  assert.strictEqual(supabase.salary_max, null);
  assert.strictEqual(supabase.salary_currency, null);
  assert.strictEqual(supabase.location, null); // "" -> null
  assert.ok(supabase.tags.includes('javascript'));
  assert.ok(supabase.tags.includes('typescript'));
});

test('Remotive: fixture processing', () => {
  const rawData = fs.readFileSync(path.join(FIXTURES_DIR, 'remotive.json'), 'utf-8');
  const jobs = normalizeRemotive(rawData);

  // Número de ofertas esperado: 3
  assert.strictEqual(jobs.length, 3);

  for (const job of jobs) {
    assert.strictEqual(job.source, 'remotive');
    assert.ok(job.source_id && typeof job.source_id === 'string');
    assert.ok(job.url && typeof job.url === 'string');
    assert.ok(job.title && typeof job.title === 'string');
    assert.ok(job.published_at && !isNaN(new Date(job.published_at).getTime()));
    assert.strictEqual(job.published_at, new Date(job.published_at).toISOString());
    assert.ok(Array.isArray(job.tags));
    assert.ok(typeof job.raw === 'object' && job.raw !== null);
  }

  // Oferta con salario "$35,3k- $52k"
  const coalition = jobs[0];
  assert.strictEqual(coalition.salary_min, 35300);
  assert.strictEqual(coalition.salary_max, 52000);
  assert.strictEqual(coalition.salary_currency, 'USD');
  assert.strictEqual(coalition.job_type, 'full-time');
  assert.strictEqual(coalition.category, 'Marketing');

  // Oferta con salario vacio
  const lemon = jobs[1];
  assert.strictEqual(lemon.salary_min, null);
  assert.strictEqual(lemon.salary_max, null);
  assert.strictEqual(lemon.salary_currency, null);
});

test('WWR: fixture processing', () => {
  const rawData = fs.readFileSync(path.join(FIXTURES_DIR, 'wwr.xml'), 'utf-8');
  const jobs = normalizeWwr(rawData);

  // Número de ofertas esperado: 4
  assert.strictEqual(jobs.length, 4);

  for (const job of jobs) {
    assert.strictEqual(job.source, 'wwr');
    assert.ok(job.source_id && typeof job.source_id === 'string');
    assert.ok(job.url && typeof job.url === 'string');
    assert.ok(job.title && typeof job.title === 'string');
    assert.ok(job.published_at && !isNaN(new Date(job.published_at).getTime()));
    assert.strictEqual(job.published_at, new Date(job.published_at).toISOString());
    assert.ok(Array.isArray(job.tags));
    assert.ok(typeof job.raw === 'object' && job.raw !== null);
    assert.strictEqual(job.salary_min, null);
    assert.strictEqual(job.salary_max, null);
    assert.strictEqual(job.salary_currency, null);
  }

  // Caso específico de SPEC: "Pavago: SEO &amp; Digital Marketing Specialist" → company "Pavago", title "SEO & Digital Marketing Specialist"
  const pavago = jobs[0];
  assert.strictEqual(pavago.company, 'Pavago');
  assert.strictEqual(pavago.title, 'SEO & Digital Marketing Specialist');
  assert.strictEqual(pavago.job_type, 'full-time');
  assert.strictEqual(pavago.location, 'Anywhere in the World');

  // Verificar skills separados por "," y " and "
  assert.ok(pavago.tags.includes('analytics'));
  assert.ok(pavago.tags.includes('seo'));
  assert.ok(pavago.tags.includes('data visualization'));

  // Verificar combinacion region + country en el cuarto job (WeVote)
  const weVote = jobs[3];
  assert.strictEqual(weVote.company, 'WeVote');
  assert.strictEqual(weVote.title, 'Managing Editor (Volunteer)');
  assert.strictEqual(weVote.location, 'California, 🇺🇸 United States of America');
});

test('Error resilience: empty or invalid inputs', () => {
  assert.deepStrictEqual(normalizeRemoteok(''), []);
  assert.deepStrictEqual(normalizeRemoteok(null), []);
  assert.deepStrictEqual(normalizeRemoteok('{ bad json'), []);
  assert.deepStrictEqual(normalizeRemoteok('{"not": "an array"}'), []);

  assert.deepStrictEqual(normalizeRemotive(''), []);
  assert.deepStrictEqual(normalizeRemotive(null), []);
  assert.deepStrictEqual(normalizeRemotive('{ bad json'), []);
  assert.deepStrictEqual(normalizeRemotive('[]'), []);

  assert.deepStrictEqual(normalizeWwr(''), []);
  assert.deepStrictEqual(normalizeWwr(null), []);
  assert.deepStrictEqual(normalizeWwr('not xml at all'), []);
  assert.deepStrictEqual(normalizeWwr('<channel><title>No items</title></channel>'), []);
});

// --- Casos añadidos en la revisión (Claude) ---
test('Revisión: entidades sin doble decodificación y emojis', () => {
  const { decodeEntities } = require('./common.js');
  assert.strictEqual(decodeEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  assert.strictEqual(decodeEntities('&#127482;&#127480;'), '🇺🇸');
  assert.strictEqual(decodeEntities('&#x1F680;'), '🚀');
});

test('Revisión: salarios no anuales → null', () => {
  const { parseSalary } = require('./common.js');
  const { normalizeRemotive } = require('./remotive.js');
  for (const s of ['$14 - $20/hour', '$3,000 per month', '$25/hr', '$4k monthly']) {
    assert.deepStrictEqual(parseSalary(s), { min: null, max: null, currency: null }, s);
  }
  assert.deepStrictEqual(parseSalary('$100k'), { min: 100000, max: 100000, currency: 'USD' });
  const [o] = normalizeRemotive(JSON.stringify({ jobs: [{ id: 1, url: 'u', title: 't', salary: '$20/hour' }] }));
  assert.strictEqual(o.salary_min, null);
});

test('Revisión: raw sin HTML de descripción ni logos', () => {
  const fs = require('fs'); const p = require('path');
  const fx = (f) => fs.readFileSync(p.join(__dirname, 'fixtures', f), 'utf8');
  const all = [
    ...require('./remoteok.js').normalizeRemoteok(fx('remoteok.json')),
    ...require('./remotive.js').normalizeRemotive(fx('remotive.json')),
    ...require('./wwr.js').normalizeWwr(fx('wwr.xml')),
  ];
  for (const o of all) {
    for (const k of ['description', 'company_logo', 'logo']) assert.ok(!(k in o.raw), `${o.source} raw.${k}`);
    assert.ok(o.description && o.description.length <= 20000);
  }
});

// --- Pruebas para GetOnBrd y n8nforum ---
const { normalizeGetonbrd } = require('./getonbrd.js');
const { normalizeN8nforum } = require('./n8nforum.js');

test('GetOnBrd: fixture processing', () => {
  const rawData = fs.readFileSync(path.join(FIXTURES_DIR, 'getonbrd.json'), 'utf-8');
  const jobs = normalizeGetonbrd(rawData);

  // 6 ofertas en el fixture -> 4 remotas (2 fully_remote + 2 remote_local)
  assert.strictEqual(jobs.length, 4);

  for (const job of jobs) {
    assert.strictEqual(job.source, 'getonbrd');
    assert.ok(job.source_id && typeof job.source_id === 'string');
    assert.ok(job.url && typeof job.url === 'string');
    assert.ok(job.title && typeof job.title === 'string');
    assert.ok(job.published_at && !isNaN(new Date(job.published_at).getTime()));
    assert.strictEqual(job.published_at, new Date(job.published_at).toISOString());
    assert.ok(Array.isArray(job.tags) && job.tags.length > 0);
    assert.ok(typeof job.raw === 'object' && job.raw !== null);
    assert.ok(!('description' in job.raw));
    assert.ok(!('functions' in job.raw));
    assert.ok(!('desirable' in job.raw));
    assert.ok(!('benefits' in job.raw));
    assert.ok(!('projects' in job.raw));
    assert.ok(typeof job.raw.company === 'string');
    assert.ok('seniority_name' in job.raw);
    assert.ok('lang' in job.raw);
  }

  // Oferta "AI Engineer" (Interfell)
  const aiEngineer = jobs.find((j) => j.title === 'AI Engineer');
  assert.ok(aiEngineer);
  assert.strictEqual(aiEngineer.company, 'Interfell');
  // Salario mensual 5000 / 6000 -> anual 60000 / 72000
  assert.strictEqual(aiEngineer.salary_min, 60000);
  assert.strictEqual(aiEngineer.salary_max, 72000);
  assert.strictEqual(aiEngineer.salary_currency, 'USD');
  assert.strictEqual(aiEngineer.location, 'Remote (worldwide)');
  assert.strictEqual(aiEngineer.job_type, 'full-time');
  assert.ok(aiEngineer.tags.includes('typescript'));
  assert.ok(aiEngineer.tags.includes('large language models'));
  assert.ok(aiEngineer.description && aiEngineer.description.length <= 20000);

  // Comprobar location con remote_local y countries: ["Remote"] -> "Remote (local)"
  const staffMl = jobs.find((j) => j.source_id === 'staff-data-scientist-machine-learning-engineer-andersen-lab-remote');
  assert.ok(staffMl);
  assert.strictEqual(staffMl.location, 'Remote (local)');
});

test('n8nforum: fixture processing', () => {
  const rawData = fs.readFileSync(path.join(FIXTURES_DIR, 'n8nforum.xml'), 'utf-8');
  const jobs = normalizeN8nforum(rawData);

  // 5 ítems en el XML -> 5 ofertas
  assert.strictEqual(jobs.length, 5);

  for (const job of jobs) {
    assert.strictEqual(job.source, 'n8nforum');
    assert.ok(job.source_id && typeof job.source_id === 'string');
    // source_id debe ser numérico según guid del fixture (e.g. "328131")
    assert.match(job.source_id, /^\d+$/);
    assert.ok(job.url && typeof job.url === 'string');
    assert.ok(job.title && typeof job.title === 'string');
    assert.ok(!job.title.includes('&amp;'));
    assert.strictEqual(job.company, null);
    assert.strictEqual(job.location, null);
    assert.deepStrictEqual(job.tags, []);
    assert.strictEqual(job.salary_min, null);
    assert.strictEqual(job.salary_max, null);
    assert.strictEqual(job.salary_currency, null);
    assert.ok(job.published_at && !isNaN(new Date(job.published_at).getTime()));
    assert.strictEqual(job.published_at, new Date(job.published_at).toISOString());
    assert.ok(typeof job.raw === 'object' && job.raw !== null);
    assert.ok('guid' in job.raw);
    assert.ok('link' in job.raw);
    assert.ok('pubDate' in job.raw);
    assert.ok('creator' in job.raw);
    assert.ok('category' in job.raw);
  }

  // Título con &amp; decodificado
  const secondJob = jobs.find((j) => j.source_id === '328000');
  assert.ok(secondJob);
  assert.ok(secondJob.title.includes('Marketing Attribution & Lead Automation'));
  assert.strictEqual(secondJob.job_type, 'freelance');

  // Caso part-time en fixture
  const partTimeJob = jobs.find((j) => j.source_id === '327583');
  assert.ok(partTimeJob);
  assert.strictEqual(partTimeJob.job_type, 'part-time');

  // Prueba unitaria de detección de job_type con XML mínimo que incluya "Full-Time"
  const sampleXml = `
    <rss><channel>
      <item>
        <title>[HIRING] Senior Full-Time Engineer</title>
        <guid>community.n8n.io-topic-999999</guid>
        <link>https://community.n8n.io/t/test/999999</link>
        <pubDate>Wed, 11 Nov 2026 14:47:23 +0000</pubDate>
        <description>&lt;p&gt;Sample job description&lt;/p&gt;</description>
      </item>
      <item>
        <title>Pinned job</title>
        <discourse:topicPinned>Yes</discourse:topicPinned>
        <guid>community.n8n.io-topic-888888</guid>
        <link>https://community.n8n.io/t/pinned/888888</link>
      </item>
      <item>
        <title>Contract position</title>
        <guid>community.n8n.io-topic-777777</guid>
        <link>https://community.n8n.io/t/contract/777777</link>
      </item>
    </channel></rss>
  `;
  const customJobs = normalizeN8nforum(sampleXml);
  assert.strictEqual(customJobs.length, 2); // el pinned es omitido
  assert.strictEqual(customJobs[0].job_type, 'full-time');
  assert.strictEqual(customJobs[0].source_id, '999999');
  assert.strictEqual(customJobs[1].job_type, 'contract');
});

test('Error resilience: getonbrd and n8nforum empty or invalid inputs', () => {
  assert.deepStrictEqual(normalizeGetonbrd(''), []);
  assert.deepStrictEqual(normalizeGetonbrd(null), []);
  assert.deepStrictEqual(normalizeGetonbrd('{ bad json'), []);
  assert.deepStrictEqual(normalizeGetonbrd('{"data": "not an array"}'), []);

  assert.deepStrictEqual(normalizeN8nforum(''), []);
  assert.deepStrictEqual(normalizeN8nforum(null), []);
  assert.deepStrictEqual(normalizeN8nforum('not xml at all'), []);
  assert.deepStrictEqual(normalizeN8nforum('<channel><title>No items</title></channel>'), []);
});

test('Revisión: n8nforum source_id no toma el "8" de "n8n"', () => {
  const xml = (g) => `<rss><channel><item><title>T</title><guid>${g}</guid><link>https://community.n8n.io/t/x/1</link></item></channel></rss>`;
  assert.strictEqual(normalizeN8nforum(xml('community.n8n.io-topic-328131'))[0].source_id, '328131');
  assert.strictEqual(normalizeN8nforum(xml('community.n8n.io-topic-5'))[0].source_id, '5');
});

test('Revisión: getonbrd remote_local usa países expandidos', () => {
  const body = JSON.stringify({ data: [{ id: 'x', links: { public_url: 'https://g/x' }, attributes: {
    title: 'Dev', remote_modality: 'remote_local', countries: ['Remote'], published_at: 1794490311,
    location_tenants: { data: [{ id: 'colombia', attributes: { name: 'Colombia' } }, { id: 'chile', attributes: { name: 'Chile' } }] },
    location_regions: { data: [{ id: 'south_america', attributes: { name: 'South America' } }] },
  } }] });
  const [o] = normalizeGetonbrd(body);
  assert.strictEqual(o.location, 'Remote (Colombia, Chile, South America)');
  assert.deepStrictEqual(o.raw.location_tenants, ['Colombia', 'Chile']);
});
