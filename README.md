# n8n Job Hunter

Self-hosted system that **collects remote job offers from 5 sources, scores them against a profile and sends
the good ones to Telegram** — built with n8n, PostgreSQL and Docker.

It runs 24/7 on a home server: ~450 offers collected in the first run, ~50 shortlisted automatically,
zero AI tokens spent on filtering (rules first, AI only where judgment is needed).

## How it works

```mermaid
flowchart LR
  subgraph WF1["WF1 · Collect (every 6 h)"]
    A[RemoteOK API] --> N[Normalize]
    B[Remotive API] --> N
    C[We Work Remotely RSS] --> N
    D[n8n Forum RSS] --> N
    E[GetOnBrd API<br/>paginated] --> N
  end
  N -->|upsert + dedupe| P[(PostgreSQL<br/>offers)]
  subgraph WF2["WF2 · Filter & notify (hourly)"]
    P --> R[SQL rules<br/>score + reasons]
    R --> F[Format<br/>1 msg per offer / digest]
    F --> T[Telegram bot]
    T --> M[Mark notified]
  end
```

**WF1 – Collection.** One branch per source: download → normalize → save. Each source is isolated
(`continue on error` + retries), so one API being down never stops the others. Offers are normalized to a common
schema and **upserted** by `(source, source_id)`: new offers are inserted, existing ones only refresh their content
and `last_seen_at` — which also tells how long each offer stays published.

**WF2 – Filter & notify.** Deterministic SQL rules classify every new offer as `candidate` or `filtered_out`,
storing a **score** and the **reasons** (e.g. `n8n, español, región ok` or `región excluye Colombia`), so every
decision is auditable and nothing is deleted (the full dataset feeds a market study). Candidates are sent to
Telegram: one message per offer, or a single digest when there are many.

| Signal | Points |
|---|---|
| Mentions n8n | +50 |
| Automation in the title / Zapier, Make, Power Automate | +25 |
| JavaScript / Node / TypeScript / React | +20 |
| Java / Spring | +20 |
| Spanish and no English requirement | +20 |
| AI / agents / LLM in the title | +10 |
| Explicitly open to LATAM / worldwide | +10 |

Hard filters: region must include Colombia, no Staff/Principal/Lead roles, published in the last 30 days,
and forum posts must be actual job offers (not "for hire" posts).

## Engineering highlights

- **Workflows as code.** Normalizers are plain JavaScript in `scripts/normalizers/`, covered by unit tests
  (`node --test`, 16 tests with real fixtures). `scripts/build_wf1.js` embeds them into n8n Code nodes and
  generates the workflow JSON — the JSON in git is always generated, never hand-edited.
- **n8n API client.** `scripts/n8n.sh` (curl + jq) lists, pulls, pushes, activates workflows and summarizes
  executions per node in a few lines — no clicking through the UI to deploy or debug.
- **Failure handling.** Per-source isolation, retries, batching (1 request / 1.5 s) for paginated APIs,
  in-memory dedupe before the upsert, tolerant parsers that skip bad records instead of failing the run.
- **Storage-aware.** Raw records are kept for reprocessing but stripped of duplicated HTML and logos
  (table went from 3.2 MB to 1 MB with no information loss).
- **Security.** Secrets only in `.env`; ports bound to `127.0.0.1`; containers that process untrusted web content
  get no Docker socket and no host home access; all external text is HTML-escaped before reaching Telegram;
  credentials are imported into n8n without ever being written to disk.

## Stack

n8n · PostgreSQL 17 · Docker Compose · JavaScript (Node.js) · SQL · Bash · Telegram Bot API

## Run it

```bash
cd infra
cp .env.example .env          # fill in passwords/keys (openssl rand -hex 32)
docker compose up -d          # n8n on http://localhost:5678
docker compose exec -T postgres psql -U n8n -d jobs < sql/001_offers.sql
docker compose exec -T postgres psql -U n8n -d jobs < sql/002_classification.sql
cd ..
node --test scripts/normalizers/      # tests
node scripts/build_wf1.js && scripts/n8n.sh push n8n/workflows/wf1-recoleccion.json
```

More details in [`docs/INFRA.md`](docs/INFRA.md). Some code comments and docs are in Spanish.

Every workflow is self-documented in the n8n canvas: a header note, one colored note per stage and a short note under each node.

## Structure

```
infra/          docker-compose, SQL schema and migrations
n8n/workflows/  generated workflow JSON (WF1 collect, WF2 filter & notify)
n8n/sql/        upsert and classification queries
scripts/        normalizers + tests, workflow builders, n8n API client
```

## Author

**Jhon Alexander González** — n8n & AI automation developer, Colombia (UTC-5).
[LinkedIn](https://www.linkedin.com/in/jhon-alexander-gonz%C3%A1lez-ram%C3%ADrez-a28803232/)

License: MIT
