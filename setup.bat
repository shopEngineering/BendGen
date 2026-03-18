@echo off
:: BendGen Setup - Windows
:: Double-click this file to set up BendGen for the first time.

cd /d "%~dp0"

echo ========================================
echo   BendGen Setup
echo ========================================
echo.

:: Find Python 3.10+
set PYTHON=
for %%P in (python3 python py) do (
    where %%P >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%V in ('%%P -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set PYVER=%%V
        for /f "tokens=*" %%M in ('%%P -c "import sys; print(sys.version_info.major)" 2^>nul') do set PYMAJOR=%%M
        for /f "tokens=*" %%N in ('%%P -c "import sys; print(sys.version_info.minor)" 2^>nul') do set PYMINOR=%%N
        if "!PYMAJOR!"=="3" if !PYMINOR! GEQ 10 (
            set PYTHON=%%P
            echo [OK] Found %%P ^(version !PYVER!^)
            goto :found_python
        )
    )
)

echo.
echo [ERROR] Python 3.10 or newer is required but was not found.
echo.
echo Install Python from: https://www.python.org/downloads/
echo IMPORTANT: Check "Add Python to PATH" during installation.
echo.
pause
exit /b 1

:found_python
setlocal enabledelayedexpansion

:: Create virtual environment
if exist ".venv" (
    echo [OK] Virtual environment already exists
) else (
    echo [...] Creating virtual environment...
    %PYTHON% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created
)

:: Install dependencies
echo [...] Installing dependencies...
call .venv\Scripts\activate.bat
pip install --upgrade pip -q 2>nul
pip install -e . -q
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Setup complete!
echo ========================================
echo.
echo To start BendGen, double-click:
echo   start-bendgen.bat
echo.
pause
