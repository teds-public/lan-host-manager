#!/bin/bash
set -e

echo "Building LAN Host Manager (Rust)..."
echo ""

echo "[1/3] Building backend..."
cargo build --release

echo ""
echo "[2/3] Building frontend (WASM)..."
cd frontend
trunk build --release
cd ..

echo ""
echo "[3/3] Starting server..."
./target/release/lan-host-manager
