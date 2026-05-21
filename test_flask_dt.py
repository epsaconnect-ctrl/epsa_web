from flask import Flask, jsonify
from datetime import datetime

app = Flask(__name__)
with app.app_context():
    print(jsonify({'time': datetime.now()}).get_data(as_text=True))
