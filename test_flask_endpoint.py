import sys
sys.path.insert(0, r'c:\Users\dawit\Desktop\EPSA WEB\backend')

from app import create_app
from flask_jwt_extended import create_access_token

app = create_app()

with app.app_context():
    token = create_access_token(identity="1")
    
with app.test_client() as client:
    res = client.get('/api/voting/candidates?phase=1', headers={'Authorization': f'Bearer {token}'})
    print("Phase 1:", res.status_code)
    print(res.data.decode())

    res2 = client.get('/api/voting/candidates?phase=2', headers={'Authorization': f'Bearer {token}'})
    print("Phase 2:", res2.status_code)
    print(res2.data.decode())
