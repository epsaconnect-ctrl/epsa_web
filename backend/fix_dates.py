import sqlite3
import os

db = sqlite3.connect('epsa.db')
cur = db.cursor()
cur.execute("UPDATE mock_exams SET scheduled_at = datetime(scheduled_at, '-3 hours') WHERE scheduled_at IS NOT NULL")
cur.execute("UPDATE mock_exams SET ends_at = datetime(ends_at, '-3 hours') WHERE ends_at IS NOT NULL")
db.commit()
print("Fixed mock exams timezone in database")
