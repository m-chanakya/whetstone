#!/usr/bin/env bash
# One-time setup: clone Whetstone into ~/Work/whetstone and launch it.
#   curl -fsSL https://raw.githubusercontent.com/m-chanakya/whetstone/main/setup.sh | bash
set -euo pipefail
DEST="${1:-$HOME/Work/whetstone}"
mkdir -p "$(dirname "$DEST")" "$HOME/.whetstone/seed"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone https://github.com/m-chanakya/whetstone.git "$DEST"; fi
chmod +x "$DEST/whetstone.sh"
if [ ! -f "$HOME/.whetstone/config.json" ]; then
  printf '{\n "anthropicApiKey": "",\n "model": "claude-sonnet-5-5"\n}\n' > "$HOME/.whetstone/config.json"
  echo "Created ~/.whetstone/config.json: add your Anthropic API key there to turn on reviews."
fi
echo "Seed files go in ~/.whetstone/seed/ (imported on the next start)."
exec "$DEST/whetstone.sh" start
