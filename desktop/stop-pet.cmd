@echo off
chcp 65001 >nul
setlocal
set "PIDFILE=%~dp0.pet.pid"
if not exist "%PIDFILE%" (
  echo 没找到 .pet.pid，可能没在运行。也可以点托盘图标里的"退出桌宠"。
  pause
  exit /b 0
)
set /p PETPID=<"%PIDFILE%"
taskkill /PID %PETPID% /T /F >nul 2>&1
del "%PIDFILE%" >nul 2>&1
echo 桌宠已退出。
pause