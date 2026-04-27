import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import current_app, jsonify, request

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def plus_interval(*, days=0, hours=0, minutes=0, seconds=0):
    return utcnow() + timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)


def hash_token(token):
    secret = current_app.config.get("SECRET_KEY", "")
    return hmac.new(secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def issue_one_time_token(db, *, subject, purpose, ttl_seconds, metadata=None):
    token = secrets.token_urlsafe(32)
    db.execute(
        """
        INSERT INTO auth_tokens (subject, purpose, token_hash, expires_at, metadata)
        VALUES (?,?,?,?,?)
        """,
        (subject, purpose, hash_token(token), plus_interval(seconds=ttl_seconds), json.dumps(metadata or {})),
    )
    return token


def consume_one_time_token(db, *, token, purpose, subject=None):
    token_hash = hash_token(token)
    params = [purpose, token_hash]
    sql = """
        SELECT *
        FROM auth_tokens
        WHERE purpose=? AND token_hash=? AND used_at IS NULL AND expires_at > ?
    """
    params.append(utcnow())
    if subject is not None:
        sql += " AND subject=?"
        params.append(subject)
    sql += " ORDER BY id DESC LIMIT 1"
    row = db.execute(sql, tuple(params)).fetchone()
    if not row:
        return None
    db.execute("UPDATE auth_tokens SET used_at=? WHERE id=?", (utcnow(), row["id"]))
    return row


def verify_totp_code(secret, code):
    cleaned = str(code or "").strip().replace(" ", "")
    if len(cleaned) != 6 or not cleaned.isdigit():
        return False
    try:
        import pyotp
    except Exception:
        return False
    try:
        return bool(pyotp.TOTP(secret).verify(cleaned, valid_window=1))
    except Exception:
        return False


def _coerce_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value).replace("Z", ""))
    except Exception:
        return None


def _rate_limit_key(scope, key_value):
    return f"{scope}:{key_value}"


def enforce_rate_limit(scope, *, limit, window_seconds, key_value):
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return None

    try:
        from .models import get_db
    except ImportError:
        from models import get_db

    bucket = _rate_limit_key(scope, key_value or "unknown")
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM rate_limit_state WHERE bucket_key=?",
            (bucket,),
        ).fetchone()
        now = utcnow()
        window_starts_at = _coerce_datetime(row["window_starts_at"]) if row else None
        if not row or not window_starts_at or window_starts_at <= now - timedelta(seconds=window_seconds):
            if row:
                db.execute(
                    """
                    UPDATE rate_limit_state
                    SET request_count=1, window_starts_at=?, updated_at=?
                    WHERE id=?
                    """,
                    (now, now, row["id"]),
                )
            else:
                db.execute(
                    """
                    INSERT INTO rate_limit_state (bucket_key, request_count, window_starts_at, updated_at)
                    VALUES (?,?,?,?)
                    """,
                    (bucket, 1, now, now),
                )
            db.commit()
            return None

        if int(row["request_count"] or 0) >= limit:
            retry_after = max(
                1,
                int(((window_starts_at + timedelta(seconds=window_seconds)) - now).total_seconds()),
            )
            return (
                jsonify(
                    {
                        "error": "Too many requests. Please slow down and try again shortly.",
                        "retry_after_seconds": retry_after,
                    }
                ),
                429,
            )

        db.execute(
            """
            UPDATE rate_limit_state
            SET request_count=?, updated_at=?
            WHERE id=?
            """,
            (int(row["request_count"] or 0) + 1, now, row["id"]),
        )
        db.commit()
        return None
    finally:
        db.close()


def rate_limit(scope, *, limit, window_seconds, key_func=None):
    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            ip_address = forwarded or request.remote_addr or "unknown"
            key_value = key_func() if callable(key_func) else ip_address
            limited = enforce_rate_limit(
                scope,
                limit=limit,
                window_seconds=window_seconds,
                key_value=key_value or ip_address,
            )
            if limited:
                return limited
            return func(*args, **kwargs)

        return wrapped

    return decorator
