"""
JWT authentication module for the REST API.
Supports dual auth: JWT tokens (for humans) and API keys (for machines).
"""

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException, Depends, APIRouter
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from jose import jwt, JWTError

from db import (
    get_user_by_username,
    get_user_by_id,
    create_user,
    update_user_password,
    list_users,
    verify_password,
    verify_api_key_from_db,
    create_api_key,
    list_api_keys,
    revoke_api_key,
    update_api_key,
)

logger = logging.getLogger("kb-server")

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 30
ALLOW_REGISTRATION = os.getenv("ALLOW_REGISTRATION", "false").lower() == "true"
REST_API_KEY = os.getenv("REST_API_KEY", "")
MCP_API_KEY = os.getenv("MCP_API_KEY", "")

security = HTTPBearer()

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Models ──

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class CreateKeyRequest(BaseModel):
    name: str
    scopes: list[str] = ["read", "write"]
    expires_at: Optional[str] = None


class UpdateKeyRequest(BaseModel):
    name: Optional[str] = None
    scopes: Optional[list[str]] = None
    expires_at: Optional[str] = None


# ── Token helpers ──

def create_access_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "username": username, "role": role, "exp": expire, "type": "access"},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def create_refresh_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "refresh"},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ── Dual auth dependency ──

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Authenticate via JWT token, user API key, or legacy REST_API_KEY."""
    token = credentials.credentials

    # Check legacy keys (REST_API_KEY and MCP_API_KEY both grant full access)
    if (REST_API_KEY and token == REST_API_KEY) or (MCP_API_KEY and token == MCP_API_KEY):
        return {"user_id": 0, "username": "legacy-api", "role": "admin", "scopes": ["read", "write", "admin"]}

    # Try JWT
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") == "access":
            return {
                "user_id": int(payload["sub"]),
                "username": payload["username"],
                "role": payload["role"],
                "scopes": ["read", "write", "admin"] if payload["role"] == "admin" else ["read", "write"],
            }
    except JWTError:
        pass

    # Try user API key
    key_user = await verify_api_key_from_db(token)
    if key_user:
        return key_user

    raise HTTPException(status_code=401, detail="Invalid credentials")


def require_scope(scope: str):
    """Dependency that checks if current user has the required scope."""
    async def checker(user: dict = Depends(get_current_user)):
        if scope not in user.get("scopes", []):
            raise HTTPException(status_code=403, detail=f"Missing required scope: {scope}")
        return user
    return checker


def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Auth endpoints ──

@router.post("/login")
async def login(req: LoginRequest):
    user = await get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    access_token = create_access_token(user["id"], user["username"], user["role"])
    refresh_token = create_refresh_token(user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "role": user["role"],
        },
    }


@router.post("/refresh")
async def refresh(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = await get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    access_token = create_access_token(user["id"], user["username"], user["role"])
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/register")
async def register(req: RegisterRequest):
    if not ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration is disabled")

    existing = await get_user_by_username(req.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    user = await create_user(req.username, req.email, req.password)
    access_token = create_access_token(user["id"], user["username"], user["role"])
    refresh_token = create_refresh_token(user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user,
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        return {"id": 0, "username": "legacy-api", "role": "admin"}
    full_user = await get_user_by_id(user["user_id"])
    if not full_user:
        raise HTTPException(status_code=404, detail="User not found")
    return full_user


@router.put("/password")
async def change_password(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        raise HTTPException(status_code=400, detail="Cannot change password for legacy API key auth")
    full_user = await get_user_by_username(user["username"])
    if not full_user or not verify_password(req.current_password, full_user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await update_user_password(user["user_id"], req.new_password)
    return {"status": "password_updated"}


@router.get("/verify")
async def verify_token(user: dict = Depends(get_current_user)):
    """Token/key verification endpoint for Caddy forward_auth.
    Returns 200 with user info if valid, 401 otherwise.
    """
    return {"user_id": user["user_id"], "username": user["username"], "role": user["role"]}


@router.get("/users")
async def get_users(user: dict = Depends(require_admin)):
    return {"users": await list_users()}


@router.post("/users")
async def admin_create_user(req: RegisterRequest, user: dict = Depends(require_admin)):
    existing = await get_user_by_username(req.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    new_user = await create_user(req.username, req.email, req.password)
    return new_user


# ── API Key management endpoints ──

keys_router = APIRouter(prefix="/api/keys", tags=["keys"])


@keys_router.get("")
async def get_keys(user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        return {"keys": []}
    return {"keys": await list_api_keys(user["user_id"])}


@keys_router.post("")
async def create_key(req: CreateKeyRequest, user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        raise HTTPException(status_code=400, detail="Cannot create keys for legacy API key auth")
    valid_scopes = {"read", "write", "admin"}
    for s in req.scopes:
        if s not in valid_scopes:
            raise HTTPException(status_code=400, detail=f"Invalid scope: {s}")
    if "admin" in req.scopes and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create keys with admin scope")

    raw_key, key_record = await create_api_key(
        user_id=user["user_id"],
        name=req.name,
        scopes=req.scopes,
        expires_at=req.expires_at,
    )
    return {"key": raw_key, **key_record}


@keys_router.delete("/{key_id}")
async def delete_key(key_id: int, user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        raise HTTPException(status_code=400, detail="Cannot manage keys for legacy API key auth")
    success = await revoke_api_key(key_id, user["user_id"])
    if not success:
        raise HTTPException(status_code=404, detail="Key not found or already revoked")
    return {"status": "revoked", "id": key_id}


@keys_router.put("/{key_id}")
async def edit_key(key_id: int, req: UpdateKeyRequest, user: dict = Depends(get_current_user)):
    if user["user_id"] == 0:
        raise HTTPException(status_code=400, detail="Cannot manage keys for legacy API key auth")
    if req.scopes:
        valid_scopes = {"read", "write", "admin"}
        for s in req.scopes:
            if s not in valid_scopes:
                raise HTTPException(status_code=400, detail=f"Invalid scope: {s}")
        if "admin" in req.scopes and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only admins can assign admin scope")

    success = await update_api_key(
        key_id=key_id,
        user_id=user["user_id"],
        name=req.name,
        scopes=req.scopes,
        expires_at=req.expires_at,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"status": "updated", "id": key_id}
