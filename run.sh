#!/usr/bin/env bash
# Start OneAbility AI (macOS/Linux).  ./run.sh  -> http://localhost:8000     ./run.sh node -> also Node server on :3000
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"; backend="$root/backend"
if [ ! -d "$backend/.venv" ]; then
  python3 -m venv "$backend/.venv"
  "$backend/.venv/bin/pip" install --quiet --upgrade pip
  "$backend/.venv/bin/pip" install --quiet -r "$backend/requirements.txt"
fi
[ -f "$backend/.env" ] || { cp "$backend/.env.example" "$backend/.env"; echo "Created backend/.env (add GEMINI_API_KEY to enable Gemini, optional)."; }
if [ "${1:-}" = "node" ]; then export SERVE_FRONTEND=0; (cd "$root" && node server.js &) ; echo "Open http://localhost:3000"; else echo "Open http://localhost:8000"; fi
cd "$backend" && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
