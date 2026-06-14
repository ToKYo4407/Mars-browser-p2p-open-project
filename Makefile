.PHONY: install dev build test test-signaling test-e2e

install:
	npm --prefix server install
	npm --prefix client install
	npm --prefix tests install
	npx --prefix tests playwright install --with-deps chromium

dev:
	@trap 'kill 0' INT; \
	node server/index.js & \
	npm --prefix client run dev & \
	wait

build:
	npm --prefix client run build

# Unit tests
test-signaling:
	node --test tests/signaling.test.js

# Run browser-to-browser Playwright tests (requires a prior `make build`)
test-e2e: build
	npx --prefix tests playwright test

# Run all tests
test: build test-signaling test-e2e

