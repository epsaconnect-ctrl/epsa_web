import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')

from app import app
from models import get_db
from flask_jwt_extended import create_access_token
import json

with app.app_context():
    db = get_db()
    users = db.execute("SELECT id FROM users LIMIT 5").fetchall()
    db.close()
    
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
