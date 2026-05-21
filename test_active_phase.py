import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')

from app import app
from models import get_db
from flask_jwt_extended import create_access_token
import json

with app.app_context():
    db = get_db()
    
    # Ensure voting_phases exists and has data
    db.execute("INSERT OR IGNORE INTO voting_phases (phase_number, title, is_active, status) VALUES (1, 'Phase 1', 0, 'draft')")
    db.execute("INSERT OR IGNORE INTO voting_phases (phase_number, title, is_active, status) VALUES (2, 'Phase 2', 0, 'draft')")
    
    # Activate phase 1
    db.execute("UPDATE voting_phases SET is_active=1, status='active' WHERE phase_number=1")
    db.commit()
    
    users = db.execute("SELECT id FROM users LIMIT 5").fetchall()
    
    for u in users:
        uid = u['id']
        token = create_access_token(identity=str(uid))

        with app.test_client() as client:
            res = client.get('/api/voting/candidates?phase=1', headers={'Authorization': f'Bearer {token}'})
            print(f"User {uid} status:", res.status_code)
            try:
                print(json.dumps(res.json, indent=2)[:500])
            except:
                print(res.data.decode()[:500])
                
    # Deactivate phase 1
    db.execute("UPDATE voting_phases SET is_active=0, status='draft' WHERE phase_number=1")
    db.commit()
    db.close()
