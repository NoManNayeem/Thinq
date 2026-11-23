# Thinq developer commands. Run `make help` for the list.

-include .env
export

THINQ_PORT ?= 3000
COMPOSE     = docker compose
COMPOSE_DEV = docker compose -f compose.yaml -f compose.dev.yaml

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------- run

.PHONY: env
env: ## Create .env from .env.example if it doesn't exist
	@test -f .env || (cp .env.example .env && echo "Created .env")

.PHONY: up
up: env ## Build and start the production-like stack, then wait until healthy
	$(COMPOSE) up -d --build --wait
	@echo "Thinq is running at http://localhost:$(THINQ_PORT)"

.PHONY: dev
dev: env ## Start with hot reload (source bind-mounted; API on :8000, DB on :55432)
	$(COMPOSE_DEV) up --build

.PHONY: down
down: ## Stop the stack (data is kept)
	$(COMPOSE) down

.PHONY: logs
logs: ## Follow logs from all services
	$(COMPOSE) logs -f --tail=100

.PHONY: db
db: env ## Start only PostgreSQL, published on localhost:55432 (for local tests)
	$(COMPOSE_DEV) up -d --wait --no-deps db

.PHONY: reset-db
reset-db: ## DANGER: stop everything and delete the database volume
	$(COMPOSE) down --volumes

# ---------------------------------------------------------------- quality

.PHONY: lint
lint: ## Lint and type-check backend and frontend
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	cd frontend && pnpm lint && pnpm typecheck

.PHONY: format
format: ## Auto-format backend and frontend
	cd backend && uv run ruff format . && uv run ruff check --fix .
	cd frontend && pnpm lint:fix

.PHONY: api-types
api-types: ## Regenerate the frontend's API types from the backend's OpenAPI schema
	cd backend && uv run python -m app.openapi > ../frontend/lib/api/openapi.json
	cd frontend && pnpm api:types

# ---------------------------------------------------------------- tests

.PHONY: test
test: test-backend test-frontend ## Run backend and frontend unit/integration tests

.PHONY: test-backend
test-backend: db ## Backend tests against a real PostgreSQL
	cd backend && uv run pytest

.PHONY: test-frontend
test-frontend: ## Frontend unit tests
	cd frontend && pnpm test

.PHONY: test-e2e
test-e2e: up ## End-to-end tests in real browsers against the running stack
	cd frontend && E2E_BASE_URL=http://localhost:$(THINQ_PORT) pnpm test:e2e

.PHONY: check
check: lint test test-e2e ## Everything CI runs
