#!/bin/bash
# ============================================
# MCP Knowledge Base — Setup Script
# Run this on your Proxmox VM/LXC
# ============================================
set -e

echo "╔══════════════════════════════════════╗"
echo "║  MCP Knowledge Base — Setup          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
    echo "❌ Docker not found. Install it first:"
    echo "   curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! command -v docker compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    echo "❌ Docker Compose not found. Install it:"
    echo "   sudo apt install docker-compose-plugin"
    exit 1
fi

echo "✓ Docker found"

# Generate .env if missing
if [ ! -f .env ]; then
    echo ""
    echo "Generating API keys and secrets..."
    QDRANT_KEY=$(openssl rand -hex 32)
    MCP_KEY=$(openssl rand -hex 32)
    REST_KEY=$(openssl rand -hex 32)
    JWT_KEY=$(openssl rand -hex 32)
    ADMIN_USER="admin"
    ADMIN_PASS=$(openssl rand -base64 16)

    cat > .env <<EOF
QDRANT_API_KEY=${QDRANT_KEY}
MCP_API_KEY=${MCP_KEY}
REST_API_KEY=${REST_KEY}
JWT_SECRET=${JWT_KEY}
ADMIN_USERNAME=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}
ALLOW_REGISTRATION=false
HF_TOKEN=
EOF

    echo "✓ Created .env with generated keys"
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  SAVE THESE CREDENTIALS                                ║"
    echo "╠══════════════════════════════════════════════════════════╣"
    echo "║  MCP_API_KEY:     ${MCP_KEY}"
    echo "║  REST_API_KEY:    ${REST_KEY}"
    echo "║  Admin Username:  ${ADMIN_USER}"
    echo "║  Admin Password:  ${ADMIN_PASS}"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
else
    echo "✓ .env already exists, skipping key generation"
fi

# Build and start
echo "Building containers (this may take a few minutes on first run)..."
docker compose build
echo ""
echo "Starting services..."
docker compose up -d

echo ""
echo "Waiting for services to be ready..."
sleep 8

# Health check
if curl -sf http://localhost/health > /dev/null 2>&1; then
    echo "✓ Backend API is healthy"
else
    echo "⚠ Backend not responding via Caddy yet — check: docker compose logs"
fi

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Frontend:     http://${IP}"
echo "  REST API:     http://${IP}/api"
echo "  MCP endpoint: http://${IP}:3000/sse"
echo "  Health:       http://${IP}/health"
echo ""
echo "  Login with the admin credentials above."
echo "  Next: configure Claude Code (see claude-code-config.md)"
echo "════════════════════════════════════════"
