import io
import mimetypes
import os
import secrets
from pathlib import Path

import requests
from flask import current_app, redirect, send_file, send_from_directory
from werkzeug.utils import secure_filename

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


def _guess_content_type(filename):
    return mimetypes.guess_type(filename or "")[0] or "application/octet-stream"


def _unique_name(filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return secure_filename(f"{secrets.token_hex(8)}.{ext}")


class LocalStorageProvider:
    mode = "local"

    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)

    def ensure_folder(self, folder):
        path = self.base_dir / folder
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_bytes(self, folder, payload, filename):
        target = self.ensure_folder(folder) / filename
        with open(target, "wb") as handle:
            handle.write(payload)
        return filename

    def save_file(self, folder, file_storage, filename):
        target = self.ensure_folder(folder) / filename
        file_storage.save(target)
        return filename

    def public_response(self, folder, filename):
        return send_from_directory(self.base_dir / folder, filename)

    def private_response(self, folder, filename, download_name=None):
        return send_from_directory(self.base_dir / folder, filename, as_attachment=False, download_name=download_name)

    def read_bytes(self, folder, filename, private=None):
        with open(self.base_dir / folder / filename, "rb") as handle:
            return handle.read()


class S3StorageProvider:
    mode = "s3"

    def __init__(self, settings):
        self.settings = settings
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client(
                "s3",
                endpoint_url=self.settings.s3_endpoint_url,
                region_name=self.settings.s3_region,
                aws_access_key_id=self.settings.s3_access_key_id,
                aws_secret_access_key=self.settings.s3_secret_access_key,
            )
        return self._client

    def _key(self, folder, filename, private=False):
        prefix = self.settings.s3_private_prefix if private else self.settings.s3_public_prefix
        return f"{prefix}/{folder}/{filename}"

    def save_bytes(self, folder, payload, filename, private=False):
        extra = {"ContentType": _guess_content_type(filename)}
        if not private:
            extra["ACL"] = "public-read"
        self.client.put_object(
            Bucket=self.settings.s3_bucket,
            Key=self._key(folder, filename, private=private),
            Body=payload,
            **extra,
        )
        return filename

    def save_file(self, folder, file_storage, filename, private=False):
        extra = {"ContentType": _guess_content_type(filename)}
        if not private:
            extra["ACL"] = "public-read"
        self.client.upload_fileobj(
            file_storage.stream,
            self.settings.s3_bucket,
            self._key(folder, filename, private=private),
            ExtraArgs=extra,
        )
        file_storage.stream.seek(0)
        return filename

    def _public_url(self, folder, filename):
        if self.settings.s3_public_base_url:
            return f"{self.settings.s3_public_base_url.rstrip('/')}/{self._key(folder, filename, private=False)}"
        endpoint = (self.settings.s3_endpoint_url or "").rstrip("/")
        return f"{endpoint}/{self.settings.s3_bucket}/{self._key(folder, filename, private=False)}"

    def public_response(self, folder, filename):
        return redirect(self._public_url(folder, filename), code=302)

    def private_response(self, folder, filename, download_name=None):
        url = self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.settings.s3_bucket,
                "Key": self._key(folder, filename, private=True),
                **({"ResponseContentDisposition": f'inline; filename="{download_name or filename}"'} if download_name else {}),
            },
            ExpiresIn=300,
        )
        return redirect(url, code=302)

    def read_bytes(self, folder, filename, private=None):
        if private is None:
            private = is_private_folder(folder)
        response = self.client.get_object(
            Bucket=self.settings.s3_bucket,
            Key=self._key(folder, filename, private=private),
        )
        return response["Body"].read()


import logging as _logging
_storage_logger = _logging.getLogger("epsa.storage")


