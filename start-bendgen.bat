@echo off
cd /d "%~dp0"

if not exist ".venv" (
    echo BendGen has not been set up yet.
    echo Running setup first...
    echo.
    call setup.bat
)

call .venv\Scripts\activate.bat
echo Starting BendGen on http://localhost:5050
echo Press Ctrl+C to stop.
echo.
start http://localhost:5050
bendgen
