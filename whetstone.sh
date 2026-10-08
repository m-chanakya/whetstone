#!/usr/bin/env bash
# Launch Whetstone: start the local server and open it in the browser.
#
#   ./whetstone.sh            start (or just focus the browser if it is already running)
#   ./whetstone.sh stop       stop the server
#   ./whetstone.sh update     git pull, then start
#   ./whetstone.sh logs       follow the server log
#   ./whetstone.sh add FILE…  import question/backup files (.md or .json) now
#   ./whetstone.sh backup     write a full export to ~/.whetstone/backup/ and print its path
#   ./whetstone.sh restore F  merge a backup or export file back in
#   ./whetstone.sh open       open the data folder in Finder/your file manager
#
# Data lives in ~/.whetstone: questions/ (one .md per question, edit freely),
# inbox/ (drop files to import), backup/latest.json (restored automatically if
# the database is ever empty), whetstone.db, config.json.
# Reviews use Claude Code if installed and signed in, else ANTHROPIC_API_KEY.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${WHETSTONE_DATA:-$HOME/.whetstone}"
PORT="${WHETSTONE_PORT:-8787}"
URL="http://localhost:$PORT"
PID="$DATA/server.pid"
LOG="$DATA/server.log"
mkdir -p "$DATA/seed" "$DATA/inbox" "$DATA/questions" "$DATA/backup"

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
  add|import)
    shift; [ $# -gt 0 ] || { echo "usage: whetstone.sh add FILE..."; exit 1; }
    for f in "$@"; do cp "$f" "$DATA/inbox/" && echo "queued $(basename "$f")"; done
    if running; then echo "The server imports inbox files within a few seconds."; else echo "Imported on next start."; fi ;;
  backup|export)
    if running; then curl -fs "$URL/api/export" > "$DATA/backup/export-$(date +%Y%m%d-%H%M%S).json" && ls -t "$DATA"/backup/export-*.json | head -1
    else echo "Start the server first, or copy $DATA/backup/latest.json"; exit 1; fi ;;
  restore)
    [ -n "${2:-}" ] || { echo "usage: whetstone.sh restore FILE.json"; exit 1; }
    cp "$2" "$DATA/inbox/" && echo "queued $(basename "$2"); the server merges it within a few seconds (start it if it is not running)." ;;
  open)
    if command -v open >/dev/null 2>&1; then open "$DATA"; else echo "$DATA"; fi ;;
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
    sed -n '2,14p' "$0"; exit 1 ;;
esac
