#!/usr/bin/env bash
#
# Deploy Veil agent + dashboard to VPS
#
# Usage:
#   ./scripts/deploy.sh              # full deploy (clone/pull, install, build, restart)
#   ./scripts/deploy.sh setup        # first-time setup only (deploy key, pnpm, systemd)
#   ./scripts/deploy.sh env          # copy .env to VPS
#   ./scripts/deploy.sh restart      # just restart the service
#   ./scripts/deploy.sh logs         # tail service logs
#   ./scripts/deploy.sh status       # show service status
#
set -euo pipefail

VPS_HOST="195.201.8.147"
VPS_USER="bawler"
REMOTE="${VPS_USER}@${VPS_HOST}"
DEPLOY_KEY_LOCAL="$HOME/.ssh/id_veil_deploy"
APP_DIR="/home/${VPS_USER}/veil"
SERVICE_NAME="veil-agent"
REPO_URL="github-veil:neilei/synthesis-hackathon.git"
NODE_VERSION="22"
PORT=3147

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }

ssh_run() {
  ssh -o StrictHostKeyChecking=accept-new "${REMOTE}" "$@"
}

# --------------------------------------------------------------------------
# Setup: deploy key, pnpm, systemd unit
# --------------------------------------------------------------------------
cmd_setup() {
  log "Setting up VPS for first-time deployment..."

  # 1. Copy deploy key to VPS
  if [ ! -f "${DEPLOY_KEY_LOCAL}" ]; then
    err "Deploy key not found at ${DEPLOY_KEY_LOCAL}"
    err "Generate one: ssh-keygen -t ed25519 -f ${DEPLOY_KEY_LOCAL} -N '' -C 'veil-deploy-key'"
    exit 1
  fi

  log "Copying deploy key to VPS..."
  scp "${DEPLOY_KEY_LOCAL}" "${REMOTE}:~/.ssh/id_veil_deploy"
  ssh_run "chmod 600 ~/.ssh/id_veil_deploy"

  # Configure SSH on VPS to use deploy key for github
  ssh_run "grep -q 'Host github-veil' ~/.ssh/config 2>/dev/null" || \
    ssh_run "cat >> ~/.ssh/config" <<'SSHEOF'

Host github-veil
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_veil_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
SSHEOF
  ssh_run "chmod 600 ~/.ssh/config"

  # 2. Install pnpm via corepack
  log "Enabling pnpm via corepack..."
  ssh_run "corepack enable pnpm 2>/dev/null || sudo corepack enable pnpm"

  # 3. Create systemd service
  log "Creating systemd service..."
  ssh_run "sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null" <<UNITEOF
[Unit]
Description=Veil Agent (DeFi autonomous agent + dashboard)
After=network.target

[Service]
Type=simple
User=${VPS_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node packages/agent/dist/src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PORT}
EnvironmentFile=${APP_DIR}/.env

# Resource limits
LimitNOFILE=65536
MemoryMax=1G

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR} ${APP_DIR}/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEOF

  ssh_run "sudo systemctl daemon-reload"
  ssh_run "sudo systemctl enable ${SERVICE_NAME}"

  # 4. Create data directories for SQLite, per-intent logs, and avatar images
  log "Creating data directories..."
  ssh_run "mkdir -p ${APP_DIR}/data/logs ${APP_DIR}/data/images"

  # 5. Open firewall port if ufw is active
  ssh_run "which ufw >/dev/null 2>&1 && sudo ufw allow ${PORT}/tcp || true"

  log "Setup complete."
  log ""
  warn "NEXT STEPS:"
  warn "  1. Add this deploy key to the GitHub repo as a read-only deploy key:"
  warn "     $(cat "${DEPLOY_KEY_LOCAL}.pub")"
  warn ""
  warn "  2. Create ${APP_DIR}/.env on the VPS with required secrets"
  warn "     (copy from local .env: scp .env ${REMOTE}:${APP_DIR}/.env)"
  warn ""
  warn "  3. Run: ./scripts/deploy.sh"
}

# --------------------------------------------------------------------------
# Deploy: clone/pull, install, build, restart
# --------------------------------------------------------------------------
cmd_deploy() {
  log "Deploying to ${VPS_HOST}..."

  # Clone or pull
  if ssh_run "test -d ${APP_DIR}/.git"; then
    log "Pulling latest code..."
    ssh_run "cd ${APP_DIR} && git remote set-url origin ${REPO_URL} && git fetch origin && git reset --hard origin/${DEPLOY_BRANCH:-main}"
  else
    log "Cloning repository..."
    ssh_run "git clone ${REPO_URL} ${APP_DIR}"
  fi

  # Ensure data directory exists (SQLite DB + per-intent JSONL logs)
  log "Creating data directories..."
  ssh_run "mkdir -p ${APP_DIR}/data/logs ${APP_DIR}/data/evidence ${APP_DIR}/data/images"

  # Install dependencies
  log "Installing dependencies..."
  ssh_run "cd ${APP_DIR} && pnpm install --frozen-lockfile"

  # Rebuild native modules (better-sqlite3 needs node-gyp compilation on Linux;
  # pnpm's approve-builds blocks build scripts by default)
  log "Rebuilding native modules..."
  ssh_run "cd ${APP_DIR}/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx --yes node-gyp rebuild --release"

  # Build common + agent (skip dashboard — we do a separate static export)
  log "Building common + agent..."
  ssh_run "cd ${APP_DIR} && pnpm --filter @veil/common build"
  ssh_run "cd ${APP_DIR} && pnpm --filter @veil/agent build"

  # Build dashboard as static export (agent server serves the files).
  # Temporarily remove API proxy routes — they're dev-only and incompatible with static export.
  # The agent server handles /api/* directly on the same origin.
  log "Building dashboard (static export)..."
  ssh_run "cd ${APP_DIR}/apps/dashboard && mv app/api /tmp/veil-api-routes-bak 2>/dev/null; STATIC_EXPORT=1 npx next build; mv /tmp/veil-api-routes-bak app/api 2>/dev/null; true"

  # Check .env exists
  if ! ssh_run "test -f ${APP_DIR}/.env"; then
    warn ".env file missing at ${APP_DIR}/.env"
    warn "Copy it: scp .env ${REMOTE}:${APP_DIR}/.env"
    warn "Skipping service restart."
    return
  fi

  # Restart service
  cmd_restart

  log "Deployed successfully."
  log "Dashboard: http://${VPS_HOST}:${PORT}"
  log "API:       http://${VPS_HOST}:${PORT}/api/intents"
}

