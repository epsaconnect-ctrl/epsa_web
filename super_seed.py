
import os
import sys
import sqlite3

# Ensure we are in the right directory
db_path = 'backend/epsa.db'
db = sqlite3.connect(db_path)
db.row_factory = sqlite3.Row

# RECREATE BROKEN TABLES
db.execute("DROP TABLE IF EXISTS network_posts")
db.execute("""CREATE TABLE network_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    club_id INTEGER,
    content TEXT NOT NULL,
    image_path TEXT,
    post_type TEXT DEFAULT 'student',
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)""")

db.execute("DROP TABLE IF EXISTS club_leadership")
db.execute("""CREATE TABLE club_leadership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, user_id, role)
)""")

# ENSURE USER 15 (SAMRAWIT) IS THE DEMO PRESIDENT
db.execute("UPDATE users SET status='approved', role='student' WHERE student_id='EPSA-AAU-2024-001'")
user = db.execute("SELECT id FROM users WHERE student_id='EPSA-AAU-2024-001'").fetchone()
if user:
    uid = user['id']
    # Create Club
    db.execute("INSERT OR REPLACE INTO clubs (id, name, university, member_count, president_id, status) VALUES (999, 'AAU Psychology Chapter', 'Addis Ababa University', 120, ?, 'approved')", (uid,))
    # Members & Leadership
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (999, ?, 'president')", (uid,))
    db.execute("INSERT OR IGNORE INTO club_leadership (club_id, user_id, role) VALUES (999, ?, 'President')", (uid,))
    # Fresh Posts
    db.execute("INSERT INTO network_posts (user_id, club_id, content, post_type) VALUES (?, 999, 'Welcome to the official AAU Psychology Chapter feed!', 'club')", (uid,))
    db.execute("INSERT INTO network_posts (user_id, content, post_type) VALUES (?, NULL, 'Excited to be part of the national EPSA ecosystem.', 'student')", (uid,))

# SETTINGS
db.execute("CREATE TABLE IF NOT EXISTS epsa_settings (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT)")
db.execute("INSERT OR IGNORE INTO epsa_settings (key, value) VALUES ('grant_pool_total', '500000')")
db.execute("INSERT OR IGNORE INTO epsa_settings (key, value) VALUES ('grant_pool_description', 'National Student Grant Pool')")

db.commit()
db.close()
print("Super-seed successful. Samrawit (ID 15) reset and posts added.")
