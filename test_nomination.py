import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')

from app import app
from models import get_db
from flask_jwt_extended import create_access_token
import json

with app.app_context():
    db = get_db()
    
    # Activate phase 1
    db.execute("UPDATE voting_phases SET is_active=1, status='active' WHERE phase_number=1")
    
    # Get a user and add a nomination
    u = db.execute("SELECT id, university FROM users LIMIT 1").fetchone()
    uid = u['id']
    
    db.execute("""
        INSERT OR IGNORE INTO nominations (user_id, phase_id, is_approved, bio, statement)
        VALUES (?, 1, 0, 'Test Bio', 'Test Statement')
    """, (uid,))
    db.commit()
    
    token = create_access_token(identity=str(uid))

    with app.test_client() as client:
        res = client.get('/api/voting/candidates?phase=1', headers={'Authorization': f'Bearer {token}'})
        print(f"User {uid} status:", res.status_code)
        try:
            print(json.dumps(res.json, indent=2)[:500])
        except:
            print(res.data.decode()[:500])
            
    # Cleanup
    db.execute("UPDATE voting_phases SET is_active=0, status='draft' WHERE phase_number=1")
    db.execute("DELETE FROM nominations WHERE user_id=?", (uid,))
    db.commit()
    db.close()
