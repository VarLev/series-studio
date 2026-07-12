@echo off
chcp 65001 >nul
REM === Series Studio: мобильный режим ===
REM Поднимает прод-сервер и Cloudflare Tunnel. Адрес для телефона
REM (https://…trycloudflare.com) появится в ЭТОМ окне.
REM НЕ закрывайте окно «Series Studio server» — в нём живёт сервер.

cd /d "%~dp0"

echo [1/4] Освобождаю порт 3000 от старых процессов...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [2/4] Запускаю сервер (next build + next start; первая сборка 1-3 минуты)...
start "Series Studio server" cmd /k "npm run prod"

echo [3/4] Жду, пока сервер начнёт отвечать...
:wait
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/login' -UseBasicParsing -TimeoutSec 4; if ($r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 goto wait

echo [4/4] Сервер отвечает. Поднимаю туннель — адрес для телефона ниже
echo        (строка вида https://XXXX.trycloudflare.com):
echo.
cloudflared tunnel --url http://127.0.0.1:3000
echo.
echo Туннель остановлен. Сервер продолжает работать в окне «Series Studio server».
pause
