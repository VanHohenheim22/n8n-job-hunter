#!/bin/sh
# Se ejecuta solo la primera vez que se crea el volumen de Postgres.
# Crea una base aparte para las ofertas (separada de la base interna de n8n).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE "$JOBS_DB" OWNER "$POSTGRES_USER";
EOSQL
