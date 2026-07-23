#!/usr/bin/env bash
# Optional ops backup sample (DOC/03 §8.7). Does NOT replace product cold backup (§8.8).
# Stop the application before running.
#
# Usage:
#   ./scripts/ops/backup.example.sh [output-dir]
#
# Data root: DATA_DIR | AROUSAL_DATA_DIR | config.yaml dataDir | ./data
# Archive excludes the dataDir/backups/ subdirectory.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Stop the app before backup. This is an optional ops sample — see DOC/03 §8.7 / data/README.md."
exec node "$SCRIPT_DIR/backup-data.mjs" "$@"
