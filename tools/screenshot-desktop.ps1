# 给仓库截一张"真实效果图"——只截她那扇窗口的矩形，别处一律不入镜。
#
#   .\tools\screenshot-desktop.ps1                 # 截到 docs/screenshots/desktop-live.png
#   .\tools\screenshot-desktop.ps1 -Margin 60      # 四周多留 60px（构图好看些，但要确认多出来的部分也干净）
#   .\tools\screenshot-desktop.ps1 -Publish        # 顺便把图插进两份 README，并打印提交命令
#
# 为什么这样最安全：截图区域 = 她窗口的 GetWindowRect，矩形外的桌面图标 / 其它软件窗口 /
# 任务栏物理上不可能出现在图里。唯一的变量是**她自己那 420×640 里透出来的背景**，
# 所以跑之前请把 DSH 窗口最小化、桌面留一块干净壁纸。
param(
  [string]$Out = "",
  [int]$Margin = 12,
  [switch]$Publish
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms

if (-not $Out) {
  $Out = Join-Path $PSScriptRoot '..\docs\screenshots\desktop-live.png'
}
$Out = [System.IO.Path]::GetFullPath($Out)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PetWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# 按标题找她那扇窗（比读 position.json 可靠：那个文件只在移动后落盘）
$script:rect = $null
$cb = [PetWin+EnumProc]{
  param($h, $l)
  if (-not [PetWin]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 256
  [PetWin]::GetWindowText($h, $sb, 256) | Out-Null
  $title = $sb.ToString()
  if ($title -like '*鲸鱼娘*' -or $title -like '*whale*pet*') {
    $r = New-Object PetWin+RECT
    [PetWin]::GetWindowRect($h, [ref]$r) | Out-Null
    $script:rect = $r
    return $false
  }
  return $true
}
[PetWin]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

if (-not $script:rect) {
  Write-Host "没找到桌宠窗口。先启动她：.\desktop\start-pet.cmd" -ForegroundColor Red
  exit 1
}

$r = $script:rect
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = [Math]::Max(0, $r.Left - $Margin)
$y = [Math]::Max(0, $r.Top - $Margin)
$w = [Math]::Min($screen.Width - $x, ($r.Right + $Margin) - $x)
$h = [Math]::Min($screen.Height - $y, ($r.Bottom + $Margin) - $y)
if ($w -le 0 -or $h -le 0) { Write-Host "窗口不在屏幕范围内" -ForegroundColor Red; exit 1 }

Write-Host "她窗口: ($($r.Left),$($r.Top)) $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
Write-Host "截取区域: ($x,$y) ${w}x${h}（矩形之外的东西不会被截进来）"

New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($Out)) | Out-Null
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "已保存: $Out" -ForegroundColor Green
Write-Host ""
Write-Host "接下来（重要）：请先自己打开这张图看一眼——只有你能判断她那块背景里有没有不想公开的东西。" -ForegroundColor Yellow
Write-Host "确认干净后，再考虑把它提交进仓库。"

if ($Publish) {
  $block = @"

## 真实效果 / In action

![她在桌面上 / On the desktop](docs/screenshots/desktop-live.png)

> 只截了她那扇窗口的矩形，矩形之外的桌面内容一律不入镜。
"@
  foreach ($name in @('README.md', 'README.en.md')) {
    $p = Join-Path $PSScriptRoot "..\$name"
    if (-not (Test-Path $p)) { continue }
    $text = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
    if ($text -match 'desktop-live\.png') { Write-Host "$name 已经引用过这张图，跳过"; continue }
    $text = $text.TrimEnd() + "`r`n" + $block
    [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "$name 已插入效果图段落"
  }
  Write-Host ""
  Write-Host "提交并推送：" -ForegroundColor Cyan
  Write-Host "  git add docs/screenshots/desktop-live.png README.md README.en.md"
  Write-Host "  git commit -m `"docs: 补一张真实效果图（仅截取她窗口矩形）`""
  Write-Host "  git push origin main"
}
