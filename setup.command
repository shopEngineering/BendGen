#!/bin/bash
# BendGen Setup - macOS
# Double-click this file to set up BendGen for the first time.

cd "$(dirname "$0")"

echo "========================================"
echo "  BendGen Setup"
echo "========================================"
echo ""

# Find Python 3
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
        major=$("$cmd" -c "import sys; print(sys.version_info.major)" 2>/dev/null)
        minor=$("$cmd" -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
        if [ "$major" = "3" ] && [ "$minor" -ge 10 ]; then
            PYTHON="$cmd"
            echo "[OK] Found $cmd (version $ver)"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo ""
    echo "[ERROR] Python 3.10 or newer is required but was not found."
    echo ""
    echo "Install Python from: https://www.python.org/downloads/"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# Create virtual environment
if [ -d ".venv" ]; then
    echo "[OK] Virtual environment already exists"
else
    echo "[...] Creating virtual environment..."
    "$PYTHON" -m venv .venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create virtual environment."
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
    echo "[OK] Virtual environment created"
fi

# Install dependencies
echo "[...] Installing dependencies..."
source .venv/bin/activate
pip install --upgrade pip -q 2>/dev/null
pip install -e . -q
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies."
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

echo ""
echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "To start BendGen, double-click:"
echo "  start-bendgen.command"
echo ""
echo "Press any key to exit..."
read -n 1
