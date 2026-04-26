import sqlite3
db = sqlite3.connect(r'backend/epsa.db')
tables = db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
tables = [t[0] for t in tables]
new_tables = [t for t in tables if t in ('question_bank','question_analytics','mock_exams','mock_exam_submissions')]
print('New tables found:', new_tables)
missing = [t for t in ('question_bank','question_analytics','mock_exams','mock_exam_submissions') if t not in tables]
print('Missing:', missing if missing else 'None - all good!')
cols = db.execute('PRAGMA table_info(users)').fetchall()
col_names = [c[1] for c in cols]
teacher_cols = [c for c in ('specialization','institution','years_of_experience','credentials') if c in col_names]
print('Teacher cols on users:', teacher_cols)
db.close()
