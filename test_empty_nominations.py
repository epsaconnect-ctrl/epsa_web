import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')
from app import app
from models import get_db
from flask_jwt_extended import create_access_token

with app.app_context():
    db = get_db()
    db.execute("UPDATE voting_phases SET is_active=1, status='active' WHERE phase_number=1")
    u = db.execute("SELECT id FROM users LIMIT 1").fetchone()
    uid = u['id']
    token = create_access_token(identity=str(uid))

    with app.test_client() as client:
        res = client.get('/api/voting/candidates?phase=1', headers={'Authorization': f'Bearer {token}'})
        print('Status:', res.status_code)
        print(res.data.decode()[:500])

    db.execute("UPDATE voting_phases SET is_active=0, status='draft' WHERE phase_number=1")
    db.commit()
    db.close()
