"""
MCP Knowledge Base Server
- MCP SSE endpoint on port 3000 (for Claude Code)
- REST API + Dashboard on port 3001 (for Copilot / browser)
- Local embeddings via sentence-transformers
- Qdrant vector storage
- API key auth on all endpoints
- Secret scrubbing before storage
"""

import os
import re
import json
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)
from sentence_transformers import SentenceTransformer

# ── MCP imports ──
from mcp.server.fastmcp import FastMCP

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kb-server")

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
MCP_API_KEY = os.getenv("MCP_API_KEY", "")
REST_API_KEY = os.getenv("REST_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
SENTENCE_TRANSFORMERS_HOME = "/app/models"
COLLECTION_NAME = "knowledge_base"
VECTOR_DIM = 384  # all-MiniLM-L6-v2 dimension

# ──────────────────────────────────────────────
# Secret Scrubbing
# ──────────────────────────────────────────────
SECRET_PATTERNS = [
    (r'(?i)(api[_-]?key|apikey)\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{20,})["\']?', r'\1=***REDACTED***'),
    (r'(?i)(secret|password|passwd|pwd)\s*[:=]\s*["\']?([^\s"\']{8,})["\']?', r'\1=***REDACTED***'),
    (r'(?i)(token)\s*[:=]\s*["\']?([a-zA-Z0-9_\-\.]{20,})["\']?', r'\1=***REDACTED***'),
    (r'(?i)bearer\s+[a-zA-Z0-9_\-\.]{20,}', 'Bearer ***REDACTED***'),
    (r'(?i)(aws_access_key_id|aws_secret_access_key)\s*[:=]\s*["\']?([A-Za-z0-9/+=]{16,})["\']?', r'\1=***REDACTED***'),
    (r'AKIA[0-9A-Z]{16}', '***AWS_KEY_REDACTED***'),
    (r'(?i)(mongodb(\+srv)?://)[^\s]+@', r'\1***REDACTED***@'),
    (r'(?i)(postgres(ql)?://)[^\s]+@', r'\1***REDACTED***@'),
    (r'(?i)(mysql://)[^\s]+@', r'\1***REDACTED***@'),
    (r'ghp_[a-zA-Z0-9]{36}', '***GITHUB_TOKEN_REDACTED***'),
    (r'sk-[a-zA-Z0-9]{32,}', '***OPENAI_KEY_REDACTED***'),
    (r'sk-ant-[a-zA-Z0-9\-]{32,}', '***ANTHROPIC_KEY_REDACTED***'),
]


def scrub_secrets(text: str) -> str:
    """Remove secrets/credentials from text before storing."""
    for pattern, replacement in SECRET_PATTERNS:
        text = re.sub(pattern, replacement, text)
    return text


# ──────────────────────────────────────────────
# Globals (initialized on startup)
# ──────────────────────────────────────────────
embedder: SentenceTransformer = None
qdrant: QdrantClient = None


def init_services():
    """Initialize embedding model and Qdrant client."""
    global embedder, qdrant

    logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
    embedder = SentenceTransformer(EMBEDDING_MODEL, cache_folder=SENTENCE_TRANSFORMERS_HOME)

    logger.info(f"Connecting to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
    qdrant = QdrantClient(
        host=QDRANT_HOST,
        port=QDRANT_PORT,
        api_key=QDRANT_API_KEY or None,
        https=False,
    )

    # Create collection if it doesn't exist
    collections = [c.name for c in qdrant.get_collections().collections]
    if COLLECTION_NAME not in collections:
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        logger.info(f"Created collection: {COLLECTION_NAME}")
    else:
        logger.info(f"Collection exists: {COLLECTION_NAME}")


def embed_text(text: str) -> list[float]:
    """Generate embedding vector for text."""
    return embedder.encode(text).tolist()


# ──────────────────────────────────────────────
# Core Operations
# ──────────────────────────────────────────────
def store_entry(
    content: str,
    project: str = "default",
    tags: list[str] | None = None,
    entry_type: str = "session",
    source: str = "unknown",
) -> str:
    """Scrub, embed, and store a knowledge entry. Returns the entry ID."""
    clean_content = scrub_secrets(content)
    vector = embed_text(clean_content)
    entry_id = str(uuid.uuid4())

    qdrant.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            PointStruct(
                id=entry_id,
                vector=vector,
                payload={
                    "content": clean_content,
                    "project": project,
                    "tags": tags or [],
                    "type": entry_type,
                    "source": source,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        ],
    )
    logger.info(f"Stored entry {entry_id} for project={project} source={source}")
    return entry_id


def search_entries(
    query: str,
    project: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """Search knowledge base by semantic similarity."""
    vector = embed_text(query)

    search_filter = None
    if project:
        search_filter = Filter(
            must=[FieldCondition(key="project", match=MatchValue(value=project))]
        )

    results = qdrant.search(
        collection_name=COLLECTION_NAME,
        query_vector=vector,
        query_filter=search_filter,
        limit=limit,
    )

    return [
        {
            "id": str(r.id),
            "score": round(r.score, 4),
            "content": r.payload.get("content", ""),
            "project": r.payload.get("project", ""),
            "tags": r.payload.get("tags", []),
            "type": r.payload.get("type", ""),
            "source": r.payload.get("source", ""),
            "created_at": r.payload.get("created_at", ""),
        }
        for r in results
    ]


def list_projects() -> list[dict]:
    """List all projects with entry counts."""
    # Scroll all points and aggregate
    projects = {}
    offset = None
    while True:
        results, offset = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=["project", "created_at"],
        )
        if not results:
            break
        for r in results:
            proj = r.payload.get("project", "default")
            if proj not in projects:
                projects[proj] = {"name": proj, "count": 0, "last_updated": ""}
            projects[proj]["count"] += 1
            ts = r.payload.get("created_at", "")
            if ts > projects[proj]["last_updated"]:
                projects[proj]["last_updated"] = ts
        if offset is None:
            break

    return list(projects.values())


def get_recent_entries(project: str | None = None, limit: int = 10) -> list[dict]:
    """Get most recent entries, optionally filtered by project."""
    scroll_filter = None
    if project:
        scroll_filter = Filter(
            must=[FieldCondition(key="project", match=MatchValue(value=project))]
        )

    results, _ = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        limit=limit,
        scroll_filter=scroll_filter,
        with_payload=True,
    )

    entries = [
        {
            "id": str(r.id),
            "content": r.payload.get("content", ""),
            "project": r.payload.get("project", ""),
            "tags": r.payload.get("tags", []),
            "type": r.payload.get("type", ""),
            "source": r.payload.get("source", ""),
            "created_at": r.payload.get("created_at", ""),
        }
        for r in results
    ]

    # Sort by created_at descending
    entries.sort(key=lambda x: x["created_at"], reverse=True)
    return entries[:limit]


def delete_entry(entry_id: str) -> bool:
    """Delete a specific entry by ID."""
    qdrant.delete(
        collection_name=COLLECTION_NAME,
        points_selector=[entry_id],
    )
    return True


# ──────────────────────────────────────────────
# MCP Server (port 3000)
# ──────────────────────────────────────────────
mcp = FastMCP("knowledge-base", port=3000, host="0.0.0.0")


@mcp.tool()
def store_memory(
    content: str,
    project: str = "default",
    tags: list[str] | None = None,
    entry_type: str = "session",
) -> str:
    """Store a knowledge entry — code context, decision, pattern, debugging session, etc.
    
    Args:
        content: The text content to store (secrets are auto-scrubbed)
        project: Project name for organization (e.g., 'my-webapp', 'infra')
        tags: Optional tags for categorization (e.g., ['bug', 'postgres', 'auth'])
        entry_type: Type of entry — 'session', 'decision', 'pattern', 'debug', 'note'
    """
    entry_id = store_entry(
        content=content,
        project=project,
        tags=tags,
        entry_type=entry_type,
        source="claude-code",
    )
    return f"Stored successfully. ID: {entry_id}"


@mcp.tool()
def search_memory(
    query: str,
    project: str | None = None,
    limit: int = 5,
) -> str:
    """Search the knowledge base for relevant past context.
    
    Args:
        query: Natural language search query (e.g., 'how did I fix the nginx timeout')
        project: Optional project filter
        limit: Max results to return (default 5)
    """
    results = search_entries(query=query, project=project, limit=limit)
    if not results:
        return "No matching entries found."
    return json.dumps(results, indent=2)


@mcp.tool()
def list_all_projects() -> str:
    """List all projects in the knowledge base with entry counts."""
    projects = list_projects()
    if not projects:
        return "No projects found. Start storing memories!"
    return json.dumps(projects, indent=2)


@mcp.tool()
def recent_memories(project: str | None = None, limit: int = 10) -> str:
    """Get the most recent knowledge entries.
    
    Args:
        project: Optional project filter
        limit: Max entries to return (default 10)
    """
    entries = get_recent_entries(project=project, limit=limit)
    if not entries:
        return "No entries found."
    return json.dumps(entries, indent=2)


@mcp.tool()
def forget(entry_id: str) -> str:
    """Delete a specific entry from the knowledge base.
    
    Args:
        entry_id: The UUID of the entry to delete
    """
    delete_entry(entry_id)
    return f"Deleted entry {entry_id}"


# ──────────────────────────────────────────────
# REST API (port 3001)
# ──────────────────────────────────────────────
@asynccontextmanager
async def rest_lifespan(app: FastAPI):
    yield

rest_app = FastAPI(title="Knowledge Base REST API", lifespan=rest_lifespan)
rest_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


def verify_rest_key(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials.credentials != REST_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return credentials


# ── REST Models ──
class StoreRequest(BaseModel):
    content: str
    project: str = "default"
    tags: list[str] = []
    entry_type: str = "session"
    source: str = "rest-api"


class SearchRequest(BaseModel):
    query: str
    project: str | None = None
    limit: int = 5


# ── REST Endpoints ──
@rest_app.post("/api/store", dependencies=[Depends(verify_rest_key)])
def api_store(req: StoreRequest):
    entry_id = store_entry(
        content=req.content,
        project=req.project,
        tags=req.tags,
        entry_type=req.entry_type,
        source=req.source,
    )
    return {"id": entry_id, "status": "stored"}


@rest_app.post("/api/search", dependencies=[Depends(verify_rest_key)])
def api_search(req: SearchRequest):
    results = search_entries(query=req.query, project=req.project, limit=req.limit)
    return {"results": results}


@rest_app.get("/api/projects", dependencies=[Depends(verify_rest_key)])
def api_projects():
    return {"projects": list_projects()}


@rest_app.get("/api/recent", dependencies=[Depends(verify_rest_key)])
def api_recent(project: str | None = None, limit: int = 10):
    return {"entries": get_recent_entries(project=project, limit=limit)}


@rest_app.delete("/api/entry/{entry_id}", dependencies=[Depends(verify_rest_key)])
def api_delete(entry_id: str):
    delete_entry(entry_id)
    return {"status": "deleted", "id": entry_id}


@rest_app.get("/health")
def health():
    return {"status": "ok", "model": EMBEDDING_MODEL}


# ── Dashboard (no auth — served on same port, auth via Cloudflare Access) ──
@rest_app.get("/", response_class=HTMLResponse)
def dashboard():
    return DASHBOARD_HTML


# ──────────────────────────────────────────────
# Dashboard HTML
# ──────────────────────────────────────────────
DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knowledge Base</title>
<style>
  :root {
    --bg: #0a0a0f; --surface: #12121a; --border: #1e1e2e;
    --text: #e0e0e8; --dim: #6b6b80; --accent: #7c6ff7;
    --accent-glow: rgba(124,111,247,0.15); --danger: #e5534b;
    --radius: 10px; --font: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:var(--font); font-size:14px; padding:24px; }
  h1 { font-size:20px; color:var(--accent); margin-bottom:4px; }
  .subtitle { color:var(--dim); font-size:12px; margin-bottom:24px; }
  .row { display:flex; gap:16px; margin-bottom:16px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; flex:1; }
  input, textarea, select {
    width:100%; background:var(--bg); border:1px solid var(--border); color:var(--text);
    border-radius:6px; padding:8px 12px; font-family:var(--font); font-size:13px;
    outline:none; margin-bottom:8px;
  }
  input:focus, textarea:focus { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-glow); }
  textarea { min-height:80px; resize:vertical; }
  button {
    background:var(--accent); color:#fff; border:none; border-radius:6px;
    padding:8px 16px; cursor:pointer; font-family:var(--font); font-size:13px;
    transition: opacity 0.2s;
  }
  button:hover { opacity:0.85; }
  button.secondary { background:transparent; border:1px solid var(--border); color:var(--dim); }
  .results { margin-top:16px; }
  .entry {
    background:var(--bg); border:1px solid var(--border); border-radius:var(--radius);
    padding:12px; margin-bottom:8px; position:relative;
  }
  .entry .meta { color:var(--dim); font-size:11px; margin-bottom:6px; }
  .entry .content { white-space:pre-wrap; line-height:1.5; font-size:13px; }
  .entry .score { position:absolute; top:12px; right:12px; color:var(--accent); font-size:11px; }
  .tag { display:inline-block; background:var(--accent-glow); color:var(--accent); padding:2px 8px; border-radius:4px; font-size:11px; margin-right:4px; }
  .stats { display:flex; gap:24px; margin-bottom:16px; }
  .stat { text-align:center; }
  .stat .num { font-size:24px; color:var(--accent); }
  .stat .label { font-size:11px; color:var(--dim); }
  #apiKeyBar { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:12px 16px; margin-bottom:16px; display:flex; gap:8px; align-items:center; }
  #apiKeyBar input { margin:0; flex:1; }
  .tabs { display:flex; gap:0; margin-bottom:16px; }
  .tab { padding:8px 20px; cursor:pointer; border:1px solid var(--border); color:var(--dim); font-size:13px; background:transparent; }
  .tab:first-child { border-radius:var(--radius) 0 0 var(--radius); }
  .tab:last-child { border-radius:0 var(--radius) var(--radius) 0; }
  .tab.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .panel { display:none; }
  .panel.active { display:block; }
</style>
</head>
<body>

<h1>⬡ Knowledge Base</h1>
<p class="subtitle">Local vector memory for your AI agents</p>

<div id="apiKeyBar">
  <span style="color:var(--dim)">API Key:</span>
  <input type="password" id="apiKey" placeholder="Enter your REST API key">
  <button onclick="loadDashboard()">Connect</button>
</div>

<div id="main" style="display:none">
  <div class="stats" id="stats"></div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('search')">Search</div>
    <div class="tab" onclick="switchTab('store')">Store</div>
    <div class="tab" onclick="switchTab('recent')">Recent</div>
  </div>

  <!-- Search Panel -->
  <div class="panel active" id="panel-search">
    <div class="card">
      <input type="text" id="searchQuery" placeholder="Search your knowledge base...">
      <div class="row">
        <input type="text" id="searchProject" placeholder="Filter by project (optional)" style="flex:1">
        <button onclick="doSearch()">Search</button>
      </div>
      <div class="results" id="searchResults"></div>
    </div>
  </div>

  <!-- Store Panel -->
  <div class="panel" id="panel-store">
    <div class="card">
      <textarea id="storeContent" placeholder="Paste content to store..."></textarea>
      <div class="row">
        <input type="text" id="storeProject" placeholder="Project name" style="flex:1">
        <input type="text" id="storeTags" placeholder="Tags (comma-separated)" style="flex:1">
      </div>
      <select id="storeType">
        <option value="session">Session</option>
        <option value="decision">Decision</option>
        <option value="pattern">Pattern</option>
        <option value="debug">Debug</option>
        <option value="note">Note</option>
      </select>
      <button onclick="doStore()">Store Entry</button>
      <div id="storeResult" style="margin-top:8px;color:var(--dim)"></div>
    </div>
  </div>

  <!-- Recent Panel -->
  <div class="panel" id="panel-recent">
    <div class="card">
      <div class="row">
        <input type="text" id="recentProject" placeholder="Filter by project (optional)" style="flex:1">
        <button onclick="doRecent()">Load Recent</button>
      </div>
      <div class="results" id="recentResults"></div>
    </div>
  </div>
</div>

<script>
const BASE = window.location.origin;
let apiKey = '';

function headers() {
  return { 'Content-Type':'application/json', 'Authorization':'Bearer '+apiKey };
}

async function loadDashboard() {
  apiKey = document.getElementById('apiKey').value;
  try {
    const r = await fetch(BASE+'/api/projects', {headers:headers()});
    if (!r.ok) throw new Error('Auth failed');
    const data = await r.json();
    document.getElementById('main').style.display='block';
    let totalEntries = data.projects.reduce((s,p)=>s+p.count,0);
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="num">${data.projects.length}</div><div class="label">Projects</div></div>
      <div class="stat"><div class="num">${totalEntries}</div><div class="label">Entries</div></div>
    `;
    doRecent();
  } catch(e) { alert('Connection failed — check your API key'); }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}

function esc(s) {
  let d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderEntry(e, showScore=false) {
  let tags = (e.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join('');
  let score = showScore && e.score ? '<div class="score">'+e.score+'</div>' : '';
  let preview = e.content.length > 500 ? e.content.slice(0,500)+'...' : e.content;
  return '<div class="entry">'+score+
    '<div class="meta">'+esc(e.project)+' · '+esc(e.type)+' · '+
    esc(e.source||'')+' · '+esc(new Date(e.created_at).toLocaleString())+
    '</div><div class="content">'+esc(preview)+'</div>'+
    (tags?'<div style="margin-top:6px">'+tags+'</div>':'')+
    '</div>';
}

async function doSearch() {
  const q = document.getElementById('searchQuery').value;
  const p = document.getElementById('searchProject').value || undefined;
  const r = await fetch(BASE+'/api/search', {method:'POST',headers:headers(),body:JSON.stringify({query:q,project:p,limit:10})});
  const data = await r.json();
  document.getElementById('searchResults').innerHTML = data.results.length
    ? data.results.map(e=>renderEntry(e,true)).join('')
    : '<div style="color:var(--dim)">No results found.</div>';
}

async function doStore() {
  const body = {
    content: document.getElementById('storeContent').value,
    project: document.getElementById('storeProject').value || 'default',
    tags: document.getElementById('storeTags').value.split(',').map(t=>t.trim()).filter(Boolean),
    entry_type: document.getElementById('storeType').value,
    source: 'dashboard'
  };
  const r = await fetch(BASE+'/api/store', {method:'POST',headers:headers(),body:JSON.stringify(body)});
  const data = await r.json();
  document.getElementById('storeResult').textContent = 'Stored! ID: '+data.id;
  document.getElementById('storeContent').value = '';
}

async function doRecent() {
  const p = document.getElementById('recentProject')?.value || undefined;
  const r = await fetch(BASE+'/api/recent?limit=20'+(p?'&project='+p:''), {headers:headers()});
  const data = await r.json();
  document.getElementById('recentResults').innerHTML = data.entries.length
    ? data.entries.map(e=>renderEntry(e)).join('')
    : '<div style="color:var(--dim)">No entries yet.</div>';
}

// Enter key triggers search
document.addEventListener('keydown', e => {
  if (e.key==='Enter' && document.activeElement.id==='searchQuery') doSearch();
  if (e.key==='Enter' && document.activeElement.id==='apiKey') loadDashboard();
});
</script>
</body>
</html>
"""


# ──────────────────────────────────────────────
# Run both servers
# ──────────────────────────────────────────────
async def run_rest():
    config = uvicorn.Config(rest_app, host="0.0.0.0", port=3001, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


async def run_mcp():
    """Run the MCP server via SSE transport."""
    await mcp.run_sse_async()


async def main():
    logger.info("Starting Knowledge Base Server...")
    init_services()
    logger.info("  MCP endpoint: http://0.0.0.0:3000/sse")
    logger.info("  REST API:     http://0.0.0.0:3001/api")
    logger.info("  Dashboard:    http://0.0.0.0:3001/")

    await asyncio.gather(
        run_rest(),
        run_mcp(),
    )


if __name__ == "__main__":
    asyncio.run(main())
