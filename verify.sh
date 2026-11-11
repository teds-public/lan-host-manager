#!/bin/bash
# Quick verification script

echo "LAN Host Manager - Verification"
echo ""

# Check Rust installation
echo "1. Checking Rust installation..."
if command -v rustc &> /dev/null; then
    echo "   ✅ Rust: $(rustc --version)"
else
    echo "   ❌ Rust not found. Install from https://rustup.rs"
    exit 1
fi

if command -v cargo &> /dev/null; then
    echo "   ✅ Cargo: $(cargo --version)"
else
    echo "   ❌ Cargo not found"
    exit 1
fi

# Check WASM target
echo ""
echo "2. Checking WASM target..."
if rustup target list | grep -q "wasm32-unknown-unknown (installed)"; then
    echo "   ✅ WASM target installed"
else
    echo "   ⚠️  WASM target not installed. Run: rustup target add wasm32-unknown-unknown"
fi

# Check Trunk
echo ""
echo "3. Checking Trunk..."
if command -v trunk &> /dev/null; then
    echo "   ✅ Trunk: $(trunk --version)"
else
    echo "   ⚠️  Trunk not found. Install: cargo install trunk"
fi

# Check project structure
echo ""
echo "4. Checking project structure..."
if [ -f "Cargo.toml" ]; then
    echo "   ✅ Cargo.toml found"
else
    echo "   ❌ Cargo.toml not found"
fi

if [ -d "src" ]; then
    echo "   ✅ src/ directory found"
else
    echo "   ❌ src/ directory not found"
fi

if [ -d "crates" ]; then
    echo "   ✅ crates/ directory found"
else
    echo "   ❌ crates/ directory not found"
fi

if [ -d "frontend" ]; then
    echo "   ✅ frontend/ directory found"
else
    echo "   ❌ frontend/ directory not found"
fi

if [ -d "migrations" ]; then
    echo "   ✅ migrations/ directory found"
else
    echo "   ❌ migrations/ directory not found"
fi

# Try to check compilation
echo ""
echo "5. Quick compilation check..."
if cargo check --quiet 2>&1 | grep -q "error"; then
    echo "   ⚠️  Compilation has errors (see docs/INSTALL.md for troubleshooting)"
else
    echo "   ✅ Basic compilation check passed"
fi

echo ""
echo "✨ Verification complete!"
echo ""
echo "Next steps:"
echo "  1. Read docs/INSTALL.md for platform-specific setup"
echo "  2. Run 'cargo build' to compile backend"
echo "  3. Run 'cd frontend && trunk build' to compile frontend"
echo "  4. Run './start.sh' (Linux/Mac) or 'start.bat' (Windows) to launch"
