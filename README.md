# LAN Host Manager

LAN-only local web hosting platform. Upload `.rar` archives of web projects from any device on your Wi-Fi, extract, assign ports, host, and manage them.

Built with Rust (Axum) and Yew (WASM).

Full setup instructions: [docs/INSTALL.md](docs/INSTALL.md).

## Requirements

1. **Rust** (stable) - Install from [rustup.rs](https://rustup.rs)
2. **Trunk** (for WASM frontend) - Install with `cargo install trunk`
3. **WinRAR** (Windows) or `unrar` (Linux) - For RAR extraction
   - Windows: [Download WinRAR](https://www.rarlab.com/)
   - Linux: `sudo apt install unrar` or `sudo dnf install unrar`
4. **wasm32-unknown-unknown** target - Install with `rustup target add wasm32-unknown-unknown`

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and adjust settings if needed
3. Install dependencies:
   ```bash
   rustup target add wasm32-unknown-unknown
   cargo install trunk
   ```

On Windows, `install.bat` does all of this for you: it checks Rust and the MSVC
build tools, adds the WASM target, installs Trunk, fetches crates, and creates
`.env` from `.env.example`.

## Build & Run

### Development
```bash
# Terminal 1: Backend
cargo run

# Terminal 2: Frontend
cd frontend
trunk serve --port 8080
```

### Production
```bash
# Build everything
cargo build --release
cd frontend && trunk build --release && cd ..

# Or use the launcher script:
# Windows:
start.bat

# Linux/macOS:
./start.sh
```

The dashboard will be available at `http://<host-lan-ip>:5000` from any LAN device.

## Firewall (Windows)

Allow inbound TCP on the dashboard port (default 5000) and the project range (4100–4999) for **private** networks only:

```powershell
New-NetFirewallRule -DisplayName "LAN Host Manager" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000,4100-4999 -Profile Private
```

Never open these ports on public networks, and never configure router port forwarding — this app is LAN-only by design.

## Architecture

### Rust Backend (Axum)
- `src/main.rs` - Entry point & Axum server
- `src/api.rs` - REST API endpoints
- `src/models.rs` - Data types
- `crates/*` - Modular functionality
  - `config` - Environment configuration
  - `database` - SQLx + SQLite
  - `archive` - ZIP/RAR extraction with security
  - `detector` - Project type detection
  - `hosting` - Static file server + Node.js spawner
  - `ports` - Port availability checking
  - `process-manager` - Child process management

### Frontend (Yew WASM)
- `frontend/src/main.rs` - Yew app entry
- `frontend/src/components/` - UI components
- `frontend/src/api.rs` - HTTP client
- `frontend/src/types.rs` - Shared types

### Data Directory
App data (DB, projects, logs) lives outside the repo:
- Windows: `%LOCALAPPDATA%\LanHostManager`
- Linux: `~/.local/share/lanhostmanager`

Override with `DATA_DIR` environment variable.

## Environment Variables

```bash
DASHBOARD_PORT=5000           # Dashboard HTTP port
BIND_HOST=0.0.0.0             # Bind address (0.0.0.0 for LAN access)
PORT_RANGE_START=4100         # Project port range start
PORT_RANGE_END=4999           # Project port range end
DATA_DIR=/path/to/data        # Optional: Override data directory
RAR_BINARY=/path/to/unrar     # Optional: Path to RAR extractor
RUST_LOG=info                 # Log level (debug, info, warn, error)
```

## Development Commands

```bash
# Check compilation
cargo check

# Run tests
cargo test

# Format code
cargo fmt

# Lint
cargo clippy

# Build frontend only
cd frontend && trunk build --release

# Clean build artifacts
cargo clean
```

## Security Notes

- Uploaded archives and project code are untrusted. Extraction blocks path traversal, absolute paths, and symlinks, with entry-count, size, and timeout limits.
- Project commands run only after your explicit approval; dependencies are never installed automatically.
- Running untrusted code on your host can compromise the machine — host only code you trust.
