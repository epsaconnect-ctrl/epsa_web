"""Update user password hashes in the local SQLite database using environment variables."""

import os
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().with_name("epsa.db")


def apply_update(username, password_hash):
    db = sqlite3.connect(DB_PATH)
    try:
        db.execute("UPDATE users SET password_hash=? WHERE username=?", (password_hash, username))
        db.commit()
        print(f"Updated password hash for {username}.")
    finally:
        db.close()


if __name__ == "__main__":
    username = os.getenv("EPSA_HASH_TARGET_USERNAME", "").strip()
    password_hash = os.getenv("EPSA_HASH_TARGET_PASSWORD_HASH", "").strip()
    if not username or not password_hash:
        raise SystemExit("Set EPSA_HASH_TARGET_USERNAME and EPSA_HASH_TARGET_PASSWORD_HASH before running this script.")
    apply_update(username, password_hash)
