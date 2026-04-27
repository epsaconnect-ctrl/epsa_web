import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values, load_dotenv


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
BACKEND_ENV = BASE_DIR / ".env"
PROJECT_ENV = PROJECT_ROOT / ".env"
BACKEND_PRODUCTION_ENV = BASE_DIR / ".env.production"
PROJECT_PRODUCTION_ENV = PROJECT_ROOT / ".env.production"
ORIGINAL_ENV = dict(os.environ)


def _is_railway_runtime():
    return bool(
        os.getenv("PORT")
        or os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("RAILWAY_SERVICE_ID")
    )


def _resolve_env_name():
    env = (
        os.getenv("EPSA_ENV")
        or os.getenv("APP_ENV")
        or os.getenv("FLASK_ENV")
        or "local"
    )
    env = str(env).strip().lower()
    if _is_railway_runtime():
        env = "production"
    if env not in {"local", "production", "staging", "development", "test"}:
        env = "local"
    return env

for candidate in (BACKEND_ENV, PROJECT_ENV):
    if candidate.exists():
        load_dotenv(candidate, override=False)

active_env = _resolve_env_name()
if active_env == "production":
    merged_values = {}
    for candidate in (BACKEND_ENV, PROJECT_ENV, BACKEND_PRODUCTION_ENV, PROJECT_PRODUCTION_ENV):
        if candidate.exists():
            merged_values.update({k: v for k, v in dotenv_values(candidate).items() if v is not None})
    for key, value in merged_values.items():
        if key not in ORIGINAL_ENV:
            os.environ[key] = value


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _env_list(name, default=None):
    raw = os.getenv(name)
    if raw is None:
        return list(default or [])
    parts = [item.strip() for item in str(raw).split(",")]
    return [item for item in parts if item]


@dataclass(frozen=True)
class AppSettings:
    env: str
    debug: bool
    secret_key: str
    jwt_secret_key: str
    jwt_access_expires: int
    jwt_refresh_expires: int
    auth_token_mode: str
    jwt_cookie_secure: bool
    jwt_cookie_samesite: str
    jwt_cookie_domain: str | None
    database_url: str
    upload_dir: Path
    max_content_length: int
    app_public_url: str
    api_base_url: str
    cors_origins: list[str]
    cookie_cors_origins: list[str]
    storage_mode: str
    storage_public_folders: tuple[str, ...]
    storage_private_folders: tuple[str, ...]
    supabase_url: str | None
    supabase_anon_key: str | None
    supabase_service_role_key: str | None
    supabase_bucket: str | None
    s3_bucket: str | None
    s3_region: str | None
    s3_endpoint_url: str | None
    s3_access_key_id: str | None
    s3_secret_access_key: str | None
    s3_public_base_url: str | None
    s3_public_prefix: str
    s3_private_prefix: str
    rate_limit_enabled: bool
    biometric_workers: int
    biometric_timeout_seconds: int
    enable_dev_seed: bool
    password_reset_ttl_seconds: int
    password_reset_url: str
    otp_ttl_seconds: int
    otp_proof_ttl_seconds: int
    show_otp_in_response: bool
    require_admin_totp: bool
    admin_totp_secret: str | None
    allow_local_admin_totp_bypass: bool
    email_provider: str
    resend_api_key: str | None
    resend_from_email: str | None
    bootstrap_admin_username: str | None
    bootstrap_admin_password: str | None
    bootstrap_admin_email: str | None
    bootstrap_admin_first_name: str
    bootstrap_admin_father_name: str
    bootstrap_admin_totp_secret: str | None
    gunicorn_bind: str
    gunicorn_workers: int

    @property
    def is_local(self):
        return self.env != "production"

    @property
    def is_production(self):
        return self.env == "production"

    @property
    def use_cookie_auth(self):
        return self.auth_token_mode in {"cookie", "both"}

    @property
    def expose_jwt_to_client(self):
        return self.auth_token_mode in {"local_storage", "both"}

    @property
    def db_engine(self):
        return "postgres" if self.database_url.startswith(("postgres://", "postgresql://")) else "sqlite"


