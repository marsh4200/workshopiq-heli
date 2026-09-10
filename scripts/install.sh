#!/usr/bin/env bash
#
# WorkshopIQ installer — installs Docker if missing, then builds and starts.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> WorkshopIQ installer"

# --- install Docker if missing ---
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker not found. Installing via get.docker.com (requires sudo)…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  echo "==> Docker installed."
fi

# --- use sudo for docker if the socket isn't accessible yet ---
SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi

# --- compose detection ---
if $SUDO docker compose version >/dev/null 2>&1; then
  COMPOSE="$SUDO docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="$SUDO docker-compose"
else
  echo "==> Installing Docker Compose plugin…"
  sudo apt-get update -y && sudo apt-get install -y docker-compose-plugin
  COMPOSE="$SUDO docker compose"
fi

# --- environment ---
if [ ! -f .env ]; then
  echo "==> Generating .env"
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
    DBPASS="$(openssl rand -hex 16)"
  else
    SECRET="change-me-$(date +%s)-$RANDOM"
    DBPASS="workshopiq"
  fi
  # Derive the version from the checked-out git tag so the app self-reports it.
  APP_VER="$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)"
  cat > .env << ENVEOF
APP_PORT=9918
APP_VERSION=${APP_VER}
POSTGRES_USER=workshopiq
POSTGRES_PASSWORD=${DBPASS}
POSTGRES_DB=workshopiq
SECRET_KEY=${SECRET}
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin
ENVEOF
  echo "==> .env created with a random SECRET_KEY and DB password."
else
  echo "==> .env already exists, leaving it untouched."
fi

# --- build & start ---
echo "==> Building containers (first build can take a few minutes)…"
$COMPOSE build

echo "==> Starting WorkshopIQ…"
$COMPOSE up -d

PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-9918}"

echo ""
echo "============================================================"
echo " WorkshopIQ is starting up."
echo " Open:  http://localhost:${PORT}"
echo " Login: admin / admin   (you will be forced to change it)"
echo "============================================================"
if [ -n "$SUDO" ]; then
  echo " NOTE: Docker was just installed. Log out and back in so you"
  echo "       can run 'docker' without sudo in future."
fi
