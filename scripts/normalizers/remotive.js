/**
 * Normalizador para Remotive.
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
    // Remotive viene sin zona → asumir UTC
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

function parseSalary(salaryStr) {
  if (!salaryStr || typeof salaryStr !== 'string') {
    return { min: null, max: null, currency: null };
  }

  const s = salaryStr.trim();
  if (!s || /competitive/i.test(s)) {
    return { min: null, max: null, currency: null };
  }
  // Solo salarios anuales: por hora/día/semana/mes → null (el texto original queda en raw)
  if (/(\/\s*(h|hr|hour|d|day|wk|week|mo|month)\b)|\b(per|an?)\s+(hour|day|week|month)\b|\b(hourly|daily|weekly|monthly)\b/i.test(s)) {
    return { min: null, max: null, currency: null };
  }

  const currency = s.includes('$') ? 'USD' : null;

  // Extraer números e indicador 'k'
  // Admite "$35,3k- $52k", "$60,000 - $80,000", "$14 - $20/hour"
  const matches = [...s.matchAll(/(?:[\$€£])?\s*(\d+(?:[.,]\d+)?)\s*([kK])?/g)];
  if (!matches || matches.length === 0) {
    return { min: null, max: null, currency };
  }

  const numbers = [];
  for (const match of matches) {
    let rawNum = match[1];
    const isK = !!match[2];

    let val = 0;
    if (isK) {
      rawNum = rawNum.replace(',', '.');
      val = Math.round(parseFloat(rawNum) * 1000);
    } else {
      if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(rawNum)) {
        rawNum = rawNum.replace(/,/g, '');
      } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(rawNum)) {
        rawNum = rawNum.replace(/\./g, '').replace(',', '.');
      } else {
        rawNum = rawNum.replace(/,/g, '');
      }
      val = Math.round(parseFloat(rawNum));
    }

    if (!isNaN(val)) {
      numbers.push(val);
    }
  }

  if (numbers.length === 0) {
    return { min: null, max: null, currency };
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0], currency };
  }

  return {
    min: numbers[0],
    max: numbers[1],
    currency,
  };
}

// raw sin el HTML de la descripción (ya está como texto en `description`) ni logos: ~85% menos espacio.
const RAW_DROP = ['description', 'company_logo', 'company_logo_url', 'logo', 'image'];
function slimRaw(item) {
  return Object.fromEntries(Object.entries(item).filter(([k]) => !RAW_DROP.includes(k)));
}

function normalizeJobType(jt) {
  if (!jt || typeof jt !== 'string') return null;
  const s = jt.trim().toLowerCase().replace(/_/g, '-');
  return s.length > 0 ? s : null;
}

function normalizeRemotive(body) {
  if (!body) return [];

  let data;
  try {
    data = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return [];
  }

  if (!data || typeof data !== 'object') return [];
  const jobs = data.jobs;
  if (!Array.isArray(jobs)) return [];

  const results = [];

  for (const item of jobs) {
    if (!item || typeof item !== 'object') continue;
    if (item.id === undefined || item.id === null) continue;

    try {
      const sourceId = String(item.id).trim();
      const url = clean(item.url);
      const title = clean(item.title);

      if (!sourceId || !url || !title) continue;

      const company = clean(item.company_name);
      const location = clean(item.candidate_required_location);

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

      const category = clean(item.category);
      const jobType = normalizeJobType(item.job_type);

      const parsedSalary = parseSalary(item.salary);
      const publishedAt = toIso(item.publication_date);
      const description = stripHtml(item.description);

      results.push({
        source: 'remotive',
        source_id: sourceId,
        url: url,
        title: title,
        company: company,
        location: location,
        tags: tags,
        category: category,
        job_type: jobType,
        salary_min: parsedSalary.min,
        salary_max: parsedSalary.max,
        salary_currency: parsedSalary.currency,
        published_at: publishedAt,
        description: description,
        raw: slimRaw(item),
      });
    } catch (e) {
      continue;
    }
  }

  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { normalizeRemotive };
}
