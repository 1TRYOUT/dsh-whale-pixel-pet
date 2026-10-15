@echo off
chcp 65001 >nul
rem 双击启动鲸鱼娘桌宠（独立桌面窗口）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-pet.ps1"
pause