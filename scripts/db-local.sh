#!/usr/bin/env bash
# Start or stop a throwaway local Postgres for schema tests.
# Not needed in normal development — the app talks to Supabase. This exists so
# `npm run db:test` can apply the real migration to a real Postgres.
set -euo pipefail

PGVER="${PGVER:-$(ls /usr/lib/postgresql/ 2>/dev/null | sort -n | tail -1)}"
BIN="/usr/lib/postgresql/${PGVER}/bin"

case "${1:-start}" in
  start)
    if pg_isready -q 2>/dev/null; then echo "postgres already running"; exit 0; fi
    if [ -d "/etc/postgresql/${PGVER}/main" ]; then
      pg_ctlcluster "${PGVER}" main start
    else
      install -d -o postgres -g postgres /var/lib/pgdata
      su postgres -c "${BIN}/initdb -D /var/lib/pgdata -U postgres" >/dev/null
      su postgres -c "${BIN}/pg_ctl -D /var/lib/pgdata -l /tmp/pg.log -o '-k /var/run/postgresql' start" >/dev/null
    fi
    for _ in $(seq 20); do pg_isready -q && break; sleep 0.5; done
    pg_isready
    ;;
  stop)
    if [ -d "/etc/postgresql/${PGVER}/main" ]; then
      pg_ctlcluster "${PGVER}" main stop || true
    else
      su postgres -c "${BIN}/pg_ctl -D /var/lib/pgdata stop" || true
    fi
    ;;
  *) echo "usage: db-local.sh [start|stop]" >&2; exit 2 ;;
esac
