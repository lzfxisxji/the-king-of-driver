@echo off
chcp 65001 >nul
title 萌兽卡丁 · Moe Kart
cd /d "%~dp0"
setlocal

rem ================================================================
rem  【重要】本机 .py 文件的默认打开方式是 VS Code，
rem          所以双击 serve.py 只会打开编辑器，不会启动服务。
rem          —— 请始终双击本文件（启动游戏.bat）。
rem ================================================================

echo.
echo  ============================================================
echo    萌兽卡丁 · Moe Kart   本地启动器
echo  ============================================================
echo.

set "PY="
set "PNAME="

rem ---- 1) 优先用实测可用的绝对路径解释器（避免 py -3 落到老的 3.8）----
if not defined PY if exist "D:\conda\python.exe"                                 call :probe "D:\conda\python.exe" "" "D:\conda\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" call :probe "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "" "Python 3.13"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" call :probe "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "" "Python 3.12"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" call :probe "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "" "Python 3.11"
if not defined PY if exist "C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe" call :probe "C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe" "" "WorkBuddy 内置 Python 3.13"

rem ---- 2) 再退回 py 启动器 / PATH 上的 python ----
if not defined PY call :probe "py" "-3" "py -3"
if not defined PY call :probe "python" "" "python (PATH)"

if not defined PY goto :nopy

echo  使用的解释器：%PNAME%
echo  正在启动本地服务（关闭本窗口即可停止）...
echo.
%PY% "%~dp0serve.py"
if errorlevel 1 (
  echo.
  echo  [!] 服务异常退出（错误码 %errorlevel%）。
  echo      可在命令行手动执行下列命令查看具体报错：
  echo      %PY% "%~dp0serve.py"
  echo.
  pause
)
exit /b 0

rem ================================================================
rem  :probe  %1=解释器  %2=附加参数(可空)  %3=显示名
rem  只有真正能 import 依赖的解释器才会被采纳，避免误用坏环境
rem ================================================================
:probe
if defined PY exit /b 0
"%~1" %2 -c "import http.server,socketserver,threading,webbrowser" >nul 2>nul
if errorlevel 1 exit /b 0
set "PY=%~1"
if not "%~2"=="" set "PY=%~1 %~2"
set "PNAME=%~3"
exit /b 0

:nopy
echo.
echo  [X] 没有找到可用的 Python 3，无法启动本地服务器。
echo.
echo      游戏必须通过 http:// 打开——浏览器安全策略不允许用 file://
echo      载入 3D 贴图，直接双击 index.html 会黑屏。
echo.
echo      解决办法（任选其一）：
echo        1. 安装 Python 3：https://www.python.org/downloads/
echo           安装时务必勾选 "Add python.exe to PATH"
echo        2. 或把本项目放到任意静态服务器（VS Code 的 Live Server 也可以）
echo.
pause
exit /b 1
