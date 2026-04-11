"""
MCP Knowledge Base Server
- MCP SSE endpoint on port 3000 (for Claude Code)
- REST API on port 3001 (for frontend / programmatic access)
- Local embeddings via sentence-transformers
- Qdrant vector storage
- JWT + API key dual auth
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
from fastapi import FastAPI, HTTPException, Depends, Request, Query
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
    MatchAny,
    Range,
)
from sentence_transformers import SentenceTransformer

# ── MCP imports ──
from mcp.server.fastmcp import FastMCP

# ── Local modules ──
from db import (
    init_db,
    create_project, list_projects_meta, get_project_meta, get_project_by_name, update_project, delete_project,
    create_template, list_templates, get_template, get_template_by_name, update_template, delete_template,
)
from auth import router as auth_router, keys_router, get_current_user, require_scope, require_admin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kb-server")

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
MCP_API_KEY = os.getenv("MCP_API_KEY", "")
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
    entry_type: str | None = None,
    tags: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    min_score: float = 0.0,
    limit: int = 5,
) -> list[dict]:
    """Search knowledge base by semantic similarity with advanced filters."""
    vector = embed_text(query)

    must_conditions = []
    if project:
        must_conditions.append(FieldCondition(key="project", match=MatchValue(value=project)))
    if entry_type:
        must_conditions.append(FieldCondition(key="type", match=MatchValue(value=entry_type)))
    if tags:
        must_conditions.append(FieldCondition(key="tags", match=MatchAny(any=tags)))
    if date_from:
        must_conditions.append(FieldCondition(key="created_at", range=Range(gte=date_from)))
    if date_to:
        must_conditions.append(FieldCondition(key="created_at", range=Range(lte=date_to)))

    search_filter = Filter(must=must_conditions) if must_conditions else None

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
        if r.score >= min_score
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


def get_entry_by_id(entry_id: str) -> dict | None:
    """Get a single entry by ID."""
    results = qdrant.retrieve(
        collection_name=COLLECTION_NAME,
        ids=[entry_id],
        with_payload=True,
    )
    if not results:
        return None
    r = results[0]
    return {
        "id": str(r.id),
        "content": r.payload.get("content", ""),
        "project": r.payload.get("project", ""),
        "tags": r.payload.get("tags", []),
        "type": r.payload.get("type", ""),
        "source": r.payload.get("source", ""),
        "created_at": r.payload.get("created_at", ""),
    }


def update_entry(entry_id: str, content: str | None = None, project: str | None = None,
                  tags: list[str] | None = None, entry_type: str | None = None) -> dict | None:
    """Update an existing entry. Re-embeds if content changes."""
    existing = get_entry_by_id(entry_id)
    if not existing:
        return None

    new_content = content if content is not None else existing["content"]
    new_project = project if project is not None else existing["project"]
    new_tags = tags if tags is not None else existing["tags"]
    new_type = entry_type if entry_type is not None else existing["type"]

    # Re-embed if content changed
    if content is not None:
        new_content = scrub_secrets(new_content)
        vector = embed_text(new_content)
    else:
        # Keep existing vector — retrieve it
        points = qdrant.retrieve(collection_name=COLLECTION_NAME, ids=[entry_id], with_vectors=True)
        vector = points[0].vector if points else embed_text(new_content)

    qdrant.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            PointStruct(
                id=entry_id,
                vector=vector,
                payload={
                    "content": new_content,
                    "project": new_project,
                    "tags": new_tags,
                    "type": new_type,
                    "source": existing["source"],
                    "created_at": existing["created_at"],
                },
            )
        ],
    )
    return get_entry_by_id(entry_id)


def bulk_delete_entries(entry_ids: list[str]) -> int:
    """Delete multiple entries. Returns count deleted."""
    qdrant.delete(
        collection_name=COLLECTION_NAME,
        points_selector=entry_ids,
    )
    return len(entry_ids)


def export_entries(project: str | None = None, entry_type: str | None = None) -> list[dict]:
    """Export all entries, optionally filtered."""
    must_conditions = []
    if project:
        must_conditions.append(FieldCondition(key="project", match=MatchValue(value=project)))
    if entry_type:
        must_conditions.append(FieldCondition(key="type", match=MatchValue(value=entry_type)))

    scroll_filter = Filter(must=must_conditions) if must_conditions else None

    all_entries = []
    offset = None
    while True:
        results, offset = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            scroll_filter=scroll_filter,
            with_payload=True,
        )
        if not results:
            break
        for r in results:
            all_entries.append({
                "id": str(r.id),
                "content": r.payload.get("content", ""),
                "project": r.payload.get("project", ""),
                "tags": r.payload.get("tags", []),
                "type": r.payload.get("type", ""),
                "source": r.payload.get("source", ""),
                "created_at": r.payload.get("created_at", ""),
            })
        if offset is None:
            break

    return all_entries


def get_all_tags() -> list[str]:
    """Get all unique tags from entries."""
    tags_set = set()
    offset = None
    while True:
        results, offset = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            offset=offset,
            with_payload=["tags"],
        )
        if not results:
            break
        for r in results:
            for tag in r.payload.get("tags", []):
                tags_set.add(tag)
        if offset is None:
            break
    return sorted(tags_set)


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


@mcp.tool()
def list_templates_tool(category: str | None = None) -> str:
    """List available instruction templates (skills, prompts, system prompts, workflows, etc.).
    
    Args:
        category: Optional filter — 'skill', 'prompt', 'system', 'workflow', 'snippet', or 'other'
    """
    import asyncio
    templates = asyncio.get_event_loop().run_until_complete(list_templates(category=category))
    if not templates:
        return "No templates found."
    # Return summary (name, category, description) without full content for brevity
    summary = [
        {"id": t["id"], "name": t["name"], "category": t["category"],
         "description": t["description"], "tags": t["tags"]}
        for t in templates
    ]
    return json.dumps(summary, indent=2)


@mcp.tool()
def get_template_tool(name: str, category: str | None = None) -> str:
    """Retrieve the full content of an instruction template by name.
    
    Args:
        name: The template name (exact match)
        category: Optional category to disambiguate if multiple templates share a name
    """
    import asyncio
    template = asyncio.get_event_loop().run_until_complete(get_template_by_name(name, category))
    if not template:
        return f"Template '{name}' not found."
    return json.dumps(template, indent=2)


# ──────────────────────────────────────────────
# REST API (port 3001)
# ──────────────────────────────────────────────
@asynccontextmanager
async def rest_lifespan(app: FastAPI):
    await init_db()
    yield

rest_app = FastAPI(title="Knowledge Base REST API", lifespan=rest_lifespan)
rest_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include auth and keys routers
rest_app.include_router(auth_router)
rest_app.include_router(keys_router)


# ── REST Models ──
class StoreRequest(BaseModel):
    content: str
    project: str = "default"
    tags: list[str] = []
    entry_type: str = "session"
    source: str = "rest-api"


class SearchRequest(BaseModel):
    query: str
    project: Optional[str] = None
    entry_type: Optional[str] = None
    tags: Optional[list[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    min_score: float = 0.0
    limit: int = 10


class UpdateEntryRequest(BaseModel):
    content: Optional[str] = None
    project: Optional[str] = None
    tags: Optional[list[str]] = None
    entry_type: Optional[str] = None


class BulkDeleteRequest(BaseModel):
    ids: list[str]


class ImportRequest(BaseModel):
    entries: list[StoreRequest]


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""
    color: str = "#7c6ff7"
    icon: str = "folder"


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class TemplateCreateRequest(BaseModel):
    name: str
    category: str = "prompt"
    content: str
    description: str = ""
    variables: list[str] = []
    tags: list[str] = []


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    variables: Optional[list[str]] = None
    tags: Optional[list[str]] = None


# ── REST Endpoints (all protected by dual auth) ──

@rest_app.post("/api/store")
async def api_store(req: StoreRequest, user: dict = Depends(require_scope("write"))):
    entry_id = store_entry(
        content=req.content,
        project=req.project,
        tags=req.tags,
        entry_type=req.entry_type,
        source=req.source,
    )
    return {"id": entry_id, "status": "stored"}


@rest_app.post("/api/search")
async def api_search(req: SearchRequest, user: dict = Depends(require_scope("read"))):
    results = search_entries(
        query=req.query,
        project=req.project,
        entry_type=req.entry_type,
        tags=req.tags,
        date_from=req.date_from,
        date_to=req.date_to,
        min_score=req.min_score,
        limit=req.limit,
    )
    return {
        "results": results,
        "query": req.query,
        "filters": {
            "project": req.project,
            "entry_type": req.entry_type,
            "tags": req.tags,
            "date_from": req.date_from,
            "date_to": req.date_to,
            "min_score": req.min_score,
        },
        "total_found": len(results),
    }


@rest_app.get("/api/entries/{entry_id}")
async def api_get_entry(entry_id: str, user: dict = Depends(require_scope("read"))):
    entry = get_entry_by_id(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@rest_app.put("/api/entries/{entry_id}")
async def api_update_entry(entry_id: str, req: UpdateEntryRequest, user: dict = Depends(require_scope("write"))):
    updated = update_entry(
        entry_id=entry_id,
        content=req.content,
        project=req.project,
        tags=req.tags,
        entry_type=req.entry_type,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Entry not found")
    return updated


@rest_app.delete("/api/entries/{entry_id}")
async def api_delete_entry(entry_id: str, user: dict = Depends(require_scope("write"))):
    delete_entry(entry_id)
    return {"status": "deleted", "id": entry_id}


@rest_app.post("/api/entries/bulk-delete")
async def api_bulk_delete(req: BulkDeleteRequest, user: dict = Depends(require_scope("write"))):
    count = bulk_delete_entries(req.ids)
    return {"status": "deleted", "count": count}


@rest_app.post("/api/entries/export")
async def api_export(
    project: Optional[str] = Query(None),
    entry_type: Optional[str] = Query(None),
    user: dict = Depends(require_scope("read")),
):
    entries = export_entries(project=project, entry_type=entry_type)
    return {"entries": entries, "count": len(entries)}


@rest_app.post("/api/entries/import")
async def api_import(req: ImportRequest, user: dict = Depends(require_scope("write"))):
    imported_ids = []
    for entry in req.entries:
        entry_id = store_entry(
            content=entry.content,
            project=entry.project,
            tags=entry.tags,
            entry_type=entry.entry_type,
            source=entry.source or "import",
        )
        imported_ids.append(entry_id)
    return {"status": "imported", "count": len(imported_ids), "ids": imported_ids}


@rest_app.get("/api/tags")
async def api_tags(user: dict = Depends(require_scope("read"))):
    return {"tags": get_all_tags()}


# ── Project CRUD (metadata in SQLite, entries in Qdrant) ──

@rest_app.get("/api/projects")
async def api_projects(user: dict = Depends(require_scope("read"))):
    # Merge SQLite metadata with Qdrant entry counts
    meta_projects = await list_projects_meta()
    qdrant_projects = list_projects()  # from Qdrant scroll

    # Build map of entry counts from Qdrant
    entry_map = {p["name"]: p for p in qdrant_projects}

    result = []
    seen_names = set()
    for mp in meta_projects:
        name = mp["name"]
        seen_names.add(name)
        eq = entry_map.get(name, {})
        result.append({
            "id": mp["id"],
            "name": name,
            "description": mp.get("description", ""),
            "color": mp.get("color", "#7c6ff7"),
            "icon": mp.get("icon", "folder"),
            "entry_count": eq.get("count", 0),
            "last_updated": eq.get("last_updated", mp.get("updated_at", "")),
            "created_at": mp.get("created_at", ""),
        })

    # Include Qdrant-only projects (entries exist but no SQLite metadata)
    for qp in qdrant_projects:
        if qp["name"] not in seen_names:
            result.append({
                "id": None,
                "name": qp["name"],
                "description": "",
                "color": "#7c6ff7",
                "icon": "folder",
                "entry_count": qp["count"],
                "last_updated": qp["last_updated"],
                "created_at": "",
            })

    return {"projects": result}


@rest_app.post("/api/projects")
async def api_create_project(req: ProjectCreateRequest, user: dict = Depends(require_scope("write"))):
    existing = await get_project_by_name(req.name)
    if existing:
        raise HTTPException(status_code=409, detail="Project already exists")
    project = await create_project(
        name=req.name,
        description=req.description,
        color=req.color,
        icon=req.icon,
        created_by=user.get("user_id"),
    )
    return project


@rest_app.get("/api/projects/{project_id}")
async def api_get_project(project_id: int, user: dict = Depends(require_scope("read"))):
    project = await get_project_meta(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@rest_app.put("/api/projects/{project_id}")
async def api_update_project(project_id: int, req: ProjectUpdateRequest, user: dict = Depends(require_scope("write"))):
    success = await update_project(
        project_id,
        name=req.name,
        description=req.description,
        color=req.color,
        icon=req.icon,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return await get_project_meta(project_id)


@rest_app.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: int, user: dict = Depends(require_scope("write"))):
    success = await delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted", "id": project_id}


@rest_app.get("/api/projects/{project_id}/stats")
async def api_project_stats(project_id: int, user: dict = Depends(require_scope("read"))):
    project = await get_project_meta(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    entries = export_entries(project=project["name"])
    type_counts = {}
    source_counts = {}
    for e in entries:
        t = e.get("type", "unknown")
        s = e.get("source", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
        source_counts[s] = source_counts.get(s, 0) + 1

    return {
        "project": project["name"],
        "total_entries": len(entries),
        "by_type": type_counts,
        "by_source": source_counts,
    }


@rest_app.get("/api/recent")
async def api_recent(
    project: Optional[str] = None,
    limit: int = 10,
    user: dict = Depends(require_scope("read")),
):
    return {"entries": get_recent_entries(project=project, limit=limit)}


# ── Templates CRUD ──

@rest_app.get("/api/templates")
async def api_list_templates(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: dict = Depends(require_scope("read")),
):
    templates = await list_templates(category=category, search=search)
    return {"templates": templates, "total": len(templates)}


@rest_app.post("/api/templates")
async def api_create_template(req: TemplateCreateRequest, user: dict = Depends(require_scope("write"))):
    existing = await get_template_by_name(req.name, req.category)
    if existing:
        raise HTTPException(status_code=409, detail="A template with this name and category already exists")
    template = await create_template(
        name=req.name,
        category=req.category,
        content=req.content,
        description=req.description,
        variables=req.variables,
        tags=req.tags,
        created_by=user.get("user_id"),
    )
    return template


@rest_app.get("/api/templates/{template_id}")
async def api_get_template(template_id: int, user: dict = Depends(require_scope("read"))):
    template = await get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@rest_app.put("/api/templates/{template_id}")
async def api_update_template(template_id: int, req: TemplateUpdateRequest, user: dict = Depends(require_scope("write"))):
    updated = await update_template(
        template_id,
        name=req.name,
        category=req.category,
        content=req.content,
        description=req.description,
        variables=req.variables,
        tags=req.tags,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Template not found")
    return updated


@rest_app.delete("/api/templates/{template_id}")
async def api_delete_template(template_id: int, user: dict = Depends(require_scope("write"))):
    success = await delete_template(template_id)
    if not success:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"status": "deleted", "id": template_id}


@rest_app.get("/api/entries")
async def api_list_entries(
    project: Optional[str] = Query(None),
    entry_type: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),  # comma-separated
    offset: int = Query(0),
    limit: int = Query(20),
    user: dict = Depends(require_scope("read")),
):
    """List entries with optional filters and pagination."""
    must_conditions = []
    if project:
        must_conditions.append(FieldCondition(key="project", match=MatchValue(value=project)))
    if entry_type:
        must_conditions.append(FieldCondition(key="type", match=MatchValue(value=entry_type)))
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    if tag_list:
        must_conditions.append(FieldCondition(key="tags", match=MatchAny(any=tag_list)))

    scroll_filter = Filter(must=must_conditions) if must_conditions else None

    all_entries = []
    q_offset = None
    while True:
        results, q_offset = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=200,
            offset=q_offset,
            scroll_filter=scroll_filter,
            with_payload=True,
        )
        if not results:
            break
        for r in results:
            all_entries.append({
                "id": str(r.id),
                "content": r.payload.get("content", ""),
                "project": r.payload.get("project", ""),
                "tags": r.payload.get("tags", []),
                "type": r.payload.get("type", ""),
                "source": r.payload.get("source", ""),
                "created_at": r.payload.get("created_at", ""),
            })
        if q_offset is None:
            break

    all_entries.sort(key=lambda x: x["created_at"], reverse=True)
    total = len(all_entries)
    page_entries = all_entries[offset : offset + limit]

    return {"entries": page_entries, "total": total, "offset": offset, "limit": limit}


@rest_app.get("/api/stats")
async def api_stats(user: dict = Depends(require_scope("read"))):
    """Global stats for the dashboard."""
    qdrant_projects = list_projects()
    total_entries = sum(p["count"] for p in qdrant_projects)
    all_tags = get_all_tags()
    return {
        "total_entries": total_entries,
        "total_projects": len(qdrant_projects),
        "total_tags": len(all_tags),
        "projects": qdrant_projects,
    }


# ── Legacy endpoint ──
@rest_app.delete("/api/entry/{entry_id}")
async def api_delete_legacy(entry_id: str, user: dict = Depends(require_scope("write"))):
    delete_entry(entry_id)
    return {"status": "deleted", "id": entry_id}


@rest_app.get("/health")
def health():
    return {"status": "ok", "model": EMBEDDING_MODEL}


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