@lru_cache(maxsize=1)
def get_settings():
    env = _resolve_env_name()
    normalized_env = "production" if env == "production" else "local"
    os.environ["APP_ENV"] = normalized_env
    if _is_railway_runtime():
        os.environ["EPSA_ENV"] = "production"

    debug = _env_bool("EPSA_DEBUG", default=normalized_env != "production")
    local_backend_host = (os.getenv("EPSA_LOCAL_BACKEND_HOST") or "127.0.0.1").strip() or "127.0.0.1"
    local_backend_port = max(1, _env_int("EPSA_LOCAL_BACKEND_PORT", 5000))
    local_frontend_ports = {
        str(local_backend_port),
        *_env_list("EPSA_LOCAL_FRONTEND_PORTS", ["5500", "5173", "3000"]),
    }

    secret_key = os.getenv("EPSA_SECRET_KEY") or (
        "epsa-local-secret-key-change-before-production" if normalized_env != "production" else ""
    )
    jwt_secret_key = os.getenv("EPSA_JWT_SECRET") or secret_key or "epsa-local-jwt-secret"

    upload_dir = Path(os.getenv("EPSA_UPLOAD_DIR") or (BASE_DIR / "uploads"))

    default_local_origins = []
    for host in dict.fromkeys([local_backend_host, "127.0.0.1", "localhost"]):
        for port in sorted(local_frontend_ports):
            default_local_origins.append(f"http://{host}:{port}")

    default_public_url = os.getenv("EPSA_APP_URL") or (
        f"http://{local_backend_host}:{local_backend_port}" if normalized_env != "production" else ""
    )
    app_public_url = default_public_url.rstrip("/")
    api_base_url = os.getenv("EPSA_API_BASE_URL") or (
        f"{app_public_url}/api" if app_public_url else "/api"
    )
    cors_origins = _env_list(
        "EPSA_CORS_ORIGINS",
        default_local_origins if normalized_env != "production" else [origin for origin in [app_public_url] if origin],
    )

    storage_mode = (os.getenv("EPSA_STORAGE_MODE") or ("local" if normalized_env != "production" else "s3")).strip().lower()
    supabase_url = (os.getenv("EPSA_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "").strip() or None
    supabase_anon_key = (os.getenv("EPSA_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY") or "").strip() or None
    supabase_service_role_key = (os.getenv("EPSA_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or None
    supabase_bucket = (os.getenv("EPSA_SUPABASE_BUCKET") or os.getenv("SUPABASE_BUCKET") or "").strip() or None
    if not os.getenv("EPSA_STORAGE_MODE") and normalized_env == "production" and supabase_url and supabase_bucket:
        storage_mode = "supabase"
    if storage_mode not in {"local", "s3", "supabase"}:
        storage_mode = "local"

    public_folders = tuple(
        _env_list(
            "EPSA_PUBLIC_UPLOAD_FOLDERS",
            [
                "profiles",
                "news",
                "partners",
                "partner_gallery",
                "appointees",
                "feed",
                "clubs",
                "club_activities",
                "manifestos",
                "governance_docs",
                "training_graphics",
            ],
        )
    )
    private_folders = tuple(
        _env_list(
            "EPSA_PRIVATE_UPLOAD_FOLDERS",
            [
                "slips",
                "receipts",
                "fin_receipts",
                "proposals",
            ],
        )
    )

    auth_token_mode = (os.getenv("EPSA_AUTH_TOKEN_MODE") or "local_storage").strip().lower()
    if auth_token_mode not in {"local_storage", "cookie", "both"}:
        auth_token_mode = "local_storage"

    database_url = os.getenv("EPSA_DATABASE_URL")
    if not database_url and normalized_env == "production":
        database_url = os.getenv("DATABASE_URL")
    database_url = database_url or f"sqlite:///{(BASE_DIR / 'epsa.db').as_posix()}"

    return AppSettings(
        env=normalized_env,
        debug=debug,
        secret_key=secret_key or "epsa-production-secret-required",
        jwt_secret_key=jwt_secret_key,
        jwt_access_expires=_env_int("EPSA_JWT_ACCESS_EXPIRES_SECONDS", 3600),
        jwt_refresh_expires=_env_int("EPSA_JWT_REFRESH_EXPIRES_SECONDS", 604800),
        auth_token_mode=auth_token_mode,
        jwt_cookie_secure=_env_bool("EPSA_JWT_COOKIE_SECURE", default=normalized_env == "production"),
        jwt_cookie_samesite=os.getenv("EPSA_JWT_COOKIE_SAMESITE") or ("None" if normalized_env == "production" else "Lax"),
        jwt_cookie_domain=os.getenv("EPSA_JWT_COOKIE_DOMAIN") or None,
        database_url=database_url,
        upload_dir=upload_dir,
        max_content_length=_env_int("EPSA_MAX_CONTENT_LENGTH_MB", 20) * 1024 * 1024,
        app_public_url=app_public_url,
        api_base_url=api_base_url.rstrip("/"),
        cors_origins=cors_origins,
        cookie_cors_origins=[origin for origin in cors_origins if origin.startswith("http")],
        storage_mode=storage_mode,
        storage_public_folders=public_folders,
        storage_private_folders=private_folders,
        supabase_url=supabase_url,
        supabase_anon_key=supabase_anon_key,
        supabase_service_role_key=supabase_service_role_key,
        supabase_bucket=supabase_bucket,
        s3_bucket=os.getenv("EPSA_S3_BUCKET"),
        s3_region=os.getenv("EPSA_S3_REGION"),
        s3_endpoint_url=os.getenv("EPSA_S3_ENDPOINT_URL"),
        s3_access_key_id=os.getenv("EPSA_S3_ACCESS_KEY_ID"),
        s3_secret_access_key=os.getenv("EPSA_S3_SECRET_ACCESS_KEY"),
        s3_public_base_url=os.getenv("EPSA_S3_PUBLIC_BASE_URL"),
        s3_public_prefix=os.getenv("EPSA_S3_PUBLIC_PREFIX", "public").strip("/"),
        s3_private_prefix=os.getenv("EPSA_S3_PRIVATE_PREFIX", "private").strip("/"),
        rate_limit_enabled=_env_bool("EPSA_RATE_LIMIT_ENABLED", True),
        biometric_workers=max(1, _env_int("EPSA_BIOMETRIC_WORKERS", 2)),
        biometric_timeout_seconds=max(10, _env_int("EPSA_BIOMETRIC_TIMEOUT_SECONDS", 45)),
        enable_dev_seed=_env_bool("EPSA_ENABLE_DEV_SEED", False),
        password_reset_ttl_seconds=max(300, _env_int("EPSA_PASSWORD_RESET_TTL_SECONDS", 3600)),
        password_reset_url=os.getenv("EPSA_PASSWORD_RESET_URL") or (
            f"{app_public_url}/login.html" if app_public_url else f"http://{local_backend_host}:{local_backend_port}/login.html"
        ),
        otp_ttl_seconds=max(60, _env_int("EPSA_OTP_TTL_SECONDS", 600)),
        otp_proof_ttl_seconds=max(60, _env_int("EPSA_OTP_PROOF_TTL_SECONDS", 1800)),
        show_otp_in_response=_env_bool("EPSA_SHOW_OTP_IN_RESPONSE", False),
        require_admin_totp=_env_bool("EPSA_REQUIRE_ADMIN_TOTP", default=normalized_env == "production"),
        admin_totp_secret=os.getenv("EPSA_ADMIN_TOTP_SECRET"),
        allow_local_admin_totp_bypass=_env_bool("EPSA_ALLOW_LOCAL_ADMIN_TOTP_BYPASS", default=normalized_env != "production"),
        email_provider="resend",
        resend_api_key=(os.getenv("EPSA_RESEND_API_KEY") or os.getenv("RESEND_API_KEY") or "").strip() or None,
        resend_from_email=(os.getenv("EPSA_RESEND_FROM_EMAIL") or os.getenv("RESEND_FROM_EMAIL") or "").strip() or None,
        bootstrap_admin_username=(os.getenv("EPSA_BOOTSTRAP_ADMIN_USERNAME") or "").strip() or None,
        bootstrap_admin_password=(os.getenv("EPSA_BOOTSTRAP_ADMIN_PASSWORD") or "").strip() or None,
        bootstrap_admin_email=(os.getenv("EPSA_BOOTSTRAP_ADMIN_EMAIL") or "").strip().lower() or None,
        bootstrap_admin_first_name=(os.getenv("EPSA_BOOTSTRAP_ADMIN_FIRST_NAME") or "EPSA").strip() or "EPSA",
        bootstrap_admin_father_name=(os.getenv("EPSA_BOOTSTRAP_ADMIN_FATHER_NAME") or "Administrator").strip() or "Administrator",
        bootstrap_admin_totp_secret=(os.getenv("EPSA_BOOTSTRAP_ADMIN_TOTP_SECRET") or "").strip() or None,
        gunicorn_bind=os.getenv("EPSA_GUNICORN_BIND", "0.0.0.0:5000"),
        gunicorn_workers=max(1, _env_int("EPSA_GUNICORN_WORKERS", 2)),
    )
