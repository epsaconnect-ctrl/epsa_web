# EPSA Deployment Guide

## Local mode

1. Copy `.env.example` to `.env` or `backend/.env`.
2. Keep `EPSA_ENV=local`.
3. Use local defaults:
   - `EPSA_DATABASE_URL=sqlite:///backend/epsa.db`
   - `EPSA_STORAGE_MODE=local`
   - `EPSA_UPLOAD_DIR=backend/uploads`
   - `EPSA_AUTH_TOKEN_MODE=local_storage`
4. Optional local admin bootstrap:
   - `EPSA_BOOTSTRAP_ADMIN_USERNAME=admin`
   - `EPSA_BOOTSTRAP_ADMIN_PASSWORD=strong-local-password`
   - optional: `EPSA_BOOTSTRAP_ADMIN_EMAIL`, `EPSA_BOOTSTRAP_ADMIN_TOTP_SECRET`
5. Install backend dependencies:
   - `cd backend`
   - `pip install -r requirements.txt`
6. Start the app:
   - `python app.py`
7. The backend will keep using SQLite, local uploads, and Flask debug behavior unless overridden in the environment.

## Production mode

1. Set `EPSA_ENV=production`.
2. Provide strong secrets:
   - `EPSA_SECRET_KEY`
   - `EPSA_JWT_SECRET`
3. Point the app to PostgreSQL:
   - `EPSA_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME`
   - or set platform-native `DATABASE_URL`
4. Switch storage:
   - `EPSA_STORAGE_MODE=supabase`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET=uploads`
   - optional: `SUPABASE_ANON_KEY`
   - public objects are served from the Supabase public object path
   - private objects are served through short-lived signed URLs
5. Lock down browser access:
   - `EPSA_APP_URL=https://your-frontend-domain`
   - `EPSA_API_BASE_URL=https://your-backend-domain/api`
   - `EPSA_CORS_ORIGINS=https://your-frontend-domain`
   - `EPSA_AUTH_TOKEN_MODE=cookie` or `both`
   - `EPSA_JWT_COOKIE_SECURE=true`
   - `EPSA_JWT_COOKIE_SAMESITE=None`
6. Configure mail and password reset:
   - choose `EPSA_EMAIL_PROVIDER=smtp` or `EPSA_EMAIL_PROVIDER=resend`
   - SMTP path: `EPSA_SMTP_EMAIL`, `EPSA_SMTP_PASSWORD`, `EPSA_SMTP_SERVER`, `EPSA_SMTP_PORT`
   - Resend path: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
   - `EPSA_PASSWORD_RESET_URL=https://your-frontend-domain/login.html`
7. Enforce admin 2FA:
   - `EPSA_REQUIRE_ADMIN_TOTP=true`
   - `EPSA_ADMIN_TOTP_SECRET` or per-user `admin_totp_secret`
8. Optional first-admin bootstrap for a fresh environment:
   - `EPSA_BOOTSTRAP_ADMIN_USERNAME`
   - `EPSA_BOOTSTRAP_ADMIN_PASSWORD`
   - optional: `EPSA_BOOTSTRAP_ADMIN_EMAIL`, `EPSA_BOOTSTRAP_ADMIN_TOTP_SECRET`
9. Run with Gunicorn:
   - `cd backend`
   - `gunicorn -c gunicorn.conf.py wsgi:application`

## SQLite to PostgreSQL migration notes

- The runtime now selects SQLite or PostgreSQL from `EPSA_DATABASE_URL`.
- `DATABASE_URL` is also accepted for platforms like Railway, Render, and Supabase examples.
- SQL execution is routed through `backend/db.py`, which translates common SQLite-only patterns such as `AUTOINCREMENT`, `INSERT OR IGNORE`, and `DATETIME('now')`.
- File storage is no longer tied to local disk paths in auth and upload flows; production file access now goes through the storage provider abstraction.
- Supabase Storage is supported directly through `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`.
- Before switching a live environment to PostgreSQL:
  - create the target database
  - point `EPSA_DATABASE_URL` to PostgreSQL
  - run `python sync_db.py` once to create/update tables
  - migrate existing SQLite data with an export/import process appropriate for your host
  - copy existing `backend/uploads` assets into the configured Supabase bucket if you are also switching storage

## Operational notes

- Debug mode is controlled by `EPSA_ENV` and `EPSA_DEBUG`, and should stay off in production.
- OTP verification, password reset, admin TOTP, and rate-limited routes are enforced server-side.
- Biometric analysis is dispatched through a thread pool so heavy face-processing work does not block the main request path as aggressively as before.
