#!/usr/bin/env bash
# Launch Whetstone: start the local server and open it in the browser.
#
#   ./whetstone.sh            start (or just focus the browser if it is already running)
#   ./whetstone.sh stop       stop the server
#   ./whetstone.sh update     git pull, then start
#   ./whetstone.sh logs       follow the server log
#
# Data lives in ~/.whetstone (whetstone.db, config.json, seed/). Put your
# Anthropic key in ~/.whetstone/config.json as {"anthropicApiKey": "sk-ant-..."}
# or export ANTHROPIC_API_KEY before running this; without it reviews are off.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${WHETSTONE_DATA:-$HOME/.whetstone}"
PORT="${WHETSTONE_PORT:-8787}"
URL="http://localhost:$PORT/"
PID="$DATA/server.pid"
LOG="$DATA/server.log"
mkdir -p "$DATA/seed"

py() { command -v python3 >/dev/null 2>&1 && echo python3 || echo python; }

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

open_url() {
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  else echo "Open $URL in your browser."; fi
}

case "${1:-start}" in
  stop)
    if running; then kill "$(cat "$PID")" && rm -f "$PID" && echo "Whetstone stopped."; else echo "Whetstone is not running."; fi ;;
  logs)
    tail -f "$LOG" ;;
  update)
    git -C "$DIR" pull --ff-only && "$0" restart ;;
  restart)
    "$0" stop >/dev/null 2>&1 || true; "$0" start ;;
  start)
    if running; then echo "Whetstone is already running at $URL"; open_url; exit 0; fi
    cd "$DIR"
    nohup "$(py)" server.py --port "$PORT" --data "$DATA" >"$LOG" 2>&1 &
    echo $! >"$PID"
    for _ in $(seq 1 40); do
      if curl -fs "$URL/api/health" >/dev/null 2>&1; then
        echo "Whetstone is running at $URL  (data in $DATA)"
        grep -m1 '^reviews' "$LOG" || true
        open_url
        exit 0
      fi
      sleep 0.25
    done
    echo "The server did not come up. Last log lines:"; tail -20 "$LOG"; exit 1 ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
