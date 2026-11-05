#!/usr/bin/env bash
# EMOI local setup (Phase 3, T3.7).
# Checks Node >= 22 and Rust, installs frontend + agent dependencies,
# fetches contract dependencies, and copies .env.example to .env
# WITHOUT filling any secret. Fill .env yourself, never commit it.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

echo "Checking Node..."
node --version
echo "Checking Rust..."
cargo --version
echo "Checking near CLI (needed for create-agent / owner scripts)..."
if command -v near >/dev/null 2>&1; then
  near --version
else
  echo "WARNING: 'near' CLI not found. Owner scripts (create-agent, pause-demo) need it: https://github.com/near/near-cli-rs"
fi

echo "Installing agent dependencies..."
cd agent && npm ci && cd ..
echo "Installing frontend dependencies..."
cd frontend && npm ci && cd ..

echo "Fetching contract dependencies..."
cd contract && cargo fetch && cd ..

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example (secrets empty). Fill it in before running demos."
else
  echo ".env already exists; not overwriting it."
fi

echo ""
echo "Next steps:"
echo "  1. Fill .env (owner key for scripts, agent FCK for the agent service, optional NEAR AI Cloud key)."
echo "  2. Run: ./scripts/run-local.sh"
echo "     Or: cd agent && npm run server   (port 3001)"
echo "         cd frontend && npm run dev  (port 5173)"
echo "  3. Demo scripts: cd agent && npm run demo:valid -- --json && npm run demo:attack -- --json"
