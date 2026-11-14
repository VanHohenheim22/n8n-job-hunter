# Infraestructura (n8n + Postgres)

```bash
cd infra
cp .env.example .env   # rellenar (o generar claves con openssl rand -hex 32)
docker compose up -d
```

- n8n: http://localhost:5678 (crear la cuenta de owner la primera vez)
- Postgres: localhost:5432 · bases `n8n` (interna) y `jobs` (ofertas)
- **No perder `N8N_ENCRYPTION_KEY`**: sin ella no se pueden descifrar las credenciales guardadas.

## Workflows versionados
```bash
# Exportar todo a n8n/workflows/ (fuente de verdad en git)
docker compose exec n8n n8n export:workflow --all --separate --pretty --output=/workflows/
# Importar
docker compose exec n8n n8n import:workflow --separate --input=/workflows/
```

## Útiles
- Logs: `docker compose logs -f n8n`
- Consola SQL: `docker compose exec postgres psql -U n8n -d jobs`
- Backup: `docker compose exec postgres pg_dumpall -U n8n > ../data/backup.sql`

## Base de ofertas (`jobs`)
- Esquema: `infra/sql/001_offers.sql` → `docker compose exec -T postgres psql -U n8n -d jobs < sql/001_offers.sql`
- Credencial en n8n: "Postgres jobs" (id `jhPgJobs00000001`), importada por CLI sin escribir la contraseña en disco.

## WF1 - Recolección
```bash
node scripts/build_wf1.js                            # desde la raíz del repo
node --test scripts/normalizers/                     # pruebas de los normalizadores
cd infra && docker compose exec -T n8n n8n import:workflow --input=/workflows/wf1-recoleccion.json
# Ejecutar por CLI (otro puerto de broker porque n8n ya está corriendo):
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=jhWf1Recoleccion
```
El aviso "Python 3 is missing" es inofensivo (solo usamos nodos Code en JavaScript).

## API de n8n (`scripts/n8n.sh`)
Requiere `N8N_API_KEY` en `infra/.env`. Salida compacta (ahorra tokens). Ayuda: `scripts/n8n.sh help`.
Flujo típico: editar/generar JSON → `scripts/n8n.sh push <archivo>` → ejecutar → `scripts/n8n.sh runs <wfId>` → `scripts/n8n.sh run <execId>`.
`pull` guarda con claves ordenadas (`jq -S`) para que los diffs en git sean limpios.

## WF2 - Filtro y avisos (id `taJY42QX0FhEhUse`)
```bash
node scripts/build_wf2.js && scripts/n8n.sh push n8n/workflows/wf2-filtro-avisos.json
# Reclasificar todo tras cambiar reglas (no reenvía lo ya avisado):
docker compose exec -T postgres psql -U n8n -d jobs -c "update offers set status='new' where status in ('candidate','filtered_out') and notified_at is null"
```
Credenciales: "Telegram Empliosbot" (`0oBvnvYgYSOOhmhG`), "Postgres jobs".

## Repo público (portafolio)
https://github.com/VanHohenheim22/n8n-job-hunter · copia local en `~/proyectos/n8n-job-hunter`.
Actualizar: commit aquí → `scripts/export_public.sh ~/proyectos/n8n-job-hunter` → commit y push allí
(autor: `116129051+VanHohenheim22@users.noreply.github.com`; token `GITHUB_API_KEY` en `infra/.env` vía
`git -c http.extraHeader="Authorization: Basic $(printf 'VanHohenheim22:%s' "$T" | base64 -w0)" push`).
El script exporta una lista blanca, reemplaza el chat_id y aborta si detecta datos personales o claves.
