"""
SQLite database module for users, API keys, and project metadata.
Uses aiosqlite for async operations.
"""

import os
import hashlib
import secrets
import aiosqlite
import logging
import bcrypt
from datetime import datetime, timezone

logger = logging.getLogger("kb-server")

DB_PATH = os.getenv("SQLITE_DB_PATH", "/app/data/memory.db")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def generate_api_key() -> str:
    return secrets.token_hex(32)


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Create tables if they don't exist and seed admin user."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                key_hash TEXT UNIQUE NOT NULL,
                key_prefix TEXT NOT NULL,
                scopes TEXT NOT NULL DEFAULT '["read","write"]',
                expires_at TEXT,
                last_used_at TEXT,
                revoked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                color TEXT DEFAULT '#7c6ff7',
                icon TEXT DEFAULT 'folder',
                created_by INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'prompt',
                description TEXT DEFAULT '',
                content TEXT NOT NULL,
                variables TEXT DEFAULT '[]',
                tags TEXT DEFAULT '[]',
                created_by INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name_category ON templates(name, category);
        """)

        # Seed admin user if configured and not already present
        admin_user = os.getenv("ADMIN_USERNAME", "")
        admin_pass = os.getenv("ADMIN_PASSWORD", "")

        if admin_user and admin_pass:
            cursor = await db.execute(
                "SELECT id FROM users WHERE username = ?", (admin_user,)
            )
            existing = await cursor.fetchone()
            if not existing:
                now = datetime.now(timezone.utc).isoformat()
                await db.execute(
                    "INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (admin_user, f"{admin_user}@local", hash_password(admin_pass), "admin", now, now),
                )
                logger.info(f"Created admin user: {admin_user}")

        await db.commit()
    finally:
        await db.close()


# ── User operations ──

async def create_user(username: str, email: str, password: str, role: str = "user") -> dict:
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (username, email, hash_password(password), role, now, now),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "username": username, "email": email, "role": role}
    finally:
        await db.close()


async def get_user_by_username(username: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_user_by_id(user_id: int) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_user_password(user_id: int, new_password: str):
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(new_password), now, user_id),
        )
        await db.commit()
    finally:
        await db.close()


async def list_users() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, username, email, role, created_at FROM users ORDER BY created_at")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── API Key operations ──

async def create_api_key(user_id: int, name: str, scopes: list[str], expires_at: str | None = None) -> tuple[str, dict]:
    """Create a new API key. Returns (raw_key, key_record)."""
    import json
    raw_key = generate_api_key()
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, name, hash_api_key(raw_key), raw_key[:8], json.dumps(scopes), expires_at, now),
        )
        await db.commit()
        return raw_key, {
            "id": cursor.lastrowid,
            "name": name,
            "key_prefix": raw_key[:8],
            "scopes": scopes,
            "expires_at": expires_at,
            "created_at": now,
        }
    finally:
        await db.close()


async def list_api_keys(user_id: int) -> list[dict]:
    import json
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, name, key_prefix, scopes, expires_at, last_used_at, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["scopes"] = json.loads(d["scopes"])
            result.append(d)
        return result
    finally:
        await db.close()


async def verify_api_key_from_db(raw_key: str) -> dict | None:
    """Verify an API key and return the associated user. Updates last_used_at."""
    import json
    key_h = hash_api_key(raw_key)
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT ak.id as key_id, ak.user_id, ak.scopes, ak.expires_at, ak.revoked, u.username, u.role FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ?",
            (key_h,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        row = dict(row)
        if row["revoked"]:
            return None
        if row["expires_at"]:
            exp = datetime.fromisoformat(row["expires_at"])
            if exp < datetime.now(timezone.utc):
                return None
        # Update last_used_at
        now = datetime.now(timezone.utc).isoformat()
        await db.execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", (now, row["key_id"]))
        await db.commit()
        return {
            "user_id": row["user_id"],
            "username": row["username"],
            "role": row["role"],
            "scopes": json.loads(row["scopes"]),
        }
    finally:
        await db.close()


async def revoke_api_key(key_id: int, user_id: int) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute(
            "UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?", (key_id, user_id)
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def update_api_key(key_id: int, user_id: int, name: str | None = None, scopes: list[str] | None = None, expires_at: str | None = None) -> bool:
    import json
    db = await get_db()
    try:
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if scopes is not None:
            updates.append("scopes = ?")
            params.append(json.dumps(scopes))
        if expires_at is not None:
            updates.append("expires_at = ?")
            params.append(expires_at)
        if not updates:
            return False
        params.extend([key_id, user_id])
        cursor = await db.execute(
            f"UPDATE api_keys SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Project metadata operations ──

async def create_project(name: str, description: str = "", color: str = "#7c6ff7", icon: str = "folder", created_by: int | None = None) -> dict:
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "INSERT INTO projects (name, description, color, icon, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, description, color, icon, created_by, now, now),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": name, "description": description, "color": color, "icon": icon, "created_at": now}
    finally:
        await db.close()


async def list_projects_meta() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM projects ORDER BY name")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_project_meta(project_id: int) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_project_by_name(name: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM projects WHERE name = ?", (name,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_project(project_id: int, **kwargs) -> bool:
    db = await get_db()
    try:
        allowed = {"name", "description", "color", "icon"}
        updates = []
        params = []
        for k, v in kwargs.items():
            if k in allowed and v is not None:
                updates.append(f"{k} = ?")
                params.append(v)
        if not updates:
            return False
        updates.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(project_id)
        cursor = await db.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", params
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def delete_project(project_id: int) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── Template operations ──

async def create_template(
    name: str,
    category: str,
    content: str,
    description: str = "",
    variables: list[str] | None = None,
    tags: list[str] | None = None,
    created_by: int | None = None,
) -> dict:
    import json
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "INSERT INTO templates (name, category, content, description, variables, tags, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, category, content, description, json.dumps(variables or []), json.dumps(tags or []), created_by, now, now),
        )
        await db.commit()
        return {
            "id": cursor.lastrowid, "name": name, "category": category,
            "content": content, "description": description,
            "variables": variables or [], "tags": tags or [],
            "created_at": now, "updated_at": now,
        }
    finally:
        await db.close()


async def list_templates(category: str | None = None, search: str | None = None) -> list[dict]:
    import json
    db = await get_db()
    try:
        if category and search:
            cursor = await db.execute(
                "SELECT * FROM templates WHERE category = ? AND (name LIKE ? OR description LIKE ? OR content LIKE ?) ORDER BY category, name",
                (category, f"%{search}%", f"%{search}%", f"%{search}%"),
            )
        elif category:
            cursor = await db.execute(
                "SELECT * FROM templates WHERE category = ? ORDER BY name", (category,)
            )
        elif search:
            cursor = await db.execute(
                "SELECT * FROM templates WHERE name LIKE ? OR description LIKE ? OR content LIKE ? ORDER BY category, name",
                (f"%{search}%", f"%{search}%", f"%{search}%"),
            )
        else:
            cursor = await db.execute("SELECT * FROM templates ORDER BY category, name")
        rows = await cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["variables"] = json.loads(d["variables"])
            d["tags"] = json.loads(d["tags"])
            result.append(d)
        return result
    finally:
        await db.close()


async def get_template(template_id: int) -> dict | None:
    import json
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM templates WHERE id = ?", (template_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["variables"] = json.loads(d["variables"])
        d["tags"] = json.loads(d["tags"])
        return d
    finally:
        await db.close()


async def get_template_by_name(name: str, category: str | None = None) -> dict | None:
    import json
    db = await get_db()
    try:
        if category:
            cursor = await db.execute(
                "SELECT * FROM templates WHERE name = ? AND category = ?", (name, category)
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM templates WHERE name = ? ORDER BY created_at LIMIT 1", (name,)
            )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["variables"] = json.loads(d["variables"])
        d["tags"] = json.loads(d["tags"])
        return d
    finally:
        await db.close()


async def update_template(
    template_id: int,
    name: str | None = None,
    category: str | None = None,
    content: str | None = None,
    description: str | None = None,
    variables: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict | None:
    import json
    db = await get_db()
    try:
        allowed = {"name": name, "category": category, "content": content, "description": description}
        updates = []
        params = []
        for k, v in allowed.items():
            if v is not None:
                updates.append(f"{k} = ?")
                params.append(v)
        if variables is not None:
            updates.append("variables = ?")
            params.append(json.dumps(variables))
        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags))
        if not updates:
            return await get_template(template_id)
        updates.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(template_id)
        await db.execute(
            f"UPDATE templates SET {', '.join(updates)} WHERE id = ?", params
        )
        await db.commit()
        return await get_template(template_id)
    finally:
        await db.close()


async def delete_template(template_id: int) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM templates WHERE id = ?", (template_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()
