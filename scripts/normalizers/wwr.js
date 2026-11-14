/**
 * Normalizador para We Work Remotely (WWR RSS feed).
 * Funciona de forma autocontenida sin dependencias externas ni librerías XML.
 */

function stripHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const decoded = decodeEntities(text);
  const collapsed = clean(decoded);
  if (!collapsed) return null;
  return collapsed.slice(0, 20000);
}

function decodeEntities(str) {
  if (!str || typeof str !== 'string') return '';
  const cp = (n, m) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);
  // &amp; va al final para no decodificar dos veces ("&amp;lt;" → "&lt;")
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => cp(parseInt(d, 10), m))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => cp(parseInt(h, 16), m))
    .replace(/&amp;/g, '&');
}

function clean(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

function toIso(dateStr) {
  if (!dateStr) return null;
  try {
    let s = String(dateStr).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
      s += 'Z';
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}

function normalizeJobType(jt) {
  if (!jt || typeof jt !== 'string') return null;
  const s = jt.trim().toLowerCase().replace(/_/g, '-');
  return s.length > 0 ? s : null;
}

function extractTagContent(xmlSnippet, tagName) {
  // Manejar tags simples y con posibles atributos: <tag ...>content</tag>
  const regex = new RegExp('<' + tagName + '(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/' + tagName + '>', 'i');
  const match = xmlSnippet.match(regex);
  if (!match) return null;

  let content = match[1].trim();

  // Si contiene CDATA, extraerlo
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdataMatch) {
    content = cdataMatch[1];
  } else {
    // Si contiene múltiples CDATAs o está mezclado
    content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  }

  // Decodificar entidades
  return decodeEntities(content);
}

function parseWwrSkills(skillsStr) {
  if (!skillsStr || typeof skillsStr !== 'string') return [];
  // wwr: <skills> separado por "," y " and "
  // minúsculas, sin espacios extremos, sin duplicados
  const parts = skillsStr.split(/,|\band\b/i);
  const tagSet = new Set();
  for (const p of parts) {
    const cleaned = clean(p);
    if (cleaned) {
      tagSet.add(cleaned.toLowerCase());
    }
  }
  return Array.from(tagSet);
}

function normalizeWwr(body) {
  if (!body || typeof body !== 'string') return [];

  // Extraer items
  const itemMatches = [...body.matchAll(/<item(?:\s+[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!itemMatches || itemMatches.length === 0) return [];

  const results = [];

  for (const m of itemMatches) {
    const itemXml = m[1];
    try {
      const rawTitle = extractTagContent(itemXml, 'title') || '';
      const guid = extractTagContent(itemXml, 'guid');
      const link = extractTagContent(itemXml, 'link');
      const pubDate = extractTagContent(itemXml, 'pubDate');
      const descriptionHtml = extractTagContent(itemXml, 'description');
      const region = extractTagContent(itemXml, 'region');
      const country = extractTagContent(itemXml, 'country');
      const category = extractTagContent(itemXml, 'category');
      const type = extractTagContent(itemXml, 'type');
      const skills = extractTagContent(itemXml, 'skills');

      // raw: objeto con los campos del item como strings
      const raw = {
        title: rawTitle,
        guid: guid || '',
        link: link || '',
        pubDate: pubDate || '',
        region: region || '',
        country: country || '',
        category: category || '',
        type: type || '',
        skills: skills || '',
      };

      const sourceId = clean(guid) || clean(link);
      const url = clean(link);

      // Separar title por el PRIMER ": "
      let company = null;
      let title = null;

      const colonIdx = rawTitle.indexOf(': ');
      if (colonIdx !== -1) {
        company = clean(rawTitle.slice(0, colonIdx));
        title = clean(rawTitle.slice(colonIdx + 2));
      } else {
        title = clean(rawTitle);
      }

      if (!sourceId || !url || !title) continue;

      // location: <region> + <country> si existe. "" → null
      const locParts = [];
      const cleanRegion = clean(region);
      const cleanCountry = clean(country);
      if (cleanRegion) locParts.push(cleanRegion);
      if (cleanCountry) locParts.push(cleanCountry);
      const location = locParts.length > 0 ? locParts.join(', ') : null;

      const tags = parseWwrSkills(skills);
      const jobCategory = clean(category);
      const jobType = normalizeJobType(type);
      const publishedAt = toIso(pubDate);
      const description = stripHtml(descriptionHtml);

      results.push({
        source: 'wwr',
        source_id: sourceId,
        url: url,
        title: title,
        company: company,
        location: location,
        tags: tags,
        category: jobCategory,
        job_type: jobType,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        published_at: publishedAt,
        description: description,
        raw: raw,
      });
    } catch (e) {
      continue;
    }
  }

  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { normalizeWwr };
}
