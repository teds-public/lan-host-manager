@echo off
:: Start LAN Host Manager dashboard (port 5000)
setlocal
cd /d "%~dp0"
set "code=0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install it from https://nodejs.org/ and run this again.
  set "code=1"
  goto :pause
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    set "code=1"
    goto :pause
  )
)

echo Building...
call npm run build
if errorlevel 1 (
  echo Build failed.
  set "code=1"
  goto :pause
)

echo Starting dashboard on port 5000...
call npm start
set "code=%errorlevel%"
if not "%code%"=="0" echo Server stopped with exit code %code%.

:pause
echo "%cmdcmdline%" | findstr /i /c:"/c" >nul
if errorlevel 1 exit /b %code%
if defined MSYSTEM exit /b %code%
pause
exit /b %code%
