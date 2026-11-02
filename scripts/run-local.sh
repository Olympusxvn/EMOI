#!/usr/bin/env bash
# EMOI local run (Phase 3, T3.7): agent service + frontend together.
# Agent service on http://localhost:3001, frontend on http://localhost:5173.
# Stop with Ctrl-C; both child processes are killed on exit.
set -e
cd "$(dirname "$0")/.."
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

# NOTE: subshells keep the main shell at repo root. "cd x && cmd &" would run
# the cd in a background subshell, so a following "cd .." climbs above root.
echo "Starting agent service (port 3001)..."
(cd agent && npm run server) &

echo "Starting frontend (port 5173)..."
(cd frontend && npm run dev -- --port 5173) &

wait
