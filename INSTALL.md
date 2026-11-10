# Installation Guide for Rust LAN Host Manager

## Prerequisites

### Windows

1. **Install Rust**
   - Download and run: https://rustup.rs
   - Or use: `winget install Rustlang.Rustup`
   - Restart your terminal after installation

2. **Install Visual Studio Build Tools** (Required for compilation)
   - Download: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - Run the installer and select:
     - "Desktop development with C++"
     - Or minimal: "MSVC", "Windows SDK", "CMake tools"
   - Alternative: Install full Visual Studio Community with C++ workload

3. **Install Trunk** (for WASM frontend)
   ```powershell
   cargo install --locked trunk
   ```

4. **Add WASM target**
   ```powershell
   rustup target add wasm32-unknown-unknown
   ```

5. **Install WinRAR** (for RAR extraction)
   - Download: https://www.rarlab.com/download.htm
   - Or set `RAR_BINARY` environment variable to your `unrar.exe` path

### Linux (Ubuntu/Debian)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install system dependencies
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev unrar

# Install Trunk
cargo install --locked trunk

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### Linux (Fedora/RHEL)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install system dependencies
sudo dnf install -y gcc openssl-devel unrar

# Install Trunk
cargo install --locked trunk

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### macOS

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Xcode Command Line Tools (if not already installed)
xcode-select --install

# Install unrar via Homebrew
brew install unrar

# Install Trunk
cargo install --locked trunk

# Add WASM target
rustup target add wasm32-unknown-unknown
```

## Verify Installation

```bash
# Check Rust
rustc --version
cargo --version

# Check Trunk
trunk --version

# Check WASM target
rustup target list | grep wasm32-unknown-unknown
```

## Build the Project

```bash
# Clone or navigate to the repository
cd lan-host-manager

# Build backend
cargo build --release

# Build frontend
cd frontend
trunk build --release
cd ..

# Or use the launcher scripts:
# Windows: start.bat
# Linux/macOS: ./start.sh
```

## Troubleshooting

### Windows: "dlltool.exe not found"
- Install Visual Studio Build Tools with C++ support
- Restart your terminal after installation
- Verify: `where cl.exe` should show the compiler path

### Windows: "link.exe not found"
- Same as above - install VS Build Tools
- Alternative: Use `rustup default stable-msvc`

### Linux: "error: linker 'cc' not found"
```bash
sudo apt install build-essential  # Debian/Ubuntu
sudo dnf install gcc              # Fedora/RHEL
```

### Any OS: Trunk installation fails
```bash
# Try with locked dependencies
cargo install --locked trunk

# Or install from source
cargo install --git https://github.com/trunk-rs/trunk trunk
```

### WASM target missing
```bash
rustup target add wasm32-unknown-unknown
```

### RAR extraction fails
- Windows: Install WinRAR or set `RAR_BINARY` to your unrar.exe path
- Linux: `sudo apt install unrar` or `sudo dnf install unrar`
- macOS: `brew install unrar`

## Configuration

Create a `.env` file (optional):

```bash
DASHBOARD_PORT=5000
BIND_HOST=0.0.0.0
PORT_RANGE_START=4100
PORT_RANGE_END=4999
DATA_DIR=/path/to/data  # Optional
RAR_BINARY=/path/to/unrar  # Optional
RUST_LOG=info  # debug, info, warn, error
```

## Running

### Development
```bash
# Terminal 1: Backend
cargo run

# Terminal 2: Frontend dev server (with hot reload)
cd frontend
trunk serve --port 8080
```

### Production
```bash
# Windows
start.bat

# Linux/macOS
./start.sh

# Or manually
cargo build --release
cd frontend && trunk build --release && cd ..
./target/release/lan-host-manager
```

Access the dashboard at `http://localhost:5000` or `http://<your-lan-ip>:5000`
