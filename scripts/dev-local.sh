#!/usr/bin/env bash
set -euo pipefail

# A pesquisa sob demanda usa dois processos. Iniciá-los juntos evita que o
# frontend fique aguardando indefinidamente por jobs PENDING no desenvolvimento.
PROJECT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIRECTORY}"

next_pid=""
worker_pid=""

cleanup() {
  trap - EXIT INT TERM
  [ -z "${worker_pid}" ] || kill "${worker_pid}" 2>/dev/null || true
  [ -z "${next_pid}" ] || kill "${next_pid}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

./node_modules/.bin/next dev "$@" &
next_pid=$!

if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi

# Chrome sem interface é o modo confiável quando o dev é iniciado pelo IDE.
# Use COLLECTOR_DEV_HEADLESS=false para observar o navegador localmente.
COLLECTOR_HEADLESS="${COLLECTOR_DEV_HEADLESS:-true}" \
  .venv/bin/python scripts/collector-python/worker.py &
worker_pid=$!

wait -n "${next_pid}" "${worker_pid}"
