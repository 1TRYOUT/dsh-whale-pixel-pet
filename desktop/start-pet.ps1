# 启动鲸鱼娘桌宠（独立桌面窗口）
# 用法：双击 start-pet.cmd，或在终端里执行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-pet.ps1
$ErrorActionPreference = 'Stop'

$runtime = if ($env:DSH_PET_ELECTRON) { $env:DSH_PET_ELECTRON } else {
  Join-Path $env:LOCALAPPDATA 'dsh-whale-pet\runtime\electron.exe'
}
if (-not (Test-Path $runtime)) {
  Write-Host "找不到 Electron 运行时：$runtime" -ForegroundColor Red
  Write-Host "可用环境变量指定：`$env:DSH_PET_ELECTRON = 'D:\path\to\electron.exe'" -ForegroundColor Yellow
  exit 1
}

# 关键：清掉可能从 DSH 继承来的 ELECTRON_RUN_AS_NODE，
# 否则 Electron 会退化成纯 node，窗口根本不出现。
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$appDir = $PSScriptRoot
$pidFile = Join-Path $appDir '.pet.pid'

if (Test-Path $pidFile) {
  $old = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
    Write-Host "桌宠已经在运行了（PID $old）。要重开就先跑 stop-pet.cmd。" -ForegroundColor Yellow
    exit 0
  }
}

$p = Start-Process -FilePath $runtime -ArgumentList '.' -WorkingDirectory $appDir -PassThru
Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
Write-Host "桌宠已启动（PID $($p.Id)）。" -ForegroundColor Green
Write-Host "她默认在屏幕右下角；拖动她可以搬家，右键她或点托盘图标有菜单。"