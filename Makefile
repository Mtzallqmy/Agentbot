SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help setup dev up down logs migrate seed-admin test lint typecheck check build webhook webhook-delete

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\\n\\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-18s %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Create a local environment file
	@test ! -e .env && cp .env.example .env || { echo ".env already exists"; exit 1; }
	@echo "Edit .env and replace every CHANGE_ME value."

dev: ## Start the complete local stack
	./scripts/dev.sh

up: ## Start containers in the background
	docker compose up --build --detach

down: ## Stop the local stack
	docker compose down

logs: ## Follow service logs
	docker compose logs --follow

migrate: ## Apply database migrations
	docker compose run --rm migrate

seed-admin: ## Initialize the configured owner account
	./scripts/seed-admin.sh

test: ## Run backend and frontend tests
	python -m pytest -c apps/api/pyproject.toml apps/api/tests apps/bot/tests apps/worker/tests
	npm test

lint: ## Run backend and frontend linters
	ruff check --config apps/api/pyproject.toml apps
	npm run lint

typecheck: ## Run static type checks
	mypy --config-file apps/api/pyproject.toml apps/api/src apps/worker/src packages/python
	npx tsc --noEmit

check: lint typecheck test ## Run all local quality checks

build: ## Build production images
	docker compose build

webhook: ## Configure the Telegram production webhook
	./scripts/setup-webhook.sh

webhook-delete: ## Delete the Telegram webhook
	./scripts/delete-webhook.sh
