@echo off
setlocal
set "rentalNode=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 (
  set "rentalNode=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if not exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    echo Node.js 20 or later is required.
    exit /b 1
  )
)
"%rentalNode%" "%~dp0scripts\start.cjs" %*
set "rentalExit=%errorlevel%"
if not "%rentalExit%"=="0" if /i not "%~1"=="--no-open" pause
exit /b %rentalExit%
