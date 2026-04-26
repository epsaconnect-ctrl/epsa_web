import os

# ─── Binding ────────────────────────────────────────────────────────────────
# Railway injects $PORT; fall back to 8080 for local testing.
bind = f"0.0.0.0:{os.getenv('PORT', '8080')}"

# ─── Workers / Threads ──────────────────────────────────────────────────────
# gthread is required to honour --threads > 1.
# sync worker silently ignores --threads and always runs single-threaded.
workers = 1
worker_class = "gthread"
threads = 2

# ─── Timeouts ───────────────────────────────────────────────────────────────
timeout = 120          # worker is killed and restarted if silent for 120 s
graceful_timeout = 30  # time allowed for in-flight requests on shutdown

# ─── Logging ────────────────────────────────────────────────────────────────
# Route both access and error logs to stdout ("-").
# This stops Railway from labelling every Gunicorn log line as [err].
accesslog  = "-"
errorlog   = "-"
loglevel   = "info"         # 'debug' is noisy; switch to 'debug' when diagnosing
capture_output = True       # redirect Python print() / logging to Gunicorn log

# ─── Keep-alive ─────────────────────────────────────────────────────────────
keepalive = 5

# ─── Worker lifecycle ───────────────────────────────────────────────────────
# Restart workers after this many requests to prevent memory leaks.
max_requests = 500
max_requests_jitter = 50
