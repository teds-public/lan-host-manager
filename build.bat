@echo off
:: Build the release binary and package it with the frontend into dist\.
setlocal
cd /d "%~dp0"
set "code=0"

echo ============================================
echo  LAN Host Manager - release build
echo ============================================
echo.

echo [1/4] Checking tools...
where cargo >nul 2>nul
if errorlevel 1 goto :no_cargo
where trunk >nul 2>nul
if errorlevel 1 goto :no_trunk
echo   cargo and trunk found.
echo.

echo [2/4] Checking for a running server...
tasklist /FI "IMAGENAME eq lan-host-manager.exe" 2>nul | findstr /i "lan-host-manager.exe" >nul
if not errorlevel 1 goto :running
echo   Not running.
echo.

echo [3/4] Building backend (release)...
cargo build --release
if errorlevel 1 goto :backend_failed
echo   Backend built.
echo.

echo [4/4] Building frontend (release)...
pushd frontend
call trunk build --release
if errorlevel 1 goto :frontend_failed
popd
echo   Frontend built.
echo.

echo Packaging into dist\...
if exist dist rmdir /s /q dist
mkdir dist
copy /Y "target\release\lan-host-manager.exe" "dist\" >nul
if errorlevel 1 goto :package_failed
xcopy /E /I /Y /Q "frontend\dist" "dist" >nul
if errorlevel 1 goto :package_failed
if exist "dist\.trunk-lock" del /q "dist\.trunk-lock"
echo.
echo ============================================
echo  Done. Release folder: %CD%\dist
echo  Run: dist\lan-host-manager.exe
echo ============================================
goto :pause

:no_cargo
echo   ERROR: cargo not found. Install Rust from https://rustup.rs
set "code=1"
goto :pause

:no_trunk
echo   ERROR: trunk not found. Run install.bat or: cargo install --locked trunk
set "code=1"
goto :pause

:running
echo   ERROR: lan-host-manager.exe is running. Close the app first, then run build.bat again.
set "code=1"
goto :pause

:backend_failed
echo   ERROR: cargo build --release failed.
set "code=1"
goto :pause

:frontend_failed
popd
echo   ERROR: trunk build --release failed.
set "code=1"
goto :pause

:package_failed
echo   ERROR: copying files into dist failed.
set "code=1"
goto :pause

:pause
echo "%cmdcmdline%" | findstr /i /c:"/c" >nul
if errorlevel 1 exit /b %code%
if defined MSYSTEM exit /b %code%
pause
exit /b %code%
