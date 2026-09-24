#!/usr/bin/env bash
# Smoke suite, pointable at any environment:
#   ./scripts/smoke.sh --target https://perpaterb.github.io/Degree-Skill-Tree/
# Checks the static files are served, then walks the E2E stories against the target.
set -euo pipefail
cd "$(dirname "$0")/.."

target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    *) echo "usage: $0 --target <url>"; exit 2 ;;
  esac
done
[ -n "$target" ] || { echo "usage: $0 --target <url>"; exit 2; }
target="${target%/}/"

fail() { echo "SMOKE FAIL: $*"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$target") ; [ "$code" = 200 ] || fail "page returned $code"
index=$(curl -sf "${target}trees/index.json") || fail "trees/index.json not served"
first=$(node -e 'const i=JSON.parse(process.argv[1]); if(!i.length) process.exit(1); console.log(i[0].id)' "$index") || fail "tree index is empty or not JSON"
curl -sf "${target}trees/${first}.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s);if(!Object.keys(t.subjects).length)process.exit(1)})' || fail "tree ${first} missing or empty"
echo "static files ok (${first})"

E2E_BASE_URL="$target" npx playwright test e2e/stories.spec.ts
