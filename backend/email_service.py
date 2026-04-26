import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


def _send_via_resend(settings, to_email, subject, body_html):
    if not settings.resend_api_key or not settings.resend_from_email:
        print("[Email Warning] Resend is selected but credentials are incomplete. Skipping real email send.")
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
        return True
    except Exception as e:
        print(f"[Email Error] Resend send failed for {to_email}: {e}")
        return False


def send_email(to_email, subject, body_html):
    settings = get_settings()
    if settings.email_provider == "resend":
        return _send_via_resend(settings, to_email, subject, body_html)

    smtp_email = settings.smtp_email
    smtp_password = settings.smtp_password
    if not smtp_email or not smtp_password:
        print("[Email Warning] Real SMTP credentials not set in .env. Skipping real email send.")
        return False

    msg = MIMEMultipart("alternative")
    msg['Subject'] = subject
    msg['From'] = f"{settings.smtp_from_name} <{smtp_email}>"
    msg['To'] = to_email

    msg.attach(MIMEText(body_html, "html"))

    try:
        server = smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port)
        server.login(smtp_email, smtp_password)
        server.sendmail(smtp_email, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"[Email Error] Failed to send to {to_email}: {e}")
        return False
