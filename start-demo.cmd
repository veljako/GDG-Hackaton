@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { $geventsResponse=Invoke-WebRequest -Uri 'http://localhost:5180' -UseBasicParsing -TimeoutSec 2; if($geventsResponse.Content -match 'GEvents'){exit 0}; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  start "" "http://localhost:5180"
  exit /b 0
)
if not exist node_modules (
  call npm.cmd install
  if errorlevel 1 exit /b 1
)
echo Open http://localhost:5180
call npm.cmd run dev