# --------------------------------------------------------------------------
# Restart / Logs / Status
# --------------------------------------------------------------------------
cmd_restart() {
  log "Restarting ${SERVICE_NAME}..."
  ssh_run "sudo systemctl restart ${SERVICE_NAME}"
  sleep 2
  ssh_run "sudo systemctl status ${SERVICE_NAME} --no-pager -l" || true
}

cmd_logs() {
  log "Tailing ${SERVICE_NAME} logs (Ctrl+C to stop)..."
  ssh -t "${REMOTE}" "sudo journalctl -u ${SERVICE_NAME} -f --no-pager"
}

cmd_status() {
  ssh_run "sudo systemctl status ${SERVICE_NAME} --no-pager -l" || true
  echo ""
  ssh_run "curl -s http://localhost:${PORT}/api/auth/nonce?wallet=0x0 2>/dev/null | head -c 500" || warn "Service not responding"
}

cmd_env() {
  log "Copying .env to VPS..."
  ssh_run "mkdir -p ${APP_DIR}"
  scp "$(dirname "$0")/../.env" "${REMOTE}:${APP_DIR}/.env"
  log ".env copied to ${APP_DIR}/.env"
}

cmd_wipedb() {
  log "Wiping VPS database and evidence (forces fresh ERC-8004 registration)..."
  ssh_run "rm -f ${APP_DIR}/data/veil.db ${APP_DIR}/data/veil.db-wal ${APP_DIR}/data/veil.db-shm"
  ssh_run "rm -rf ${APP_DIR}/data/evidence ${APP_DIR}/data/logs"
  ssh_run "mkdir -p ${APP_DIR}/data/logs ${APP_DIR}/data/evidence ${APP_DIR}/data/images"
  log "Database wiped. Restart the service to re-register agents."
}

# --------------------------------------------------------------------------
# HAProxy cache for avatar images
# --------------------------------------------------------------------------
cmd_haproxy_cache() {
  log "Configuring HAProxy cache for avatar images..."

  # Check if cache is already configured
  if ssh_run "grep -q 'cache veil_avatars' /etc/haproxy/haproxy.cfg 2>/dev/null"; then
    log "HAProxy cache already configured, skipping."
    return
  fi

  # Back up current config
  ssh_run "sudo cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.bak"

  # Add cache section after defaults block, and caching rules to veil-agent backend
  ssh_run "sudo python3 -c \"
import re

with open('/etc/haproxy/haproxy.cfg') as f:
    cfg = f.read()

# Add cache section after defaults block (before first frontend)
cache_section = '''
cache veil_avatars
  total-max-size 50
  max-object-size 2097152
  max-age 86400

'''
cfg = cfg.replace('frontend http-in', cache_section + 'frontend http-in', 1)

# Add caching rules to veil-agent backend
old_backend = 'backend veil-agent\n\tserver veil 127.0.0.1:3147 check'
new_backend = '''backend veil-agent
\tacl is_avatar path_end .webp
\thttp-request cache-use veil_avatars if is_avatar
\thttp-response cache-store veil_avatars if is_avatar
\tserver veil 127.0.0.1:3147 check'''
cfg = cfg.replace(old_backend, new_backend)

with open('/etc/haproxy/haproxy.cfg', 'w') as f:
    f.write(cfg)
\""

  # Validate config
  if ssh_run "sudo haproxy -c -f /etc/haproxy/haproxy.cfg"; then
    log "HAProxy config valid, reloading..."
    ssh_run "sudo systemctl reload haproxy"
    log "HAProxy cache configured and active."
  else
    err "HAProxy config validation failed, restoring backup..."
    ssh_run "sudo cp /etc/haproxy/haproxy.cfg.bak /etc/haproxy/haproxy.cfg"
    err "Backup restored. Please check the config manually."
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
case "${1:-deploy}" in
  setup)          cmd_setup ;;
  deploy)         cmd_deploy ;;
  restart)        cmd_restart ;;
  logs)           cmd_logs ;;
  status)         cmd_status ;;
  env)            cmd_env ;;
  wipedb)         cmd_wipedb ;;
  haproxy-cache)  cmd_haproxy_cache ;;
  *)
    err "Unknown command: $1"
    err "Usage: $0 {setup|deploy|restart|logs|status|env|wipedb|haproxy-cache}"
    exit 1
    ;;
esac
