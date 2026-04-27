"""
EPSA Email Delivery Service
============================
Primary: Resend API (HTTPS, works on Railway/Render/Heroku)
Fallback: SMTP (works on VPS/local only; blocked on most cloud platforms)

Why Resend vs SMTP:
- Railway blocks outbound SMTP ports (25, 465, 587) to prevent spam.
- Resend sends over HTTPS (port 443), which is never blocked.
- Resend provides delivery receipts, open tracking, and a generous free tier.

Setup:
  1. Create free account at https://resend.com
  2. Get API key from https://resend.com/api-keys
  3. For testing: use "onboarding@resend.dev" as from_email (sends to verified emails only)
  4. For production: add and verify your own domain → use noreply@yourdomain.com

Railway env vars to set:
  EPSA_EMAIL_PROVIDER=resend
  EPSA_RESEND_API_KEY=re_xxxxxxxxxxxx
  EPSA_RESEND_FROM_EMAIL=noreply@yourdomain.com   (or onboarding@resend.dev for testing)
"""

import ssl
import smtplib
import time
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests

try:
    from .config import get_settings
except ImportError:
    from config import get_settings

logger = logging.getLogger("epsa.email")

# ---------------------------------------------------------------------------
# Resend API sender (primary — works on Railway, Heroku, Render, Vercel, etc.)
# ---------------------------------------------------------------------------

RESEND_API_URL = "https://api.resend.com/emails"
_MAX_RETRIES = 3
_RETRY_DELAYS = [1, 2, 4]  # exponential back-off in seconds


def _send_via_resend(settings, to_email: str, subject: str, body_html: str) -> bool:
    """Send via Resend HTTP API. Retries up to 3 times on transient failures."""
    api_key = settings.resend_api_key
    from_email = settings.resend_from_email

    if not api_key:
        logger.error(
            "[Email] Resend selected but EPSA_RESEND_API_KEY is not set. "
            "Get a free key at https://resend.com/api-keys and add it to Railway."
        )
        return False
    if not from_email:
        logger.error(
            "[Email] EPSA_RESEND_FROM_EMAIL is not set. "
            "Use 'onboarding@resend.dev' for testing or your verified domain address."
        )
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
    for attempt in range(_MAX_RETRIES):
        try:
            resp = requests.post(
                RESEND_API_URL,
                headers=headers,
                json=payload,
                timeout=15,
            )

            # 200/201 = success
            if resp.status_code in (200, 201):
                data = resp.json()
                msg_id = data.get("id", "unknown")
                logger.info(f"[Email OK] Resend delivered to {to_email} (id={msg_id})")
                return True

            # 4xx = permanent failure (bad key, bad domain, invalid address)
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = resp.text
                logger.error(
                    f"[Email Error] Resend permanent failure for {to_email}: "
                    f"HTTP {resp.status_code} → {err_body}"
                )
                return False  # no point retrying

            # 5xx = transient server error → retry
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            logger.warning(
                f"[Email Warning] Resend attempt {attempt + 1}/{_MAX_RETRIES} "
                f"failed for {to_email}: {last_error}"
            )

        except requests.exceptions.Timeout:
            last_error = "Request timed out"
            logger.warning(
                f"[Email Warning] Resend attempt {attempt + 1}/{_MAX_RETRIES} "
                f"timed out for {to_email}"
            )
        except requests.exceptions.ConnectionError as exc:
            last_error = str(exc)
            logger.warning(
                f"[Email Warning] Resend attempt {attempt + 1}/{_MAX_RETRIES} "
                f"connection error for {to_email}: {exc}"
            )
        except Exception as exc:
            last_error = str(exc)
            logger.error(f"[Email Error] Resend unexpected error for {to_email}: {exc}")
            return False  # unknown error — don't retry

        # Wait before retry (skip wait on last attempt)
        if attempt < _MAX_RETRIES - 1:
            time.sleep(_RETRY_DELAYS[attempt])

    logger.error(
        f"[Email Error] Resend failed all {_MAX_RETRIES} attempts for {to_email}. "
        f"Last error: {last_error}"
    )
    return False


