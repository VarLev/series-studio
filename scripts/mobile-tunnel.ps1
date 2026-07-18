# === Series Studio: обёртка над cloudflared с уведомлением в Telegram ===
#
# Запускает `cloudflared tunnel --url <target>`, транслирует его вывод в окно
# (как и раньше) и, поймав публичный адрес https://xxxx.trycloudflare.com,
# отправляет его в Telegram-бот. Адрес trycloudflare меняется при каждом
# запуске — так вы получаете свежую ссылку на телефон, не глядя в окно на ПК.
#
# Настройка (в .env.local, рядом с APP_PASSWORD):
#   TELEGRAM_BOT_TOKEN=123456:ABC...   — токен от @BotFather
#   TELEGRAM_CHAT_ID=123456789         — необязательно; если пусто, скрипт
#                                        определит его из вашего сообщения боту
# Важно: бот не может написать вам первым — сначала напишите боту любое
# сообщение (или /start), иначе chat_id не определится и отправка не пойдёт.
# Если TELEGRAM_BOT_TOKEN не задан — скрипт работает как раньше, без отправки.
#
# ВНИМАНИЕ: файл в UTF-8 с BOM — иначе PowerShell 5.1 прочитает кириллицу
# ниже как кракозябры, и сообщение в Telegram придёт битым. При правке
# сохраняйте BOM (VS Code: "UTF-8 with BOM").

param(
    [string]$Cloudflared = 'cloudflared',
    [string]$Target = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'
# Корень проекта = папка над scripts\
$root = Split-Path -Parent $PSScriptRoot
# Telegram требует TLS 1.2+ (PowerShell 5.1 по умолчанию может брать старее).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Чтение .env (.env → .env.local поверх, как в Next.js) ---
function Read-DotEnv([string]$path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $path)) { return $map }
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $key = $matches[1]   # зафиксировать до внутренних -match (они перезапишут $matches)
            $val = $matches[2].Trim()
            if ($val -match '^"(.*)"$' -or $val -match "^'(.*)'$") { $val = $matches[1] }
            $map[$key] = $val
        }
    }
    return $map
}

$cfg = Read-DotEnv (Join-Path $root '.env')
foreach ($kv in (Read-DotEnv (Join-Path $root '.env.local')).GetEnumerator()) {
    $cfg[$kv.Key] = $kv.Value
}
$token  = $cfg['TELEGRAM_BOT_TOKEN']
$chatId = $cfg['TELEGRAM_CHAT_ID']

# --- Определить chat_id из последнего сообщения боту (если не задан явно) ---
function Resolve-ChatId([string]$token) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates" -TimeoutSec 20
    } catch { return $null }
    if (-not $r.ok -or -not $r.result) { return $null }
    for ($i = $r.result.Count - 1; $i -ge 0; $i--) {
        $u = $r.result[$i]
        foreach ($m in @($u.message, $u.edited_message, $u.channel_post)) {
            if ($m -and $m.chat -and $m.chat.id) { return [string]$m.chat.id }
        }
        if ($u.my_chat_member -and $u.my_chat_member.chat) { return [string]$u.my_chat_member.chat.id }
    }
    return $null
}

# --- Отправка сообщения в Telegram ---
function Send-Telegram([string]$token, [string]$chatId, [string]$text) {
    $body = @{
        chat_id                  = $chatId
        text                     = $text
        disable_web_page_preview = $true
    }
    Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" `
        -Method Post -Body $body -TimeoutSec 20 | Out-Null
}

# Подсказки в консоль держим на ASCII — cmd-окно на русской Windows часто
# в кодовой странице cp866 и покажет кириллицу мусором. В Telegram текст
# уходит по HTTP как UTF-8 и приходит нормально.
$notifyEnabled = -not [string]::IsNullOrWhiteSpace($token)
if ($notifyEnabled) {
    if ([string]::IsNullOrWhiteSpace($chatId)) {
        $chatId = Resolve-ChatId $token
        if ($chatId) {
            Write-Host "[telegram] chat_id auto-detected: $chatId" -ForegroundColor DarkGray
            Write-Host "           add TELEGRAM_CHAT_ID=$chatId to .env.local to skip this lookup" -ForegroundColor DarkGray
        } else {
            Write-Host "[telegram] chat_id NOT found. Open the bot in Telegram, send it any message" -ForegroundColor Yellow
            Write-Host "           (or /start), then restart. Tunnel still starts below." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[telegram] disabled: TELEGRAM_BOT_TOKEN is empty in .env.local. Tunnel runs as usual." -ForegroundColor DarkGray
}

# --- Запуск cloudflared с перехватом вывода ---
# cloudflared пишет логи (и баннер с адресом) в stderr. Редиректим только его и
# читаем построчно синхронно; stdout не трогаем (он пуст) — так нет риска дедлока.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = $Cloudflared
$psi.Arguments              = "tunnel --url $Target"
$psi.UseShellExecute        = $false
$psi.RedirectStandardError  = $true
$psi.StandardErrorEncoding  = [Text.Encoding]::UTF8

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()

$urlRegex = 'https://[a-z0-9-]+\.trycloudflare\.com'
$lastSent = $null

while (-not $proc.StandardError.EndOfStream) {
    $line = $proc.StandardError.ReadLine()
    Write-Host $line                       # оставляем вывод cloudflared видимым в окне
    if ($notifyEnabled -and $chatId -and ($line -match $urlRegex)) {
        $url = $matches[0]
        if ($url -ne $lastSent) {           # новый адрес (в т.ч. после переподключения)
            try {
                Send-Telegram $token $chatId "Series Studio доступен:`n$url"
                $lastSent = $url
                Write-Host "[telegram] address sent to chat $chatId" -ForegroundColor Green
            } catch {
                Write-Host "[telegram] send failed: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

$proc.WaitForExit()
exit $proc.ExitCode
