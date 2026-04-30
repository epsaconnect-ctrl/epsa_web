"""
EPSA User Account Diagnostic & Repair Script
Run this locally to inspect and fix production database issues.
Usage:
    cd backend
    python fix_user_accounts.py            # show all students
    python fix_user_accounts.py fix        # fix stuck accounts (reset is_verified/is_active)
    python fix_user_accounts.py approve <email>   # approve a specific student
"""
import os, sys
from pathlib import Path

# Load production env
BASE_DIR = Path(__file__).resolve().parent
prod_env = BASE_DIR / ".env.production"
if prod_env.exists():
    from dotenv import load_dotenv
    load_dotenv(prod_env, override=True)
    print(f"[Info] Loaded {prod_env}")

# Force production mode so PostgreSQL is used
os.environ.setdefault("EPSA_ENV", "production")
os.environ.setdefault("RAILWAY_ENVIRONMENT", "production")

from db import connect
from werkzeug.security import generate_password_hash

def get_db():
    return connect()

def show_users():
    db = get_db()
    rows = db.execute(
        "SELECT id, first_name, father_name, email, role, status, is_verified, is_active, created_at "
        "FROM users ORDER BY created_at DESC LIMIT 30"
    ).fetchall()
    db.close()
    print(f"\n{'ID':<5} {'Name':<25} {'Email':<35} {'Role':<12} {'Status':<10} {'Verified':<9} {'Active':<7} {'Created'}")
    print("-" * 115)
    for r in rows:
        name = f"{r['first_name']} {r['father_name']}"
        print(f"{r['id']:<5} {name:<25} {r['email']:<35} {r['role']:<12} {r['status']:<10} {str(r['is_verified']):<9} {str(r['is_active']):<7} {str(r['created_at'])[:19]}")

def fix_accounts():
    """Ensure all students who have profile_photo and reg_slip have is_verified=1 and is_active=1."""
    db = get_db()
    result = db.execute(
        """UPDATE users
           SET is_verified=1, is_active=1
           WHERE role='student'
             AND profile_photo IS NOT NULL AND TRIM(profile_photo) != ''
             AND reg_slip IS NOT NULL AND TRIM(reg_slip) != ''
             AND (COALESCE(is_verified,0)=0 OR COALESCE(is_active,0)=0)"""
    )
    db.commit()
    print(f"[Fix] Updated {result.rowcount} student account(s) → is_verified=1, is_active=1")
    db.close()

def approve_student(email):
    db = get_db()
    user = db.execute("SELECT id, first_name, status FROM users WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()
    if not user:
        print(f"[Error] No user found with email: {email}")
        db.close()
        return
    db.execute(
        "UPDATE users SET status='approved', is_verified=1, is_active=1, approved_at=CURRENT_TIMESTAMP WHERE id=?",
        (user['id'],)
    )
    db.commit()
    print(f"[Approved] {user['first_name']} (id={user['id']}) status → approved")
    db.close()

def reset_password(email, new_password):
    db = get_db()
    user = db.execute("SELECT id, first_name FROM users WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()
    if not user:
        print(f"[Error] No user found with email: {email}")
        db.close()
        return
    new_hash = generate_password_hash(new_password)
    db.execute("UPDATE users SET password_hash=? WHERE id=?", (new_hash, user['id']))
    db.commit()
    print(f"[Reset] Password updated for {user['first_name']} (id={user['id']})")
    db.close()

def check_storage():
    from config import get_settings
    from storage import build_storage
    s = get_settings()
    print(f"\n[Storage Config]")
    print(f"  storage_mode       = {s.storage_mode}")
    print(f"  supabase_url       = {s.supabase_url}")
    print(f"  supabase_bucket    = {s.supabase_bucket}")
    print(f"  service_role_key   = {'SET' if s.supabase_service_role_key else 'MISSING'}")
    print(f"  resend_api_key     = {'SET (valid)' if s.resend_api_key and 'REPLACE' not in (s.resend_api_key or '') else 'MISSING / placeholder'}")
    storage = build_storage()
    print(f"  storage provider   = {storage.mode}")

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "show":
        show_users()
        check_storage()
    elif args[0] == "fix":
        show_users()
        fix_accounts()
        show_users()
    elif args[0] == "approve" and len(args) >= 2:
        approve_student(args[1])
        show_users()
    elif args[0] == "reset-password" and len(args) >= 3:
        reset_password(args[1], args[2])
    else:
        print("Usage:")
        print("  python fix_user_accounts.py              # show users + storage config")
        print("  python fix_user_accounts.py fix          # fix is_verified/is_active flags")
        print("  python fix_user_accounts.py approve <email>")
        print("  python fix_user_accounts.py reset-password <email> <new_password>")