class SupabaseStorageProvider:
    mode = "supabase"

    def __init__(self, settings):
        self.settings = settings

    def _key(self, folder, filename):
        """Build storage key WITHOUT prefix — folder structure is sufficient."""
        return f"{folder}/{filename}"

    def _base_headers(self, *, content_type=None):
        token = self.settings.supabase_service_role_key or self.settings.supabase_anon_key or ""
        headers = {
            "apikey": token,
            "Authorization": f"Bearer {token}",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _storage_root(self):
        return f"{self.settings.supabase_url.rstrip('/')}/storage/v1"

    def _bucket(self):
        return self.settings.supabase_bucket

    def _object_url(self, key):
        return f"{self._storage_root()}/object/{self._bucket()}/{key}"

    def _public_url(self, folder, filename):
        key = self._key(folder, filename)
        return f"{self._storage_root()}/object/public/{self._bucket()}/{key}"

    def _signed_redirect(self, key, *, expires_in=300):
        try:
            response = requests.post(
                f"{self._storage_root()}/object/sign/{self._bucket()}/{key}",
                headers={
                    **self._base_headers(content_type="application/json"),
                    "Accept": "application/json",
                },
                json={"expiresIn": expires_in},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            signed_path = payload.get("signedURL") or payload.get("signedUrl") or payload.get("url") or ""
            if signed_path.startswith("http"):
                return redirect(signed_path, code=302)
            signed_path = signed_path if signed_path.startswith("/") else f"/{signed_path}"
            return redirect(f"{self._storage_root()}{signed_path}", code=302)
        except Exception as exc:
            _storage_logger.error("[Supabase] Signed URL generation failed for key=%s: %s", key, exc)
            raise

    def save_bytes(self, folder, payload, filename, private=False):
        key = self._key(folder, filename)
        url = self._object_url(key)
        _storage_logger.info("[Supabase] Uploading %s bytes to %s", len(payload) if payload else 0, url)
        try:
            response = requests.post(
                url,
                headers={
                    **self._base_headers(content_type=_guess_content_type(filename)),
                    "x-upsert": "true",
                },
                data=payload,
                timeout=60,
            )
            if not response.ok:
                _storage_logger.error(
                    "[Supabase] Upload FAILED for %s: HTTP %s — %s",
                    url, response.status_code, response.text[:300]
                )
            response.raise_for_status()
            _storage_logger.info("[Supabase] Upload OK: %s/%s", folder, filename)
        except Exception as exc:
            _storage_logger.error("[Supabase] Upload exception for %s/%s: %s", folder, filename, exc)
            raise
        return filename

    def save_file(self, folder, file_storage, filename, private=False):
        payload = file_storage.read()
        file_storage.stream.seek(0)
        return self.save_bytes(folder, payload, filename, private=private)

    def public_response(self, folder, filename):
        """For public folders, redirect to the direct public URL (no signing needed)."""
        public_url = self._public_url(folder, filename)
        return redirect(public_url, code=302)

    def private_response(self, folder, filename, download_name=None):
        key = self._key(folder, filename)
        return self._signed_redirect(key, expires_in=300)

    def read_bytes(self, folder, filename, private=None):
        key = self._key(folder, filename)
        url = self._object_url(key)
        try:
            response = requests.get(
                url,
                headers=self._base_headers(),
                timeout=60,
            )
            response.raise_for_status()
            return response.content
        except Exception as exc:
            _storage_logger.error("[Supabase] read_bytes failed for %s/%s: %s", folder, filename, exc)
            raise


def get_storage():
    storage = current_app.extensions.get("storage")
    if storage is None:
        storage = build_storage()
        current_app.extensions["storage"] = storage
    return storage


def build_storage():
    settings = get_settings()
    if settings.storage_mode == "supabase" and settings.supabase_url and settings.supabase_bucket:
        return SupabaseStorageProvider(settings)
    if settings.storage_mode == "s3" and settings.s3_bucket:
        return S3StorageProvider(settings)
    return LocalStorageProvider(settings.upload_dir)


def is_public_folder(folder):
    return folder in get_settings().storage_public_folders


def is_private_folder(folder):
    return folder in get_settings().storage_private_folders


def save_upload(file_storage, folder, *, filename=None):
    if not file_storage or not getattr(file_storage, "filename", ""):
        return None
    safe_name = filename or _unique_name(file_storage.filename)
    storage = get_storage()
    if getattr(storage, "mode", "local") in {"s3", "supabase"}:
        return storage.save_file(folder, file_storage, safe_name, private=is_private_folder(folder))
    return storage.save_file(folder, file_storage, safe_name)


def save_bytes(folder, payload, *, original_filename):
    if not payload:
        return None
    safe_name = _unique_name(original_filename)
    storage = get_storage()
    if getattr(storage, "mode", "local") in {"s3", "supabase"}:
        return storage.save_bytes(folder, payload, safe_name, private=is_private_folder(folder))
    return storage.save_bytes(folder, payload, safe_name)


def read_upload_bytes(folder, filename):
    if not filename:
        return None
    storage = get_storage()
    if getattr(storage, "mode", "local") in {"s3", "supabase"}:
        return storage.read_bytes(folder, filename, private=is_private_folder(folder))
    return storage.read_bytes(folder, filename)


def upload_url(folder, filename):
    if not filename:
        return None
    return f"/uploads/{folder}/{filename}"


def public_upload_response(folder, filename):
    return get_storage().public_response(folder, filename)


def private_upload_response(folder, filename, *, download_name=None):
    return get_storage().private_response(folder, filename, download_name=download_name)


def ensure_local_storage_folders():
    storage = build_storage()
    settings = get_settings()
    if getattr(storage, "mode", "local") != "local":
        return
    for folder in set(settings.storage_public_folders + settings.storage_private_folders + ("receipts",)):
        storage.ensure_folder(folder)
