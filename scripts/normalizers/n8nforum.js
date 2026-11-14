/**
 * Normalizador para n8n Community Forum (Discourse RSS feed).
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

function extractTagContent(xmlSnippet, tagName) {
  // Escapar posibles caracteres especiales en el tagName como ":"
  const escapedTag = tagName.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
  const regex = new RegExp('<' + escapedTag + '(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/' + escapedTag + '>', 'i');
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

function detectJobTypeFromTitle(title) {
  if (!title || typeof title !== 'string') return null;

  // Orden de búsqueda:
  // "full-time"/"full time" → "full-time"
  // "part-time"/"part time" → "part-time"
  // "freelance" → "freelance"
  // "contract" → "contract"
  // si no, null. (el primero que aparezca en ese orden)
  if (/\bfull[- ]time\b/i.test(title)) {
    return 'full-time';
  }
  if (/\bpart[- ]time\b/i.test(title)) {
    return 'part-time';
  }
  if (/\bfreelance(r|rs)?\b/i.test(title)) {
    return 'freelance';
  }
  if (/\bcontract(or|ors)?\b/i.test(title)) {
    return 'contract';
  }
  return null;
}

function extractSourceId(guid, link) {
  if (guid) {
    // "community.n8n.io-topic-328131" -> "328131" o cualquier número de tema
    const match = guid.match(/topic-(\d+)\s*$/); // ojo: "n8n" también contiene un dígito
    if (match) {
      return match[1];
    }
    return clean(guid);
  }
  return clean(link);
}

function normalizeN8nforum(body) {
  if (!body || typeof body !== 'string') return [];

  const itemMatches = [...body.matchAll(/<item(?:\s+[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!itemMatches || itemMatches.length === 0) return [];

  const results = [];

  for (const m of itemMatches) {
    const itemXml = m[1];
    try {
      // Omitir fijados y archivados. NO filtrar cerrados: el foro cierra todas las ofertas (se responde por DM).
      const pinned = extractTagContent(itemXml, 'discourse:topicPinned');
      if (pinned && pinned.toLowerCase() === 'yes') {
        continue;
      }
      const archived = extractTagContent(itemXml, 'discourse:topicArchived');
      if (archived && archived.toLowerCase() === 'yes') {
        continue;
      }

      const rawTitle = extractTagContent(itemXml, 'title') || '';
      const guid = extractTagContent(itemXml, 'guid');
      const link = extractTagContent(itemXml, 'link');
      const pubDate = extractTagContent(itemXml, 'pubDate');
      const creator = extractTagContent(itemXml, 'dc:creator');
      const category = extractTagContent(itemXml, 'category');
      const descriptionHtml = extractTagContent(itemXml, 'description');

      const sourceId = extractSourceId(guid, link);
      const url = clean(link);
      const title = clean(rawTitle);

      if (!sourceId || !url || !title) continue;

      const jobType = detectJobTypeFromTitle(title);
      const publishedAt = toIso(pubDate);
      const description = stripHtml(descriptionHtml);

      // raw: { guid, link, pubDate, creator, category } como strings
      const raw = {
        guid: guid || '',
        link: link || '',
        pubDate: pubDate || '',
        creator: creator || '',
        category: category || '',
      };

      results.push({
        source: 'n8nforum',
        source_id: sourceId,
        url: url,
        title: title,
        company: null,
        location: null,
        tags: [],
        category: clean(category),
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
  module.exports = { normalizeN8nforum };
}
