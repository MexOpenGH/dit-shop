@echo off
REM ============================================================
REM Dit Shop - quick start script (Windows)
REM ============================================================

cd /d "%~dp0backend"

if not exist .env (
    echo Creating .env from .env.example ...
    copy .env.example .env
    echo.
    echo *** Edit backend\.env to set your MySQL password and JWT_SECRET ***
    echo.
    pause
)

if not exist node_modules (
    echo Installing dependencies ...
    call npm install
)

echo.
echo Starting Dit Shop server on http://localhost:3000 ...
echo Press Ctrl+C to stop.
echo.
call npm start
