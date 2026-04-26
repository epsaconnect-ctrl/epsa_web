from config import get_settings


settings = get_settings()

bind = settings.gunicorn_bind
workers = settings.gunicorn_workers
worker_class = "eventlet"
timeout = 120
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
capture_output = True
