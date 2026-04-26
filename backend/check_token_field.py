"""Inspect login response fields and optionally run an env-driven login smoke test."""

import json
import os
import re
import sys
import urllib.error
import urllib.request

from config import get_settings

sys.stdout.reconfigure(encoding="utf-8")


def api_base():
    settings = get_settings()
    if settings.api_base_url.startswith("http"):
        return settings.api_base_url.rstrip("/")
    app_url = settings.app_public_url.rstrip("/")
    return f"{app_url}{settings.api_base_url}".rstrip("/")


def show_login_payload_shape():
    with open(r"backend\auth.py", "r", encoding="utf-8") as handle:
        content = handle.read()

    idx = content.find("def login():")
    chunk = content[idx : idx + 4000]
    for match in re.finditer(r'(access_token|"token"|token)', chunk):
        start = max(0, match.start() - 40)
        snippet = chunk[start : match.end() + 120].replace("\n", "|")
        print(f"[{match.start()}] {snippet[:200]}")
        print()


def run_live_login_test():
    identifier = os.getenv("EPSA_VERIFY_IDENTIFIER", "").strip()
    password = os.getenv("EPSA_VERIFY_PASSWORD", "").strip()
    if not identifier or not password:
        print("Skipping live login test. Set EPSA_VERIFY_IDENTIFIER and EPSA_VERIFY_PASSWORD to enable it.")
        return

    body = json.dumps({"identifier": identifier, "password": password}).encode()
    req = urllib.request.Request(
        f"{api_base()}/auth/login",
        body,
        {"Content-Type": "application/json"},
    )
    try:
        response = urllib.request.urlopen(req, timeout=5)
        data = json.loads(response.read())
        print("Login response keys:", list(data.keys()))
        if "user" in data:
            print("User keys:", list(data["user"].keys()))
        print("Token present:", bool(data.get("token")))
    except urllib.error.HTTPError as exc:
        print("HTTP ERROR:", exc.code, exc.read().decode("utf-8", errors="ignore"))
    except Exception as exc:
        print("ERROR:", exc)


if __name__ == "__main__":
    show_login_payload_shape()
    print("=" * 60)
    run_live_login_test()
