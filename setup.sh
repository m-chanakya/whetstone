#!/usr/bin/env bash
# One-time setup: clone Whetstone into ~/Work/whetstone and launch it.
#   curl -fsSL https://raw.githubusercontent.com/m-chanakya/whetstone/main/setup.sh | bash
set -euo pipefail
DEST="${1:-$HOME/Work/whetstone}"
mkdir -p "$(dirname "$DEST")"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone https://github.com/m-chanakya/whetstone.git "$DEST"; fi
chmod +x "$DEST/whetstone.sh"
mkdir -p "$DEST/data"
echo "Data lives in $DEST/data (questions/, inbox/, backup/). Reviews use Claude Code if installed and signed in."
exec "$DEST/whetstone.sh" start
