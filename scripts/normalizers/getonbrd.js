/**
 * Normalizador para GetOnBrd (API v0).
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

function normalizeJobType(jt) {
  if (!jt || typeof jt !== 'string') return null;
  const s = jt.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return s.length > 0 ? s : null;
}

const RAW_DROP_KEYS = [
  'description',
  'functions',
  'desirable',
  'benefits',
  'projects',
  'description_headline',
  'functions_headline',
  'benefits_headline',
  'desirable_headline',
];

function slimRawGetonbrd(attributes) {
  const raw = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (RAW_DROP_KEYS.includes(k)) continue;
    raw[k] = v;
  }

  // Países/regiones expandidos → lista de nombres (o de ids si no vienen expandidos)
  for (const k of ['location_tenants', 'location_regions']) {
    const rel = attributes[k];
    if (rel && Array.isArray(rel.data)) {
      raw[k] = rel.data.map((d) => clean(d && d.attributes && d.attributes.name) || (d && d.id)).filter(Boolean);
    }
  }

  // Reducir company, tags, seniority, modality a su nombre (string)
  if (attributes.company && attributes.company.data && attributes.company.data.attributes) {
    raw.company = clean(attributes.company.data.attributes.name);
  } else {
    raw.company = null;
  }

  if (attributes.seniority && attributes.seniority.data && attributes.seniority.data.attributes) {
    raw.seniority = clean(attributes.seniority.data.attributes.name);
    raw.seniority_name = raw.seniority;
  } else {
    raw.seniority = null;
    raw.seniority_name = null;
  }

  if (attributes.modality && attributes.modality.data && attributes.modality.data.attributes) {
    raw.modality = clean(attributes.modality.data.attributes.name);
  } else {
    raw.modality = null;
  }

  if (attributes.tags && attributes.tags.data && Array.isArray(attributes.tags.data)) {
    raw.tags = attributes.tags.data
      .map((t) => t && t.attributes && clean(t.attributes.name))
      .filter(Boolean)
      .join(', ');
  } else {
    raw.tags = null;
  }

  if (attributes.lang !== undefined) {
    raw.lang = attributes.lang;
  }

  return raw;
}

function normalizeGetonbrd(body) {
  if (!body) return [];

  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
    return [];
  }

  const results = [];

  for (const item of parsed.data) {
    if (!item || typeof item !== 'object') continue;

    try {
      const sourceId = clean(item.id);
      const url = clean(item.links && item.links.public_url);
      const attrs = item.attributes;
      if (!sourceId || !url || !attrs || typeof attrs !== 'object') continue;

      // Solo ofertas remotas: attributes.remote_modality in { 'fully_remote', 'remote_local' }
      const remoteModality = attrs.remote_modality;
      if (remoteModality !== 'fully_remote' && remoteModality !== 'remote_local') {
        continue;
      }

      const title = clean(attrs.title);
      if (!title) continue;

      // Company
      let company = null;
      if (attrs.company && attrs.company.data && attrs.company.data.attributes) {
        company = clean(attrs.company.data.attributes.name);
      }

      // Location
      let location = null;
      if (remoteModality === 'fully_remote') {
        location = 'Remote (worldwide)';
      } else if (remoteModality === 'remote_local') {
        // Con expand, location_tenants (países) y location_regions traen nombres; `countries` suele ser ["Remote"].
        const named = (rel) => ((rel && Array.isArray(rel.data)) ? rel.data : [])
          .map((d) => clean(d && d.attributes && d.attributes.name)).filter(Boolean);
        const places = [...named(attrs.location_tenants), ...named(attrs.location_regions)];
        const countries = places.length > 0 ? places
          : Array.isArray(attrs.countries) ? attrs.countries.map((c) => clean(c)).filter(Boolean) : [];
        const isOnlyRemote = countries.length === 0 || (countries.length === 1 && countries[0].toLowerCase() === 'remote');
        if (isOnlyRemote) {
          location = 'Remote (local)';
        } else {
          location = 'Remote (' + countries.join(', ') + ')';
        }
      }

      // Tags: attributes.tags.data[].attributes.name (minúsculas, únicos)
      let tags = [];
      if (attrs.tags && Array.isArray(attrs.tags.data)) {
        const tagSet = new Set();
        for (const t of attrs.tags.data) {
          if (t && t.attributes && t.attributes.name) {
            const tagName = clean(t.attributes.name);
            if (tagName) {
              tagSet.add(tagName.toLowerCase());
            }
          }
        }
        tags = Array.from(tagSet);
      }

      // Category
      const category = clean(attrs.category_name);

      // Job type
      let jobType = null;
      if (attrs.modality && attrs.modality.data && attrs.modality.data.attributes) {
        jobType = normalizeJobType(attrs.modality.data.attributes.name);
      }

      // Salario: min_salary/max_salary son MENSUALES en USD -> guardar ANUAL (* 12).
      // Si uno solo existe, usarlo en ambos.
      let salaryMin = null;
      let salaryMax = null;
      let salaryCurrency = null;

      const rawMin = typeof attrs.min_salary === 'number' && attrs.min_salary > 0 ? attrs.min_salary : null;
      const rawMax = typeof attrs.max_salary === 'number' && attrs.max_salary > 0 ? attrs.max_salary : null;

      if (rawMin !== null || rawMax !== null) {
        const minMonthly = rawMin !== null ? rawMin : rawMax;
        const maxMonthly = rawMax !== null ? rawMax : rawMin;
        salaryMin = Math.round(minMonthly * 12);
        salaryMax = Math.round(maxMonthly * 12);
        salaryCurrency = 'USD';
      }

      // published_at: attributes.published_at es epoch en SEGUNDOS -> ISO
      let publishedAt = null;
      if (attrs.published_at !== null && attrs.published_at !== undefined) {
        const numSec = Number(attrs.published_at);
        if (!isNaN(numSec) && numSec > 0) {
          const d = new Date(numSec * 1000);
          if (!isNaN(d.getTime())) {
            publishedAt = d.toISOString();
          }
        }
      }

      // description: concatenar HTML de description, functions, desirable, benefits (los que existan, separados por un salto) -> stripHtml (máx 20000)
      const descParts = [];
      if (attrs.description && typeof attrs.description === 'string' && attrs.description.trim()) {
        descParts.push(attrs.description.trim());
      }
      if (attrs.functions && typeof attrs.functions === 'string' && attrs.functions.trim()) {
        descParts.push(attrs.functions.trim());
      }
      if (attrs.desirable && typeof attrs.desirable === 'string' && attrs.desirable.trim()) {
        descParts.push(attrs.desirable.trim());
      }
      if (attrs.benefits && typeof attrs.benefits === 'string' && attrs.benefits.trim()) {
        descParts.push(attrs.benefits.trim());
      }

      const combinedHtml = descParts.join('\n');
      const description = stripHtml(combinedHtml);

      // raw
      const raw = slimRawGetonbrd(attrs);

      results.push({
        source: 'getonbrd',
        source_id: sourceId,
        url: url,
        title: title,
        company: company,
        location: location,
        tags: tags,
        category: category,
        job_type: jobType,
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
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
  module.exports = { normalizeGetonbrd };
}
