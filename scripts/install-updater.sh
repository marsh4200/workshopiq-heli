#!/usr/bin/env bash
#
# Installs the WorkshopIQ update watcher as a systemd service so the in-app
# "Apply Update" button works and survives reboots. Requires sudo.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=/etc/systemd/system/workshopiq-updater.service
RUN_USER="${SUDO_USER:-$(whoami)}"

echo "==> Installing watcher service for repo at: $ROOT_DIR (user: $RUN_USER)"

sudo tee "$SERVICE" >/dev/null << UNIT
[Unit]
Description=WorkshopIQ update watcher
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${ROOT_DIR}
ExecStart=/usr/bin/env bash ${ROOT_DIR}/scripts/update.sh --watch
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now workshopiq-updater.service

echo "==> Watcher installed and started."
echo "    Status: sudo systemctl status workshopiq-updater"
echo "    Logs:   sudo journalctl -u workshopiq-updater -f"
