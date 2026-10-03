#!/usr/bin/env bash
# Tests the database on a throwaway local Postgres (needs PostgreSQL 15 or newer installed).
# It never touches a real Supabase project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
dir="$(mktemp -d)"
port="${PG_PORT:-54329}"
run() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$dir"; fi
cleanup() { run "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
run "$bin/initdb" -D "$dir/data" -U postgres -A trust >/dev/null
run "$bin/pg_ctl" -D "$dir/data" -o "-p $port -c listen_addresses='' -k $dir" -w start >/dev/null
psql() { command psql -X -v ON_ERROR_STOP=1 -h "$dir" -p "$port" -U postgres -d postgres "$@"; }
psql -q -f "$here/00_supabase_stub.sql"
for f in "$here"/../migrations/*.sql; do psql -q -f "$f"; done
psql -q -f "$here/../examples.sql"
# KEEP=1 leaves the database running for other tools (used by the live app check).
if [ "${ONLY_SETUP:-}" = "1" ]; then
  echo "Database ready at socket dir $dir port $port"
  trap - EXIT
  exit 0
fi
for t in "$here"/0[1-9]_*.sql "$here"/[1-9][0-9]_*.sql; do psql -f "$t"; done
