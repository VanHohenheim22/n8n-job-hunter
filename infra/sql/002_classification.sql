-- Clasificación por reglas (WF2). Aplicar: docker compose exec -T postgres psql -U n8n -d jobs < sql/002_classification.sql
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS score         integer,
  ADD COLUMN IF NOT EXISTS reasons       text[]      NOT NULL DEFAULT '{}',  -- por qué pasó o se descartó
  ADD COLUMN IF NOT EXISTS lang          text,                               -- es | en (estimado)
  ADD COLUMN IF NOT EXISTS classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_at   timestamptz;
CREATE INDEX IF NOT EXISTS offers_pending_notify_idx ON offers (score DESC) WHERE status = 'candidate' AND notified_at IS NULL;
