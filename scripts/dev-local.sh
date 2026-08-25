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

if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi

ensure_local_database() {
  local database_url="${DATABASE_URL:-postgresql://postgres:305144@127.0.0.1:${PG_LOCAL_PORT:-5432}/morada}"
  local database_port=""
  local running_project_port=""

  if [[ "${database_url}" =~ @(127\.0\.0\.1|localhost):([0-9]+)/morada ]]; then
    database_port="${BASH_REMATCH[2]}"
    running_project_port="$(sed -n '4p' data/postgres/postmaster.pid 2>/dev/null || true)"

    if [ "${database_port}" = "5432" ] && [ -n "${running_project_port}" ] && [ "${running_project_port}" != "5432" ]; then
      database_port="${running_project_port}"
      database_url="${database_url/:5432\//:${database_port}/}"
    elif [ "${database_port}" = "5432" ] && ss -ltn "sport = :5432" | tail -n +2 | grep -q .; then
      database_port="5433"
      database_url="${database_url/:5432\//:5433/}"
    fi

    if ! PG_LOCAL_PORT="${database_port}" bash scripts/postgres-local.sh start; then
      if [ "${database_port}" != "5432" ]; then
        return 1
      fi

      echo "Porta 5432 indisponível para o PostgreSQL local; tentando 5433."
      database_port="5433"
      PG_LOCAL_PORT="${database_port}" bash scripts/postgres-local.sh start
      database_url="${database_url/:5432\//:5433/}"
    fi

    export DATABASE_URL="${database_url}"
  fi
}

ensure_local_database

./node_modules/.bin/next dev "$@" &
next_pid=$!

# Chrome sem interface é o modo confiável quando o dev é iniciado pelo IDE.
# Use COLLECTOR_DEV_HEADLESS=false para observar o navegador localmente.
export COLLECTOR_STALE_AFTER_SECONDS="${COLLECTOR_DEV_STALE_AFTER_SECONDS:-20}"
export COLLECTOR_RETRY_BASE_SECONDS="${COLLECTOR_DEV_RETRY_BASE_SECONDS:-2}"
COLLECTOR_HEADLESS="${COLLECTOR_DEV_HEADLESS:-true}" \
  .venv/bin/python scripts/collector-python/worker.py &
worker_pid=$!

wait -n "${next_pid}" "${worker_pid}"
