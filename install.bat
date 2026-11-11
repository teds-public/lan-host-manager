@echo off
:: Install every dependency needed to build and run LAN Host Manager on Windows.
setlocal
cd /d "%~dp0"
set "code=0"

echo ============================================
echo  LAN Host Manager - dependency installer
echo ============================================
echo.

echo [1/6] Checking Rust toolchain...
where cargo >nul 2>nul
if errorlevel 1 goto :no_cargo
rustc --version
echo   Rust is installed.
echo.
goto :check_msvc

:no_cargo
echo   ERROR: cargo not found.
echo   Install Rust from https://rustup.rs or run: winget install Rustlang.Rustup
echo   Then close this window, open a new one, and run install.bat again.
set "code=1"
goto :pause

:check_msvc
echo [2/6] Checking MSVC C++ build tools...
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :no_msvc
set "VSFOUND="
for /f "delims=" %%A in ('"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul') do set "VSFOUND=1"
if not defined VSFOUND goto :no_msvc
echo   MSVC build tools found.
echo.
goto :wasm_target

:no_msvc
echo   WARNING: MSVC C++ build tools not detected.
echo   cargo build will fail without them. Install Visual Studio Build Tools:
echo   https://visualstudio.microsoft.com/downloads/ (select "Desktop development with C++")
echo   Continuing with the remaining steps.
echo.

:wasm_target
echo [3/6] Checking wasm32-unknown-unknown target...
where rustup >nul 2>nul
if errorlevel 1 goto :no_rustup
rustup target list --installed | findstr /x /c:"wasm32-unknown-unknown" >nul
if not errorlevel 1 goto :wasm_ready
echo   Adding wasm32-unknown-unknown...
rustup target add wasm32-unknown-unknown
if errorlevel 1 goto :wasm_failed
echo   wasm32-unknown-unknown installed.
echo.
goto :trunk

:wasm_ready
echo   wasm32-unknown-unknown already installed.
echo.
goto :trunk

:no_rustup
echo   WARNING: rustup not found, so the wasm32-unknown-unknown target cannot be added.
echo   Install Rust through rustup (https://rustup.rs) to build the frontend.
echo.
goto :trunk

:wasm_failed
echo   ERROR: rustup target add wasm32-unknown-unknown failed.
set "code=1"
goto :pause

:trunk
echo [4/6] Checking Trunk (WASM bundler)...
where trunk >nul 2>nul
if not errorlevel 1 goto :trunk_ready
echo   Installing Trunk. This compiles from source and can take several minutes...
cargo install --locked trunk
if errorlevel 1 goto :trunk_failed
echo   Trunk installed.
echo.
goto :cargo_deps

:trunk_ready
echo   Trunk already installed.
echo.
goto :cargo_deps

:trunk_failed
echo   ERROR: cargo install --locked trunk failed.
echo   See docs\INSTALL.md (Troubleshooting) for alternatives.
set "code=1"
goto :pause

:cargo_deps
echo [5/6] Downloading Rust crate dependencies...
cargo fetch
if errorlevel 1 goto :fetch_failed
echo   Crate dependencies downloaded.
echo.
goto :rar

:fetch_failed
echo   ERROR: cargo fetch failed. Check your network connection.
set "code=1"
goto :pause

:rar
echo [6/6] Checking RAR extractor...
where unrar >nul 2>nul
if not errorlevel 1 goto :rar_ready
where rar >nul 2>nul
if not errorlevel 1 goto :rar_ready
if exist "%ProgramFiles%\WinRAR\UnRAR.exe" goto :rar_ready
if exist "%ProgramFiles%\WinRAR\WinRAR.exe" goto :rar_ready
echo   WARNING: no RAR extractor found. Install WinRAR, or set RAR_BINARY in .env.
echo   Only .rar uploads need it; .zip uploads work without it.
echo.
goto :env_file

:rar_ready
echo   RAR extractor found.
echo.

:env_file
if exist ".env" goto :env_ready
copy ".env.example" ".env" >nul
echo Created .env from .env.example. Adjust it if needed.
echo.
goto :done

:env_ready
echo   .env already exists, leaving it unchanged.
echo.

:done
echo ============================================
echo  All dependencies are ready.
echo  Run start.bat to build and launch.
echo ============================================
goto :pause

:pause
echo "%cmdcmdline%" | findstr /i /c:"/c" >nul
if errorlevel 1 exit /b %code%
if defined MSYSTEM exit /b %code%
pause
exit /b %code%
