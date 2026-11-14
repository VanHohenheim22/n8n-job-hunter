-- Base: jobs. Aplicar: docker compose exec -T postgres psql -U n8n -d jobs < sql/001_offers.sql
CREATE TABLE IF NOT EXISTS offers (
  id              bigserial PRIMARY KEY,
  source          text        NOT NULL,             -- remoteok | remotive | wwr | ...
  source_id       text        NOT NULL,             -- id estable dentro de la fuente
  url             text        NOT NULL,
  title           text        NOT NULL,
  company         text,
  location        text,                             -- texto libre de la fuente ("Worldwide", "LATAM"...)
  tags            text[]      NOT NULL DEFAULT '{}',
  category        text,
  job_type        text,                             -- full-time, contract, freelance...
  salary_min      integer,
  salary_max      integer,
  salary_currency text,
  published_at    timestamptz,
  description     text,                             -- texto plano, recortado
  raw             jsonb,                            -- registro original (para reprocesar)
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  status          text        NOT NULL DEFAULT 'new', -- new | filtered_out | candidate | applied | discarded
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS offers_published_idx ON offers (published_at DESC);
CREATE INDEX IF NOT EXISTS offers_status_idx    ON offers (status);
CREATE INDEX IF NOT EXISTS offers_tags_idx      ON offers USING gin (tags);
