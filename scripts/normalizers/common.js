/**
 * Helpers compartidos para normalizadores de ofertas.
 * Archivo de referencia.
 */

function stripHtml(html) {
  if (!html || typeof html !== 'string') return null;
  // Primero decodificar entidades o reemplazar tags con espacios
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
    // Si viene en formato ISO sin zona horaria como "2026-11-11T20:17:48", asumir UTC
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

  // Detectar moneda si tiene $
  const currency = s.includes('$') ? 'USD' : null;

  // Buscar patrones numéricos en rangos o únicos:
  // e.g. "$35,3k- $52k", "$60,000 - $80,000", "$14 - $20/hour", "$100k"
  // Extraer números con posibles comas/puntos y sufijo k/K
  const matches = [...s.matchAll(/(?:[\$€£])?\s*(\d+(?:[.,]\d+)?)\s*([kK])?/g)];
  
  if (!matches || matches.length === 0) {
    return { min: null, max: null, currency };
  }

  const numbers = [];
  for (const match of matches) {
    let rawNum = match[1];
    const isK = !!match[2];

    // Diferenciar separador de miles vs decimal:
    // Si tiene 'k', ej "35,3k" o "35.3k" -> 35.3 * 1000 = 35300
    // Si es "60,000" -> 60000
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

if (typeof module !== 'undefined') {
  module.exports = {
    stripHtml,
    decodeEntities,
    clean,
    toIso,
    parseSalary,
  };
}
