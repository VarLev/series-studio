@echo off
chcp 65001 >nul
REM === Series Studio: мобильный режим ===
REM Поднимает прод-сервер и Cloudflare Tunnel. Адрес для телефона
REM (https://…trycloudflare.com) появится в этом окне через ~10 секунд.
REM Вход по паролю APP_PASSWORD из .env.local. Закрыть: Ctrl+C + окно сервера.

cd /d "%~dp0"
echo [1/3] Запускаю сервер (next build ^&^& next start)...
start "Series Studio server" cmd /c "npm run prod"

echo [2/3] Жду порт 3000 (первая сборка может занять пару минут)...
:wait
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 goto wait

echo [3/3] Сервер готов. Поднимаю туннель — ищите адрес https://XXXX.trycloudflare.com ниже:
echo.
cloudflared tunnel --url http://localhost:3000
