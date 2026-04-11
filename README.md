# MCP Knowledge Base

A self-hosted vector knowledge base for AI coding agents. Stores context from 
your coding sessions and makes it searchable via semantic similarity.

## Architecture

```
Claude Code / VS Code ──► MCP Server (port 3000) ──► Qdrant (internal)
Browser Dashboard     ──► REST API  (port 3001) ──►     ↑
                                                    Embeddings
                                              (all-MiniLM-L6-v2, local)
```

## What's Included

| Component | Description |
|-----------|-------------|
| `docker-compose.yml` | Orchestrates Qdrant + MCP server |
| `mcp-server/server.py` | MCP + REST server with embedding, auth, secret scrubbing |
| `setup.sh` | One-command setup: generates keys, builds, starts everything |
| `claude-code-config.md` | Step-by-step Claude Code configuration |

## Quick Start

### 1. On your Proxmox VM/LXC

```bash
# Clone or copy this folder to your server
cd mcp-knowledge-base

# Run setup (generates keys, builds containers, starts services)
./setup.sh
```

### 2. On your dev machine

```bash
# Add MCP server to Claude Code
claude mcp add knowledge-base \
  --transport sse \
  --url http://YOUR_SERVER_IP:3000/sse \
  --header "Authorization: Bearer YOUR_MCP_API_KEY"
```

### 3. Start using it

Open Claude Code and tell it to store/search your knowledge base.
Open the dashboard at `http://YOUR_SERVER_IP:3001` for a web UI.

## Security

- API key auth on all endpoints (MCP + REST)
- Qdrant isolated on internal Docker network (no host port exposure)
- Automatic secret/credential scrubbing before storage
- Separate keys for MCP and REST access
- Ready for Cloudflare Tunnel if you want remote access

## Hardware Requirements

- 2 CPU cores
- 2-4 GB RAM
- 2 GB disk (grows with usage)
- Runs comfortably on a small Proxmox LXC or VM

## Optional: Cloudflare Tunnel (for remote access)

```bash
# Install cloudflared on your Proxmox box
curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create kb-tunnel

# Route to your MCP server
cloudflared tunnel route dns kb-tunnel kb.yourdomain.com

# Run it
cloudflared tunnel --url http://localhost:3000 run kb-tunnel
```

Then update Claude Code config to use `https://kb.yourdomain.com/sse`.
# mcp-memory
