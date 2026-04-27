"""
EPSA Email Delivery Service
"""

import logging
import time

import requests

try:
    from .config import get_settings
except ImportError:
    from config import get_settings

logger = logging.getLogger("epsa.email")

RESEND_API_URL = "https://api.resend.com/emails"
_MAX_RETRIES = 3
_RETRY_DELAYS = [1, 2, 4]


def _mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not local or not domain:
        return "redacted"
    visible = local[:2] if len(local) > 1 else local[:1]
    return f"{visible}***@{domain}"


def _send_via_resend(settings, to_email: str, subject: str, body_html: str) -> bool:
    api_key = settings.resend_api_key
    from_email = settings.resend_from_email

    if not api_key:
        logger.error("[Email] Resend API key is not configured.")
        return False
    if not from_email:
        logger.error("[Email] Resend from-address is not configured.")
        return False

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": body_html,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    last_error = None
    masked_email = _mask_email(to_email)
    for attempt in range(_MAX_RETRIES):
        try:
            resp = requests.post(
                RESEND_API_URL,
                headers=headers,
                json=payload,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                logger.info(
                    "[Email OK] Resend delivered to %s (id=%s)",
                    masked_email,
                    data.get("id", "unknown"),
                )
                return True

            if 400 <= resp.status_code < 500:
                logger.error(
                    "[Email Error] Resend permanent failure for %s: HTTP %s",
                    masked_email,
                    resp.status_code,
                )
                return False

            last_error = f"HTTP {resp.status_code}"
            logger.warning(
                "[Email Warning] Resend attempt %s/%s failed for %s: %s",
                attempt + 1,
                _MAX_RETRIES,
                masked_email,
                last_error,
            )
        except requests.exceptions.Timeout:
            last_error = "timeout"
            logger.warning(
                "[Email Warning] Resend attempt %s/%s timed out for %s",
                attempt + 1,
                _MAX_RETRIES,
                masked_email,
            )
        except requests.exceptions.ConnectionError:
            last_error = "connection_error"
            logger.warning(
                "[Email Warning] Resend attempt %s/%s connection error for %s",
                attempt + 1,
                _MAX_RETRIES,
                masked_email,
            )
        except Exception as exc:
            logger.error("[Email Error] Resend unexpected error for %s: %s", masked_email, exc)
            return False

        if attempt < _MAX_RETRIES - 1:
            time.sleep(_RETRY_DELAYS[attempt])

    logger.error(
        "[Email Error] Resend failed all %s attempts for %s. Last error: %s",
        _MAX_RETRIES,
        masked_email,
        last_error,
    )
    return False


def send_email(to_email: str, subject: str, body_html: str) -> bool:
    if not to_email or not subject:
        logger.error("[Email] send_email called with empty to_email or subject.")
        return False
    return _send_via_resend(get_settings(), to_email, subject, body_html)
