#!/usr/bin/env bash
# Apply every migration to a throwaway database, then run the SQL test suite.
# Verifies the schema, the CHECK constraints and the RLS policies for real
# rather than by inspection.
set -euo pipefail

DB="phaestos_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(su postgres -c)

run() { ${PSQL[@]} "psql -v ON_ERROR_STOP=1 -q -d $1 -f $2"; }

bash "${ROOT}/scripts/db-local.sh" start >/dev/null

cleanup() { ${PSQL[@]} "dropdb --if-exists ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

${PSQL[@]} "dropdb --if-exists ${DB}" >/dev/null 2>&1 || true
${PSQL[@]} "createdb ${DB}"

# The test SQL lives outside the migration folder so it is never deployed.
chmod -R a+rX "${ROOT}/supabase" 2>/dev/null || true

echo "→ bootstrap (local stand-in for auth schema and roles)"
run "${DB}" "${ROOT}/supabase/test/00_bootstrap.sql"

echo "→ migrations"
for f in "${ROOT}"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  run "${DB}" "$f"
done

echo "→ grants and helpers"
run "${DB}" "${ROOT}/supabase/test/01_grants.sql"
run "${DB}" "${ROOT}/supabase/test/01_helpers.sql"

for f in "${ROOT}"/supabase/test/0[2-9]_*.sql; do
  echo "→ $(basename "$f")"
  run "${DB}" "$f"
done

echo
echo "schema, constraints and RLS all pass"
