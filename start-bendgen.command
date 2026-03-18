#!/bin/bash
# Double-click this file to start BendGen
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "BendGen has not been set up yet."
    echo "Running setup first..."
    echo ""
    bash setup.command
fi

source .venv/bin/activate
echo "Starting BendGen on http://localhost:5050"
echo "Press Ctrl+C to stop."
echo ""
open http://localhost:5050 &
bendgen
