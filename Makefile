.PHONY: build run clean test dev frontend backend

# Build everything
build: backend frontend

# Build backend only
backend:
	cargo build --release

# Build frontend only
frontend:
	cd frontend && trunk build --release

# Run in development mode
dev:
	cargo run

# Run tests
test:
	cargo test --all

# Clean build artifacts
clean:
	cargo clean
	rm -rf frontend/dist

# Format code
fmt:
	cargo fmt --all

# Lint
lint:
	cargo clippy --all

# Install dependencies
install-deps:
	rustup target add wasm32-unknown-unknown
	cargo install trunk

# Run production build
run: build
	./target/release/lan-host-manager