# ---------------------------------------------------------------------------
# SMTP sender (fallback — only works on VPS/local, blocked on Railway)
# ---------------------------------------------------------------------------

def _build_mime_message(smtp_email: str, from_name: str, to_email: str,
                        subject: str, body_html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{smtp_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(body_html, "html", "utf-8"))
    return msg


def _try_smtp_ssl(host, port, smtp_email, smtp_password, to_email, msg) -> bool:
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as server:
        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, [to_email], msg.as_string())
    logger.info(f"[Email OK] SMTP SSL:{port} delivered to {to_email}")
    return True


def _try_smtp_starttls(host, port, smtp_email, smtp_password, to_email, msg) -> bool:
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, [to_email], msg.as_string())
    logger.info(f"[Email OK] SMTP STARTTLS:{port} delivered to {to_email}")
    return True


def _send_via_smtp(settings, to_email: str, subject: str, body_html: str) -> bool:
    """SMTP fallback. Note: outbound SMTP is blocked on Railway/Heroku/Render."""
    smtp_email = settings.smtp_email
    smtp_password = settings.smtp_password

    if not smtp_email or not smtp_password:
        logger.error(
            "[Email] SMTP credentials not set (EPSA_SMTP_EMAIL / EPSA_SMTP_PASSWORD). "
            "⚠️  Note: SMTP is blocked on Railway — use Resend instead."
        )
        return False

    host = settings.smtp_server or "smtp.gmail.com"
    port = settings.smtp_port or 465
    from_name = settings.smtp_from_name or "EPSA Digital Platform"
    msg = _build_mime_message(smtp_email, from_name, to_email, subject, body_html)

    fallback_port = 587 if port == 465 else 465
    for try_port, try_fn in [
        (port,         _try_smtp_ssl if port == 465 else _try_smtp_starttls),
        (fallback_port, _try_smtp_ssl if fallback_port == 465 else _try_smtp_starttls),
    ]:
        try:
            return try_fn(host, try_port, smtp_email, smtp_password, to_email, msg)
        except Exception as exc:
            logger.warning(f"[Email Warning] SMTP port {try_port} failed: {exc}")

    logger.error(
        f"[Email Error] SMTP all ports failed for {to_email}. "
        "This is expected on Railway (ports blocked). Switch to Resend."
    )
    return False


# ---------------------------------------------------------------------------
# Public API — the only function callers should use
# ---------------------------------------------------------------------------

def send_email(to_email: str, subject: str, body_html: str) -> bool:
    """
    Send an email. Returns True on success, False on failure.

    Provider selection (set EPSA_EMAIL_PROVIDER on Railway):
      "resend" → Resend API  (recommended for Railway/cloud)
      "smtp"   → SMTP        (only for VPS/local — BLOCKED on Railway)

    For Railway production: always set EPSA_EMAIL_PROVIDER=resend
    """
    if not to_email or not subject:
        logger.error("[Email] send_email called with empty to_email or subject.")
        return False

    settings = get_settings()
    provider = (settings.email_provider or "resend").lower().strip()

    if provider == "resend":
        success = _send_via_resend(settings, to_email, subject, body_html)
        if not success:
            # Attempt SMTP as last-resort fallback (will fail on Railway but logs the reason)
            logger.warning("[Email] Resend failed. Attempting SMTP fallback...")
            success = _send_via_smtp(settings, to_email, subject, body_html)
        return success

    if provider == "smtp":
        success = _send_via_smtp(settings, to_email, subject, body_html)
        if not success:
            # Attempt Resend as fallback if configured
            if settings.resend_api_key:
                logger.warning("[Email] SMTP failed. Attempting Resend fallback...")
                success = _send_via_resend(settings, to_email, subject, body_html)
        return success

    logger.error(f"[Email] Unknown EPSA_EMAIL_PROVIDER='{provider}'. Use 'resend' or 'smtp'.")
    return False
