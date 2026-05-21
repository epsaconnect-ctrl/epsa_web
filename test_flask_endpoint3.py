import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')

from app import app
from flask_jwt_extended import create_access_token
import json

with app.app_context():
    token = create_access_token(identity="1")

with app.test_client() as client:
    for phase in [1, 2]:
        res = client.get(f'/api/voting/candidates?phase={phase}', headers={'Authorization': f'Bearer {token}'})
        print(f"Phase {phase} status:", res.status_code)
        try:
            print(json.dumps(res.json, indent=2)[:500])
        except:
            print(res.data.decode()[:500])
