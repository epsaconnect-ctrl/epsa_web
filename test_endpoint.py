import os, sys
sys.path.append('backend')
from app import create_app

app = create_app()

with app.test_request_context('/api/voting/candidates?phase=2'):
    from flask_jwt_extended import create_access_token
    token = create_access_token(identity="1")
    
with app.test_client() as client:
    res = client.get('/api/voting/candidates?phase=2', headers={'Authorization': f'Bearer {token}'})
    print(res.status_code)
    print(res.data.decode())
