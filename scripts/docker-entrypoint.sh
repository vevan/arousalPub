#!/bin/sh
set -e

PORT="${PORT:-6633}"

cat <<EOF

[arousalpub] Container starting…
[arousalpub] Open in browser:  http://127.0.0.1:${PORT}/
[arousalpub] Note: Docker uses serverPort (${PORT}), not dev webPort 6699.
[arousalpub] Check mapping:      docker compose ps

EOF

exec "$@"
