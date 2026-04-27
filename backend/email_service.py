"""Email delivery service — supports Gmail SMTP and Resend API."""
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


def _send_via_resend(settings, to_email, subject, body_html):
    if not settings.resend_api_key or not settings.resend_from_email:
        print("[Email Warning] Resend selected but EPSA_RESEND_API_KEY / EPSA_RESEND_FROM_EMAIL not set.")
        return False
    try:
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.resend_from_email,
                "to": [to_email],
                "subject": subject,
                "html": body_html,
            },
            timeout=30,
        )
        response.raise_for_status()
        print(f"[Email OK] Resend delivered to {to_email}")
        return True
    except Exception as exc:
        print(f"[Email Error] Resend failed for {to_email}: {exc}")
        return False


def _build_message(smtp_email, from_name, to_email, subject, body_html):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{smtp_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(body_html, "html", "utf-8"))
    return msg


def _try_smtp_ssl(host, port, smtp_email, smtp_password, to_email, msg):
    """Try SMTP_SSL connection (port 465)."""
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as server:
        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, [to_email], msg.as_string())
    print(f"[Email OK] SSL:{port} delivered to {to_email}")
    return True


def _try_smtp_starttls(host, port, smtp_email, smtp_password, to_email, msg):
    """Try SMTP + STARTTLS connection (port 587)."""
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, [to_email], msg.as_string())
    print(f"[Email OK] STARTTLS:{port} delivered to {to_email}")
    return True


def send_email(to_email, subject, body_html):
    """Send an email. Returns True on success, False on failure."""
    settings = get_settings()

    if settings.email_provider == "resend":
        return _send_via_resend(settings, to_email, subject, body_html)

    smtp_email = settings.smtp_email
    smtp_password = settings.smtp_password

    if not smtp_email or not smtp_password:
        print(
            "[Email Warning] EPSA_SMTP_EMAIL and EPSA_SMTP_PASSWORD are not set. "
            "Email will NOT be sent. Set these on Railway to enable OTP delivery."
        )
        return False

    host = settings.smtp_server or "smtp.gmail.com"
    port = settings.smtp_port or 465
    from_name = settings.smtp_from_name or "EPSA Digital Platform"

    msg = _build_message(smtp_email, from_name, to_email, subject, body_html)

    # Try primary port first, then fall back to alternative
    primary_port = port
    # If primary is 465 → fallback is 587, and vice versa
    fallback_port = 587 if primary_port == 465 else 465

    errors = []

    # Attempt 1: primary port
    try:
        if primary_port == 465:
            return _try_smtp_ssl(host, primary_port, smtp_email, smtp_password, to_email, msg)
        else:
            return _try_smtp_starttls(host, primary_port, smtp_email, smtp_password, to_email, msg)
    except Exception as exc:
        errors.append(f"port {primary_port}: {exc}")
        print(f"[Email Warning] Primary attempt failed ({exc}). Trying fallback port {fallback_port}...")

    # Attempt 2: fallback port
    try:
        if fallback_port == 465:
            return _try_smtp_ssl(host, fallback_port, smtp_email, smtp_password, to_email, msg)
        else:
            return _try_smtp_starttls(host, fallback_port, smtp_email, smtp_password, to_email, msg)
    except Exception as exc:
        errors.append(f"port {fallback_port}: {exc}")

    print(f"[Email Error] All attempts failed for {to_email}: {'; '.join(errors)}")
    return False
