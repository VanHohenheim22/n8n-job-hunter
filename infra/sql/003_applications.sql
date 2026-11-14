-- Aplicaciones (WF3). Aplicar: docker compose exec -T postgres psql -U n8n -d jobs < sql/003_applications.sql
CREATE TABLE IF NOT EXISTS applications (
  id             bigserial PRIMARY KEY,
  offer_id       bigint      NOT NULL REFERENCES offers(id),
  channel        text        NOT NULL,              -- email | forum_dm | web
  recipient      text,                              -- email, usuario del foro o URL donde aplicar
  lang           text        NOT NULL,              -- es | en
  subject        text,
  body           text        NOT NULL,
  hook           text,                              -- frase personalizada por la IA (para auditar)
  model          text,                              -- modelo que generó el hook
  status         text        NOT NULL DEFAULT 'draft', -- draft | approved | sent | discarded
  tg_message_id  bigint,                            -- mensaje del borrador en Telegram (para editar)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  sent_at        timestamptz
);
CREATE INDEX IF NOT EXISTS applications_offer_idx ON applications (offer_id);
CREATE INDEX IF NOT EXISTS applications_tg_idx    ON applications (tg_message_id);
