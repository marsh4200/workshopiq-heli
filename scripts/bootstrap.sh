#!/usr/bin/env bash
#
# WorkshopIQ one-line bootstrap: installs git+docker as needed, clones, installs.
#   curl -fsSL https://raw.githubusercontent.com/marsh4200/workshopiq-heli/main/scripts/bootstrap.sh | bash
#
set -euo pipefail

REPO="https://github.com/marsh4200/workshopiq-heli.git"
DIR="${WORKSHOPIQ_DIR:-$HOME/workshopiq-heli}"

if ! command -v git >/dev/null 2>&1; then
  echo "==> Installing git…"
  sudo apt-get update -y && sudo apt-get install -y git
fi

if [ -d "$DIR/.git" ]; then
  echo "==> Updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only || true
else
  echo "==> Cloning into $DIR"
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
bash scripts/install.sh
