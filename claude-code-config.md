# Claude Code — MCP Knowledge Base Configuration

## Step 1: Add MCP Server to Claude Code

Run this command in your terminal to add the MCP server:

```bash
claude mcp add knowledge-base \
  --transport sse \
  --url http://YOUR_PROXMOX_IP:3000/sse \
  --header "Authorization: Bearer YOUR_MCP_API_KEY"
```

Replace:
- `YOUR_PROXMOX_IP` — your Proxmox VM's LAN IP (e.g., `192.168.1.50`)
- `YOUR_MCP_API_KEY` — the MCP key from setup.sh output

### Verify it's connected:

```bash
claude mcp list
```

You should see `knowledge-base` listed with 5 tools.

---

## Step 2: Test It

Open Claude Code and try:

```
> Store this: I set up a Qdrant vector database on my Proxmox server 
  for project "infra" with tags "vector-db", "proxmox"
```

Then search:

```
> Search my knowledge base for "vector database setup"
```

---

## Step 3: Teach Claude Code to Auto-Store

Add this to your project's `CLAUDE.md` file (or global `~/.claude/CLAUDE.md`):

```markdown
## Knowledge Base

You have access to a local knowledge base via MCP tools. Use it proactively:

### When to STORE (call `store_memory`):
- After completing a significant task or fixing a bug
- When making architectural decisions
- When discovering a useful pattern or workaround
- After debugging sessions — store what went wrong and how it was fixed
- When setting up new infrastructure or configuration

### When to SEARCH (call `search_memory`):
- At the start of every session, search for context about the current project
- Before implementing something complex, check if similar work was done before
- When debugging, search for past similar issues

### Format for storing:
Always include:
- What was done (summary)
- Why (reasoning/context)
- How (key steps or code snippets)
- Project name and relevant tags
```

---

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store content with project/tags/type |
| `search_memory` | Semantic search across all stored knowledge |
| `list_all_projects` | Show all projects and entry counts |
| `recent_memories` | Get latest entries (optionally per project) |
| `forget` | Delete a specific entry by ID |

---

## VS Code Setup

The same config works in VS Code with the Claude Code extension. The MCP 
server config is shared — once you run `claude mcp add`, it works in both 
the terminal and VS Code.

---

## Troubleshooting

**"Connection refused"**  
- Check if the server is running: `docker compose ps` on your Proxmox box
- Verify the IP and port are correct
- Check firewall: `sudo ufw allow 3000/tcp`

**"401 Unauthorized"**  
- Verify your MCP_API_KEY matches what's in the server's `.env`

**"No results found"**  
- The DB might be empty — store some entries first
- Try broader search terms — semantic search is fuzzy, not keyword-exact

**Check server logs:**
```bash
# On your Proxmox box
cd /path/to/mcp-knowledge-base
docker compose logs -f mcp-server
```
