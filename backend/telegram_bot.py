"""
EPSA Platform — Telegram Bot Utility
=====================================
Provides:
  - verify_telegram_init_data(raw, bot_token)  → bool
  - parse_telegram_user(raw)                   → dict | None
  - send_telegram_message(chat_id, text, bot_token) → bool
  - extract_telegram_id(raw)                   → str | None

Follows the official Telegram Mini App data-validation spec:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

import hashlib
import hmac
import json
import logging
import time
import urllib.parse

import requests

logger = logging.getLogger("epsa.telegram_bot")

# Maximum age (seconds) for initData auth_date before we reject it.
# 24 hours is safe for Mini Apps that may be left open.
INIT_DATA_MAX_AGE_SECONDS = 86_400  # 24 hours


# ─── Telegram initData Validation ────────────────────────────────────────────

def verify_telegram_init_data(init_data_raw: str, bot_token: str) -> bool:
    """
    Verify Telegram WebApp initData using HMAC-SHA256 with the bot token.

    Steps (per Telegram docs):
      1. Parse the URL-encoded initData string.
      2. Extract the 'hash' field.
      3. Build a sorted key=value string (excluding 'hash').
      4. HMAC-SHA256 the string using HMAC_KEY = HMAC-SHA256("WebAppData", bot_token).
      5. Compare our digest to Telegram's hash.
      6. Check auth_date is not stale (prevents replay attacks).

    Returns True only if ALL checks pass.
    """
    if not init_data_raw or not bot_token:
        logger.warning("[Telegram] verify: missing init_data or bot_token")
        return False

    try:
        params = dict(urllib.parse.parse_qsl(init_data_raw, keep_blank_values=True))
    except Exception as exc:
        logger.warning("[Telegram] verify: failed to parse init_data: %s", exc)
        return False

    telegram_hash = params.pop("hash", None)
    if not telegram_hash:
        logger.warning("[Telegram] verify: no hash field in init_data")
        return False

    # Build the data-check string: sorted key=value pairs joined by \n
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )

    # Secret key = HMAC-SHA256(key="WebAppData", msg=bot_token)
    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    # Our computed hash
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    # Constant-time comparison (prevents timing attacks)
    if not hmac.compare_digest(expected_hash, telegram_hash):
        logger.warning("[Telegram] verify: HMAC mismatch — data may be tampered")
        return False

    # Replay-attack protection: reject stale auth_date
    auth_date_raw = params.get("auth_date", "0")
    try:
        auth_date = int(auth_date_raw)
    except (ValueError, TypeError):
        logger.warning("[Telegram] verify: invalid auth_date: %s", auth_date_raw)
        return False

    age_seconds = int(time.time()) - auth_date
    if age_seconds > INIT_DATA_MAX_AGE_SECONDS:
        logger.warning(
            "[Telegram] verify: auth_date too old (%d seconds ago)", age_seconds
        )
        return False

    return True


def parse_telegram_user(init_data_raw: str) -> dict | None:
    """
    Parse the 'user' JSON object from Telegram initData.

    Returns a dict with keys like: id, username, first_name, last_name, language_code
    Returns None if the user field is missing or malformed.
    """
    if not init_data_raw:
        return None
    try:
        params = dict(urllib.parse.parse_qsl(init_data_raw, keep_blank_values=True))
        user_json = params.get("user")
        if not user_json:
            return None
        return json.loads(user_json)
    except Exception as exc:
        logger.warning("[Telegram] parse_user: failed: %s", exc)
        return None


def extract_telegram_id(init_data_raw: str) -> str | None:
    """
    Convenience: return the string telegram user ID from initData, or None.
    """
    user = parse_telegram_user(init_data_raw)
    if not user:
        return None
    uid = user.get("id")
    return str(uid) if uid else None


# ─── Bot Messaging ────────────────────────────────────────────────────────────

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"


def send_telegram_message(chat_id: int | str, text: str, bot_token: str) -> bool:
    """
    Send a text message to a Telegram user via Bot API.

    IMPORTANT: The user must have started @epsahub_bot (sent /start or any message)
    before the bot can DM them. Otherwise Telegram returns a 403 "bot was blocked"
    or "chat not found" error.

    Returns True on success, False on any error.
    """
    if not bot_token:
        logger.error("[Telegram] send_message: bot_token is not configured")
        return False

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": int(chat_id),
        "text": text,
        "parse_mode": "HTML",
    }
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200 and resp.json().get("ok"):
            logger.info("[Telegram] send_message: sent to chat_id=%s", chat_id)
            return True
        else:
            body = resp.json()
            err_code = body.get("error_code")
            description = body.get("description", "unknown error")
            if err_code == 403:
                logger.warning(
                    "[Telegram] send_message: user %s has not started the bot. "
                    "They must open t.me/epsahub_bot and press Start first. "
                    "Error: %s",
                    chat_id,
                    description,
                )
            else:
                logger.warning(
                    "[Telegram] send_message: API error %s for chat_id=%s: %s",
                    err_code,
                    chat_id,
                    description,
                )
            return False
    except requests.exceptions.Timeout:
        logger.error("[Telegram] send_message: request timed out for chat_id=%s", chat_id)
        return False
    except requests.exceptions.RequestException as exc:
        logger.error("[Telegram] send_message: request failed: %s", exc)
        return False


def build_otp_message(otp_code: str, first_name: str = "") -> str:
    """
    Build the OTP message text sent to the student via Telegram.
    """
    greeting = f"Hi {first_name}! " if first_name else ""
    return (
        f"🔐 <b>EPSA Verification Code</b>\n\n"
        f"{greeting}Your one-time login code is:\n\n"
        f"<b>{otp_code}</b>\n\n"
        f"⏱ This code expires in <b>5 minutes</b>.\n"
        f"Do not share it with anyone."
    )
