"""Environment-driven API smoke verification for local or deployed EPSA backends."""

import json
import os
import sys
import time
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


BASE = api_base()


def get(path, token=None):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    response = urllib.request.urlopen(req, timeout=8)
    return json.loads(response.read()), response.getcode()


def post(path, data, token=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, body, {"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        response = urllib.request.urlopen(req, timeout=8)
        return json.loads(response.read()), response.getcode()
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read()), exc.code
        except Exception:
            return {}, exc.code


results = []


def check(name, passed, detail=""):
    icon = "PASS" if passed else "FAIL"
    line = f"{icon} | {name}"
    if detail:
        line += f"\n  -> {detail}"
    print(line)
    results.append((name, passed))


def env_login(label):
    identifier = os.getenv(f"EPSA_VERIFY_{label}_IDENTIFIER", "").strip()
    password = os.getenv(f"EPSA_VERIFY_{label}_PASSWORD", "").strip()
    if not identifier or not password:
        check(f"{label.title()} Login", True, "Skipped: verification credentials not provided in environment.")
        return None
    data, code = post("/auth/login", {"identifier": identifier, "password": password})
    token = data.get("token")
    role = data.get("user", {}).get("role", "")
    check(
        f"{label.title()} Login",
        code == 200 and bool(token),
        f"Status {code}, role={role}, token={bool(token)}",
    )
    return token


if __name__ == "__main__":
    try:
        data, _ = get("/health")
        check("API Health", data.get("status") == "ok", str(data))
    except Exception as exc:
        check("API Health", False, str(exc))

    try:
        data, _ = get("/teacher/categories")
        categories = data.get("categories", [])
        bloom_levels = data.get("bloom_levels", [])
        check(
            "Teacher Categories",
            len(categories) >= 18 and len(bloom_levels) == 6,
            f"{len(categories)} categories, {len(bloom_levels)} Bloom levels",
        )
    except Exception as exc:
        check("Teacher Categories", False, str(exc))

    unique_suffix = str(int(time.time()))[-6:]
    teacher_email = os.getenv("EPSA_VERIFY_TEACHER_EMAIL", f"verify_{unique_suffix}@epsa.local")
    teacher_password = os.getenv("EPSA_VERIFY_TEACHER_PASSWORD", "Verify@1234!")
    try:
        data, code = post(
            "/teacher/register",
            {
                "full_name": f"Verify Teacher {unique_suffix}",
                "email": teacher_email,
                "password": teacher_password,
                "specialization": "Clinical Psychology",
                "institution": "Addis Ababa University",
                "years_of_experience": 3,
            },
        )
        check("Teacher Self-Registration", code == 201, f"Status {code}: {data.get('message', data.get('error', ''))}")
    except Exception as exc:
        check("Teacher Self-Registration", False, str(exc))

    env_login("student")
    env_login("admin")

    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    print()
    print("=" * 55)
    print(f"FINAL RESULT: {passed}/{total} checks passed")
    if passed != total:
        failed = [name for name, ok in results if not ok]
        print("Failed:", ", ".join(failed))
    print("=" * 55)
