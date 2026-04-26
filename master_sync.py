"""Synchronize the backend schema without creating demo users or seed content."""

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from models import init_db, migrate_db  # noqa: E402


if __name__ == "__main__":
    os.chdir(ROOT)
    init_db()
    migrate_db()
    print("Backend schema synchronized successfully.")
