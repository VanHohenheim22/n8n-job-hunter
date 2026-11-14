/**
 * Normalizador para RemoteOK.
 * Funciona de forma autocontenida sin require/import.
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

// raw sin el HTML de la descripción (ya está como texto en `description`) ni logos: ~85% menos espacio.
const RAW_DROP = ['description', 'company_logo', 'company_logo_url', 'logo', 'image'];
function slimRaw(item) {
  return Object.fromEntries(Object.entries(item).filter(([k]) => !RAW_DROP.includes(k)));
}

function normalizeRemoteok(body) {
  if (!body) return [];

  let data;
  try {
    data = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return [];
  }

  if (!Array.isArray(data)) return [];

  const results = [];

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    // El elemento 0 u otros pueden ser avisos legales sin id: ignorarlos
    if (!item.id) continue;

    try {
      const sourceId = String(item.id).trim();
      const url = clean(item.url);
      const title = clean(item.position);

      if (!sourceId || !url || !title) continue;

      const company = clean(item.company);
      const location = clean(item.location);

      let tags = [];
      if (Array.isArray(item.tags)) {
        const tagSet = new Set();
        for (const t of item.tags) {
          const cleanedTag = clean(t);
          if (cleanedTag) {
            tagSet.add(cleanedTag.toLowerCase());
          }
        }
        tags = Array.from(tagSet);
      }

      const salaryMin = typeof item.salary_min === 'number' && item.salary_min > 0 ? Math.round(item.salary_min) : null;
      const salaryMax = typeof item.salary_max === 'number' && item.salary_max > 0 ? Math.round(item.salary_max) : null;
      const hasSalary = salaryMin !== null || salaryMax !== null;
      const salaryCurrency = hasSalary ? 'USD' : null;

      const publishedAt = toIso(item.date);
      const description = stripHtml(item.description);

      results.push({
        source: 'remoteok',
        source_id: sourceId,
        url: url,
        title: title,
        company: company,
        location: location,
        tags: tags,
        category: null,
        job_type: null,
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
        published_at: publishedAt,
        description: description,
        raw: slimRaw(item),
      });
    } catch (e) {
      // Ignorar registro con error
      continue;
    }
  }

  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { normalizeRemoteok };
}
