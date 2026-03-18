#!/bin/bash
# BendGen installer for Raspberry Pi OS
# Run with: curl -sSL <url> | bash
#       or: bash install-pi.sh
set -e

INSTALL_DIR="$HOME/BendGen"
SERVICE_NAME="bendgen"

echo "=== BendGen Installer for Raspberry Pi ==="
echo ""

# Install system dependencies
echo "Installing Python and dependencies..."
sudo apt-get update -qq
sudo apt-get install -y python3 python3-pip python3-venv

# Create install directory and venv
mkdir -p "$INSTALL_DIR"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet flask>=3.0 pydantic>=2.0 ezdxf>=1.0

# Download and install BendGen
echo "Downloading BendGen..."
LATEST=$(curl -s https://api.github.com/repos/shopEngineering/BendGen/releases/latest | grep tag_name | cut -d'"' -f4)
curl -sSL "https://github.com/shopEngineering/BendGen/archive/refs/tags/${LATEST}.tar.gz" | tar -xz -C "$INSTALL_DIR" --strip-components=1

"$INSTALL_DIR/venv/bin/pip" install --quiet -e "$INSTALL_DIR"

# Create launcher script
cat > "$INSTALL_DIR/start.sh" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "BendGen running at http://$(hostname -I | awk '{print $1}'):5050"
"$DIR/venv/bin/python" "$DIR/bendgen_app.py"
EOF
chmod +x "$INSTALL_DIR/start.sh"

# Optionally install as a systemd service
echo ""
read -p "Install as a background service (auto-starts on boot)? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=BendGen Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/bendgen_app.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"
    echo "Service installed and started."
    echo "  Stop:    sudo systemctl stop bendgen"
    echo "  Status:  sudo systemctl status bendgen"
fi

echo ""
echo "=== Done! ==="
echo "Start BendGen:  ~/BendGen/start.sh"
echo "Open in browser: http://$(hostname -I | awk '{print $1}'):5050"
