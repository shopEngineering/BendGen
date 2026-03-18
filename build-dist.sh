#!/bin/bash
# Build a standalone distributable of BendGen using PyInstaller
cd "$(dirname "$0")"

set -e

DIST_NAME="BendGen"
ZIP_FILE="dist/BendGen.zip"

# Activate venv
source .venv/bin/activate

# Clean previous builds
rm -rf build dist

# Run PyInstaller
echo "Building with PyInstaller..."
pyinstaller bendgen.spec --noconfirm

# Copy README into the dist folder
cp README.md "dist/$DIST_NAME/"

# Build ZIP
cd dist
zip -r "$DIST_NAME.zip" "$DIST_NAME"
cd ..

echo ""
echo "Built: $ZIP_FILE"
ls -lh "$ZIP_FILE"
echo ""
echo "Users just need to unzip and double-click BendGen (no Python required)."
