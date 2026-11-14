#!/usr/bin/env bash
# Cliente mínimo de la API pública de n8n. Salida compacta para ahorrar tokens.
# Requiere N8N_API_KEY en infra/.env.  Uso: scripts/n8n.sh <comando> [args]
#
#   ls                         lista workflows (id, activo, nombre)
#   get <id>                   descarga un workflow (JSON completo a stdout)
#   pull [<id>|--all]          exporta a n8n/workflows/<nombre>.json (sin campos volátiles)
#   push <archivo.json>        crea o actualiza (PUT si el id existe, si no POST)
#   rm <id>                    borra un workflow
#   on <id> | off <id>         activa / desactiva
#   runs [<wfId>] [n]          últimas ejecuciones (id, estado, inicio, workflow)
#   run <execId>               detalle de una ejecución: estado y error por nodo
#   creds                      lista credenciales (id, tipo, nombre)
#   raw <MÉTODO> <ruta> [json] llamada libre, p. ej.: raw GET /tags
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/infra/.env"
N8N_API_KEY="$(grep -E '^N8N_API_KEY=' "$ENV_FILE" | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true)"
N8N_PORT="$(grep -E '^N8N_PORT=' "$ENV_FILE" | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true)"
BASE="${N8N_URL:-http://127.0.0.1:${N8N_PORT:-5678}}/api/v1"
[ -n "$N8N_API_KEY" ] || { echo "Falta N8N_API_KEY en infra/.env" >&2; exit 1; }

api() { # api MÉTODO RUTA [cuerpo]
  local args=(-sS -X "$1" "$BASE$2" -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Accept: application/json' -w '\n%{http_code}')
  [ $# -ge 3 ] && args+=(-H 'Content-Type: application/json' --data-binary "$3")
  local out code
  out="$(curl "${args[@]}")"; code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [ "$code" -ge 400 ]; then echo "HTTP $code $1 $2: $(echo "$out" | jq -c '.message // .' 2>/dev/null || echo "$out")" >&2; return 1; fi
  printf '%s' "$out"
}

# Solo los campos que acepta PUT/POST
clean_wf='{name, nodes, connections, settings: ((.settings // {}) | with_entries(select(.key | IN("executionOrder","timezone","saveDataErrorExecution","saveDataSuccessExecution","saveManualExecutions","saveExecutionProgress","executionTimeout","errorWorkflow","callerPolicy"))))}'

slug() { echo "$1" | iconv -f utf8 -t ascii//TRANSLIT 2>/dev/null | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g'; }

cmd="${1:-help}"; shift || true
case "$cmd" in
  ls)    api GET '/workflows?limit=250' | jq -r '.data[] | [.id, (if .active then "ON " else "off" end), .name] | @tsv' ;;
  get)   api GET "/workflows/$1" ;;
  pull)
    ids="${1:---all}"
    [ "$ids" = "--all" ] && ids="$(api GET '/workflows?limit=250' | jq -r '.data[].id')"
    for id in $ids; do
      wf="$(api GET "/workflows/$id")"
      f="$(grep -l "\"id\": \"$id\"" "$ROOT"/n8n/workflows/*.json 2>/dev/null | head -1 || true)"
      [ -n "$f" ] || f="$ROOT/n8n/workflows/$(slug "$(echo "$wf" | jq -r .name)").json"
      echo "$wf" | jq -S --arg id "$id" '{id: $id, name, nodes, connections, settings, pinData: (.pinData // {}), active}' > "$f"
      echo "↓ $id → ${f#$ROOT/}"
    done ;;
  push)
    f="$1"; id="$(jq -r '.id // empty' "$f")"; body="$(jq -c "$clean_wf" "$f")"
    if [ -n "$id" ] && api GET "/workflows/$id" >/dev/null 2>&1; then
      api PUT "/workflows/$id" "$body" | jq -r '"↑ actualizado \(.id) \(.name)"'
    else
      api POST /workflows "$body" | jq -r '"↑ creado \(.id) \(.name)  (nuevo id: actualiza el archivo con scripts/n8n.sh pull \(.id))"'
    fi ;;
  rm)    api DELETE "/workflows/$1" | jq -r '"✗ borrado \(.id) \(.name)"' ;;
  on)    api POST "/workflows/$1/activate" | jq -r '"● activo \(.id) \(.name)"' ;;
  off)   api POST "/workflows/$1/deactivate" | jq -r '"○ inactivo \(.id) \(.name)"' ;;
  runs)
    q="/executions?limit=${2:-10}"; [ -n "${1:-}" ] && q="$q&workflowId=$1"
    api GET "$q" | jq -r '.data[] | [.id, .status, .startedAt[0:19], .workflowId] | @tsv' ;;
  run)
    api GET "/executions/$1?includeData=true" | jq -r '
      "estado: \(.status)  inicio: \(.startedAt[0:19])  fin: \((.stoppedAt // "")[0:19])",
      (.data.resultData.runData // {} | to_entries[] |
        "  \(.key): \(.value[-1].executionStatus // "?")  items=\([.value[-1].data.main[]? | length] | add // 0)" +
        (if .value[-1].error then "  ERROR: \(.value[-1].error.message)" else "" end))' ;;
  creds) api GET '/credentials?limit=250' | jq -r '.data[] | [.id, .type, .name] | @tsv' ;;
  raw)   if [ -n "${3:-}" ]; then api "$1" "$2" "$3"; else api "$1" "$2"; fi ;;
  *)     sed -n '2,16p' "$0" ;;
esac
