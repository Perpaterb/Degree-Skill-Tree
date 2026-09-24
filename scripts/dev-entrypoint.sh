#!/bin/sh
# Dev container entrypoint. node_modules lives in a Docker volume, which survives image rebuilds,
# so after a dependency change it would keep the old packages. Reinstall whenever package-lock.json
# differs from the one the volume was installed from.
set -e
stamp=node_modules/.package-lock.stamp
if ! cmp -s package-lock.json "$stamp" 2>/dev/null; then
  echo "package-lock.json changed: installing dependencies"
  npm ci --no-audit --no-fund
  cp package-lock.json "$stamp"
fi
exec "$@"
