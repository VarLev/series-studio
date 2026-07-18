@echo off
title Series Studio - mobile launcher
setlocal
cd /d "%~dp0"

REM === Series Studio: mobile launcher (server + Cloudflare Tunnel) ===
REM The phone address (https://...trycloudflare.com) shows up in THIS window.
REM Do NOT close the "Series Studio server" window - the app runs there.
REM Login password = APP_PASSWORD from .env.local

REM cloudflared: try PATH, then the standard winget install location
set "CF=cloudflared"
where cloudflared >nul 2>nul || set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not "%CF%"=="cloudflared" if not exist "%CF%" (
  echo [ERROR] cloudflared not found. Install it with:
  echo         winget install Cloudflare.cloudflared
  goto end
)

echo [1/4] Freeing port 3000 from old processes...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [2/4] Starting server (next build + next start; first build takes 1-3 min)...
start "Series Studio server" /D "%~dp0" cmd /k npm run prod

echo [3/4] Waiting for the server to respond (keep the server window open)...
:wait
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet)) { exit 0 } else { exit 1 }"
if errorlevel 1 goto wait

echo [4/4] Server is up. Starting the tunnel - the phone address is below
echo        (a line like https://XXXX.trycloudflare.com).
echo        If TELEGRAM_BOT_TOKEN is set in .env.local, the address is also sent
echo        to your Telegram bot.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mobile-tunnel.ps1" -Cloudflared "%CF%"

echo.
echo Tunnel stopped. The server keeps running in the "Series Studio server" window.
:end
echo.
pause
