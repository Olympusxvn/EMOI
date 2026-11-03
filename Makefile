# EMOI verification gates. Tier 1 (check) is offline: no .env needed.
# Tier 2 (check-online) needs testnet + a filled .env. English only.

.PHONY: setup dev check check-agent check-frontend check-contract index check-online

setup:            ## Install deps + create .env from .env.example
	./scripts/setup.sh

dev:              ## Run agent service + frontend locally
	./scripts/run-local.sh

check-agent:      ## Agent unit tests (offline) + repo preflight
	cd agent && npm test
	cd agent && npm run preflight

check-frontend:   ## Frontend typecheck + build + lint
	cd frontend && npm run build
	cd frontend && npm run lint

check-contract:   ## Contract unit tests + formatting
	cd contract && cargo test
	cd contract && cargo fmt --check

check: check-agent check-frontend check-contract  ## Tier 1 offline gate (CI runs this)

index:            ## Regenerate INDEX.md
	node scripts/generate-index.mjs

check-online:     ## Tier 2 testnet gate (needs filled .env)
	cd agent && npm run demo:valid -- --json
	cd agent && npm run demo:attack -- --json
	cd agent && npm run conformance
