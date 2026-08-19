#!/usr/bin/env bash
set -euo pipefail

USER_DIRECTORY="$(getent passwd "$(id -un)" | cut -d: -f6)"
POSTGRES_ROOT="${PG_LOCAL_ROOT:-${USER_DIRECTORY}/.local/postgresql-16}"
POSTGRES_BIN="${POSTGRES_ROOT}/usr/lib/postgresql/16/bin"
POSTGRES_SHARE="${POSTGRES_ROOT}/usr/share/postgresql/16"
PROJECT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIRECTORY="${PROJECT_DIRECTORY}/data/postgres"
LOG_FILE="${PROJECT_DIRECTORY}/data/postgres.log"
PORT="${PG_LOCAL_PORT:-5432}"

export LD_LIBRARY_PATH="${POSTGRES_ROOT}/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

if [ ! -x "${POSTGRES_BIN}/postgres" ]; then
  echo "PostgreSQL local não encontrado em ${POSTGRES_ROOT}."
  exit 1
fi

start() {
  if [ ! -f "${DATA_DIRECTORY}/PG_VERSION" ]; then
    mkdir -p "${DATA_DIRECTORY}"
    "${POSTGRES_BIN}/initdb" \
      --pgdata="${DATA_DIRECTORY}" \
      --username=postgres \
      --auth=trust \
      --encoding=UTF8 \
      --locale=C.UTF-8 \
      -L "${POSTGRES_SHARE}"
  fi

  if ! "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIRECTORY}" status >/dev/null 2>&1; then
    "${POSTGRES_BIN}/pg_ctl" \
      --pgdata="${DATA_DIRECTORY}" \
      --log="${LOG_FILE}" \
      --options="-h 127.0.0.1 -p ${PORT} -k /tmp" \
      start
  fi

  if ! "${POSTGRES_BIN}/psql" --host=127.0.0.1 --port="${PORT}" --username=postgres \
    --dbname=postgres --tuples-only --command="SELECT 1 FROM pg_database WHERE datname='morada'" \
    | grep -q 1; then
    "${POSTGRES_BIN}/createdb" --host=127.0.0.1 --port="${PORT}" --username=postgres morada
  fi
  echo "PostgreSQL disponível em 127.0.0.1:${PORT}/morada"
}

stop() {
  if "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIRECTORY}" status >/dev/null 2>&1; then
    "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIRECTORY}" stop --mode=fast
  else
    echo "PostgreSQL já está parado."
  fi
}

status() {
  "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIRECTORY}" status
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "Uso: $0 {start|stop|status}"; exit 2 ;;
esac
