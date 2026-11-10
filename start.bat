@echo off
echo Building LAN Host Manager (Rust)...
echo.

echo [1/3] Building backend...
cargo build --release
if %errorlevel% neq 0 (
    echo Backend build failed!
    exit /b 1
)

echo.
echo [2/3] Building frontend (WASM)...
cd frontend
call trunk build --release
if %errorlevel% neq 0 (
    echo Frontend build failed!
    cd ..
    exit /b 1
)
cd ..

echo.
echo [3/3] Starting server...
target\release\lan-host-manager.exe
