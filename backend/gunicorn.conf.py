import os

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


settings = get_settings()

bind = os.getenv("GUNICORN_BIND") or os.getenv("EPSA_GUNICORN_BIND") or f"0.0.0.0:{os.getenv('PORT', '5000')}"
workers = 1
threads = 2
timeout = 120
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
capture_output = True
