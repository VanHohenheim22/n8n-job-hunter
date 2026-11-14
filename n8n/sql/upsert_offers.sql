-- $1 = JSON array de ofertas normalizadas (ver scripts/normalizers/SPEC.md)
WITH up AS (
  INSERT INTO offers (source, source_id, url, title, company, location, tags, category, job_type,
                      salary_min, salary_max, salary_currency, published_at, description, raw)
  SELECT x.source, x.source_id, x.url, x.title, x.company, x.location,
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(x.tags)), '{}'),
         x.category, x.job_type, x.salary_min, x.salary_max, x.salary_currency,
         x.published_at, x.description, x.raw
  FROM jsonb_to_recordset($1::jsonb) AS x(
         source text, source_id text, url text, title text, company text, location text,
         tags jsonb, category text, job_type text, salary_min int, salary_max int,
         salary_currency text, published_at timestamptz, description text, raw jsonb)
  WHERE x.source_id IS NOT NULL AND x.url IS NOT NULL AND x.title IS NOT NULL
  -- Refresca el contenido (la oferta pudo editarse); NO toca status/score/notified_at.
  ON CONFLICT (source, source_id) DO UPDATE SET
    last_seen_at = now(), url = EXCLUDED.url, title = EXCLUDED.title, company = EXCLUDED.company,
    location = EXCLUDED.location, tags = EXCLUDED.tags, category = EXCLUDED.category, job_type = EXCLUDED.job_type,
    salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max, salary_currency = EXCLUDED.salary_currency,
    description = EXCLUDED.description, raw = EXCLUDED.raw
  RETURNING source, (xmax = 0) AS inserted
)
SELECT source, count(*) FILTER (WHERE inserted) AS nuevas, count(*) AS total
FROM up GROUP BY source;
