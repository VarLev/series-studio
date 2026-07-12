@echo off
cd /d "%~dp0"
echo [1/3] Stopping stuck node processes...
taskkill /F /IM node.exe 1>nul 2>nul
timeout /t 2 /nobreak 1>nul
echo [2/3] Swapping database folders...
if exist ".data\pglite-broken-20260712" rmdir /s /q ".data\pglite-broken-20260712"
ren ".data\pglite" "pglite-broken-20260712"
if errorlevel 1 goto fail
ren ".data\pglite-fix" "pglite"
if errorlevel 1 goto fail
echo [3/3] DONE! Database restored. Now you can run mobile.cmd
goto end
:fail
echo ERROR: rename failed. Close every node process and run this file again.
:end
pause
