"""PhoVoice AI — Authentication, Rate Limiting, and Quota Management.
Supports JWT tokens, API Keys, and Role-Based Quota tracking.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("phovoice.auth")

SECRET_KEY = os.environ.get("PHOVOICE_SECRET_KEY", "phovoice-vps-super-secret-key-change-in-production-2026")
JWT_ALGORITHM = "HS256"
DEFAULT_TOKEN_EXPIRE_HOURS = int(os.environ.get("PHOVOICE_TOKEN_EXPIRE_HOURS", "720"))  # 30 days

# Plan Quotas (in minutes per month) and Rate limits (requests per minute)
PLAN_QUOTAS = {
    "free": {"monthly_minutes": 60, "rate_limit_rpm": 15},
    "teacher": {"monthly_minutes": 500, "rate_limit_rpm": 60},
    "admin": {"monthly_minutes": 999999, "rate_limit_rpm": 120},
    "unlimited": {"monthly_minutes": 999999, "rate_limit_rpm": 120},
}


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _b64decode(data: str) -> bytes:
    padding = 4 - (len(data) % 4)
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data.encode("utf-8"))


def create_jwt_token(payload: Dict[str, Any], expires_in_seconds: Optional[int] = None) -> str:
    """Generate HS256 JWT token using standard Python libraries."""
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))

    exp = int(time.time()) + (expires_in_seconds or (DEFAULT_TOKEN_EXPIRE_HOURS * 3600))
    token_payload = {**payload, "exp": exp, "iat": int(time.time())}
    payload_b64 = _b64encode(json.dumps(token_payload, separators=(",", ":")).encode("utf-8"))

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_jwt_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify JWT signature and expiration."""
    try:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()
        actual_sig = _b64decode(sig_b64)

        if not hmac.compare_digest(expected_sig, actual_sig):
            logger.warning("Invalid JWT signature")
            return None

        payload = json.loads(_b64decode(payload_b64).decode("utf-8"))
        if "exp" in payload and payload["exp"] < time.time():
            logger.info("JWT token expired")
            return None

        return payload
    except Exception as e:
        logger.warning(f"Error decoding JWT token: {e}")
        return None


class AuthManager:
    """Manages users, tokens, quotas and rate limiting via SQLite."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._request_timestamps: Dict[str, list] = {}
        self.init_auth_tables()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_auth_tables(self):
        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                password_hash TEXT,
                api_key TEXT UNIQUE,
                plan TEXT DEFAULT 'free',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                month_year TEXT,
                used_audio_seconds REAL DEFAULT 0,
                request_count INTEGER DEFAULT 0,
                last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, month_year)
            )
        """)
        # Create default admin user and anonymous user if not existing
        cur.execute("SELECT id FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            admin_id = "user_admin_001"
            admin_key = os.environ.get("PHOVOICE_ADMIN_KEY", f"pv_{secrets.token_hex(16)}")
            cur.execute("""
                INSERT INTO users (id, username, password_hash, api_key, plan, is_active)
                VALUES (?, 'admin', ?, ?, 'admin', 1)
            """, (admin_id, hashlib.sha256(b"admin123").hexdigest(), admin_key))
            logger.info(f"🔑 Initialized default admin with API Key: {admin_key}")

        conn.commit()
        conn.close()

    def authenticate_token(self, token_or_key: str) -> Optional[Dict[str, Any]]:
        """Authenticate either JWT Bearer token or static API Key (pv_...)."""
        if not token_or_key:
            return None

        # 1. Try API Key lookup
        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, username, plan, is_active FROM users WHERE api_key = ?", (token_or_key,))
        row = cur.fetchone()
        conn.close()

        if row:
            if not row["is_active"]:
                return None
            return {"user_id": row["id"], "username": row["username"], "plan": row["plan"]}

        # 2. Try JWT decode
        payload = decode_jwt_token(token_or_key)
        if payload and "user_id" in payload:
            user_id = payload["user_id"]
            plan = payload.get("plan", "free")
            username = payload.get("username", "user")
            return {"user_id": user_id, "username": username, "plan": plan}

        return None

    def check_rate_limit(self, user_id: str, plan: str) -> bool:
        """Rate limit per user per minute (Sliding window)."""
        rpm_limit = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])["rate_limit_rpm"]
        now = time.time()
        window = 60.0  # 1 minute

        if user_id not in self._request_timestamps:
            self._request_timestamps[user_id] = []

        timestamps = [t for t in self._request_timestamps[user_id] if now - t < window]
        if len(timestamps) >= rpm_limit:
            return False

        timestamps.append(now)
        self._request_timestamps[user_id] = timestamps
        return True

    def check_and_deduct_quota(self, user_id: str, plan: str, audio_duration_s: float) -> Tuple[bool, float, float]:
        """Check if user has sufficient quota for audio_duration_s. Returns (allowed, used_minutes, max_minutes)."""
        month_year = time.strftime("%Y-%m")
        max_minutes = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])["monthly_minutes"]

        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT used_audio_seconds FROM usage_records
            WHERE user_id = ? AND month_year = ?
        """, (user_id, month_year))
        row = cur.fetchone()

        current_used_s = row["used_audio_seconds"] if row else 0.0
        new_total_s = current_used_s + audio_duration_s
        new_total_min = new_total_s / 60.0

        if new_total_min > max_minutes and plan != "admin":
            conn.close()
            return False, round(current_used_s / 60.0, 2), max_minutes

        # Deduct / Update quota
        cur.execute("""
            INSERT INTO usage_records (user_id, month_year, used_audio_seconds, request_count, last_used_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, month_year) DO UPDATE SET
                used_audio_seconds = used_audio_seconds + excluded.used_audio_seconds,
                request_count = request_count + 1,
                last_used_at = CURRENT_TIMESTAMP
        """, (user_id, month_year, audio_duration_s))

        conn.commit()
        conn.close()
        return True, round(new_total_min, 2), max_minutes

    def get_user_usage(self, user_id: str, plan: str) -> Dict[str, Any]:
        """Get monthly usage stats for a user."""
        month_year = time.strftime("%Y-%m")
        max_minutes = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])["monthly_minutes"]

        conn = self._get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT used_audio_seconds, request_count FROM usage_records
            WHERE user_id = ? AND month_year = ?
        """, (user_id, month_year))
        row = cur.fetchone()
        conn.close()

        used_s = row["used_audio_seconds"] if row else 0.0
        used_min = round(used_s / 60.0, 2)
        request_count = row["request_count"] if row else 0

        return {
            "user_id": user_id,
            "plan": plan,
            "month": month_year,
            "used_audio_minutes": used_min,
            "quota_monthly_minutes": max_minutes,
            "remaining_minutes": max(0.0, round(max_minutes - used_min, 2)),
            "request_count": request_count,
        }
