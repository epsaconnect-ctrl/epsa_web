import psycopg2
import psycopg2.extras

DB_URL = "postgresql://postgres.hsxpycyclpnouwvauomk:Epsa_DB_2026%21Secure%23Key@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"

conn = psycopg2.connect(DB_URL)
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

print("=== USERS (most recent 20) ===")
cur.execute("SELECT id, first_name, father_name, email, role, status, is_verified, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 20")
rows = cur.fetchall()
print(f"Total rows: {len(rows)}")
for r in rows:
    print(f"  id={r['id']} | {r['first_name']} {r['father_name']} | {r['email']} | role={r['role']} | status={r['status']} | verified={r['is_verified']} | active={r['is_active']} | {str(r['created_at'])[:19]}")

print()
print("=== ROLE/STATUS BREAKDOWN ===")
cur.execute("SELECT role, status, COUNT(*) as n FROM users GROUP BY role, status ORDER BY role, status")
for r in cur.fetchall():
    print(f"  role={r['role']} status={r['status']} count={r['n']}")

print()
print("=== PASSWORD HASH SAMPLE (first 40 chars for 3 users) ===")
cur.execute("SELECT email, LEFT(password_hash, 40) as hash_prefix FROM users LIMIT 3")
for r in cur.fetchall():
    print(f"  {r['email']} => {r['hash_prefix']}")

conn.close()
print("Done.")
