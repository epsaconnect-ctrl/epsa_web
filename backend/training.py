"""EPSA Training Routes"""
import secrets
from datetime import datetime, date

def _serialize_row(row):
    d = _serialize_row(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
try:
    from .models import get_db
    from .storage import save_upload
except ImportError:
    from models import get_db
    from storage import save_upload

training_bp = Blueprint('trainings', __name__)

@training_bp.route('', methods=['GET'])
@jwt_required()
def list_trainings():
    uid = get_jwt_identity()
    db  = get_db()
    rows = db.execute("SELECT * FROM trainings WHERE is_active=1 ORDER BY created_at DESC").fetchall()
    result = []
    for r in rows:
        t = _serialize_row(r)
        app = db.execute("SELECT status FROM training_applications WHERE user_id=? AND training_id=?", (uid, r['id'])).fetchone()
        t['status'] = app['status'] if app else 'open'
        result.append(t)
    db.close()
    return jsonify(result)

@training_bp.route('/<int:tid>', methods=['GET'])
@jwt_required()
def get_training(tid):
    db  = get_db()
    row = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
    db.close()
    if not row: return jsonify({'error': 'Not found'}), 404
    return jsonify(_serialize_row(row))

@training_bp.route('/<int:tid>/apply', methods=['POST'])
@jwt_required()
def apply_training(tid):
    uid = get_jwt_identity()
    db  = get_db()
    training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
    if not training: db.close(); return jsonify({'error': 'Training not found'}), 404
    existing = db.execute("SELECT * FROM training_applications WHERE user_id=? AND training_id=?", (uid, tid)).fetchone()
    if existing: db.close(); return jsonify({'error': 'Already applied', 'status': existing['status']}), 409

    if training['is_free']:
        db.execute("INSERT INTO training_applications (user_id, training_id, status) VALUES (?,?,'registered')", (uid, tid))
        db.commit(); db.close()
        return jsonify({'message': 'Enrolled successfully', 'status': 'registered'})
    else:
        db.execute("INSERT INTO training_applications (user_id, training_id, status) VALUES (?,?,'applied')", (uid, tid))
        db.commit(); db.close()
        return jsonify({'message': 'Applied. Please upload payment receipt.', 'status': 'applied'})

@training_bp.route('/<int:tid>/receipt', methods=['POST'])
@jwt_required()
def upload_receipt(tid):
    uid  = get_jwt_identity()
    file = request.files.get('receipt')
    if not file: return jsonify({'error': 'Receipt file required'}), 400
    fname = secure_filename(f"{secrets.token_hex(8)}_{file.filename}")
    save_upload(file, 'receipts', filename=fname)
    db = get_db()
    db.execute("UPDATE training_applications SET status='receipt', receipt_path=? WHERE user_id=? AND training_id=?", (fname, uid, tid))
    db.commit(); db.close()
    return jsonify({'message': 'Receipt submitted', 'status': 'receipt'})

@training_bp.route('/mine', methods=['GET'])
@jwt_required()
def my_trainings():
    uid = get_jwt_identity()
    db  = get_db()
    rows = db.execute("""
        SELECT t.*, ta.status as app_status, ta.submitted_at
        FROM trainings t JOIN training_applications ta ON t.id=ta.training_id
        WHERE ta.user_id=? ORDER BY ta.submitted_at DESC
    """, (uid,)).fetchall()
    db.close()
    return jsonify([_serialize_row(r) for r in rows])
