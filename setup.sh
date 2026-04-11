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
    echo "Generating API keys..."
    QDRANT_KEY=$(openssl rand -hex 32)
    MCP_KEY=$(openssl rand -hex 32)
    REST_KEY=$(openssl rand -hex 32)

    cat > .env <<EOF
QDRANT_API_KEY=${QDRANT_KEY}
MCP_API_KEY=${MCP_KEY}
REST_API_KEY=${REST_KEY}
EOF

    echo "✓ Created .env with generated keys"
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  SAVE THESE KEYS — you'll need them for Claude Code    ║"
    echo "╠══════════════════════════════════════════════════════════╣"
    echo "║  MCP_API_KEY:  ${MCP_KEY}"
    echo "║  REST_API_KEY: ${REST_KEY}"
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
sleep 5

# Health check
if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "✓ REST API is healthy"
else
    echo "⚠ REST API not responding yet — check: docker compose logs mcp-server"
fi

echo ""
echo "════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Dashboard:    http://$(hostname -I | awk '{print $1}'):3001"
echo "  MCP endpoint: http://$(hostname -I | awk '{print $1}'):3000/sse"
echo "  REST API:     http://$(hostname -I | awk '{print $1}'):3001/api"
echo ""
echo "  Next: configure Claude Code (see claude-code-config.md)"
echo "════════════════════════════════════════"
