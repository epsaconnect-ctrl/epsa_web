import os
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import get_settings


settings = get_settings()

bind = os.getenv("GUNICORN_BIND") or os.getenv("EPSA_GUNICORN_BIND") or f"0.0.0.0:{os.getenv('PORT', '5000')}"
workers = settings.gunicorn_workers
worker_class = "eventlet"
timeout = 120
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
capture_output = True
