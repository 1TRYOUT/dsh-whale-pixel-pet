# 启动鲸鱼娘桌宠：先按可执行文件路径清理残留，再启动一个实例，最后报告状态。
#
# 为什么按"路径"清理而不是按进程名或窗口标题：
#   之前用窗口标题过滤，结果无标题的子进程杀不掉，攒到 5 个之后新实例会被
#   单实例锁直接退出，用户看到的现象就是"桌宠消失了"。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-pet.ps1

$ErrorActionPreference = 'Continue'
$repo = $PSScriptRoot
$appDir = Join-Path $repo 'desktop'
$exe = Join-Path $env:LOCALAPPDATA 'dsh-whale-pet\runtime\electron.exe'

if (-not (Test-Path $exe)) {
    Write-Host "找不到 Electron 运行时：$exe" -ForegroundColor Red
    Write-Host "请先按 README 安装运行时。" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path (Join-Path $appDir 'main.js'))) {
    Write-Host "找不到 $appDir\main.js —— 这个脚本必须放在仓库根目录运行。" -ForegroundColor Red
    exit 1
}

$leftover = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($leftover.Count -gt 0) {
    Write-Host ("清理残留进程 {0} 个（按可执行文件路径匹配）" -f $leftover.Count) -ForegroundColor Yellow
    foreach ($p in $leftover) {
        try { & taskkill /PID $p.Id /T /F 2>&1 | Out-Null } catch { }
    }
    Start-Sleep -Seconds 2
}

Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory $appDir
Start-Sleep -Seconds 7

$alive = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
if ($alive.Count -gt 0) {
    $win = $alive | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($win) {
        Write-Host ("她起来了（{0} 个进程，窗口「{1}」）" -f $alive.Count, $win.MainWindowTitle) -ForegroundColor Green
    } else {
        Write-Host ("她起来了（{0} 个进程，窗口还在初始化）" -f $alive.Count) -ForegroundColor Green
    }
    exit 0
}

Write-Host "启动失败：没有任何存活的进程。请在前台跑一次看报错：" -ForegroundColor Red
Write-Host "  cd `"$appDir`"; & `"$exe`" . --enable-logging=stderr" -ForegroundColor DarkGray
exit 1
