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
psql -q -f "$here/../migrations/0001_init.sql"
psql -f "$here/01_rules_test.sql"
