"""EPSA Students Routes"""
import uuid

from datetime import datetime, date

def _serialize_row(row):
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
try:
    from .models import get_db
    from .storage import save_upload
except ImportError:
    from models import get_db
    from storage import save_upload

students_bp = Blueprint('students', __name__)

@students_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    uid = get_jwt_identity()
    db  = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    tc  = db.execute("SELECT COUNT(*) FROM training_applications WHERE user_id=? AND status='registered'", (uid,)).fetchone()[0]
    cc  = db.execute("SELECT COUNT(*) FROM connections WHERE user_id=?", (uid,)).fetchone()[0]
    ec  = db.execute("SELECT COUNT(*) FROM exam_submissions WHERE user_id=?", (uid,)).fetchone()[0]
    fe  = db.execute(
        "SELECT 1 FROM face_embeddings WHERE user_id=? AND registration_verified=1 LIMIT 1",
        (uid,),
    ).fetchone()
    db.close()
    if not row: return jsonify({'error': 'Not found'}), 404
    u = _serialize_row(row); u.pop('password_hash', None)
    u['training_count']   = tc
    u['connection_count'] = cc
    u['exam_count']       = ec
    u['cert_count']       = tc   # certs = completed trainings
    u['face_registered']  = bool(fe)
    return jsonify(u)

@students_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    uid  = get_jwt_identity()
    data = request.json or {}
    db   = get_db()
    fields = ['bio', 'linkedin', 'field_of_study']
    updates = {k: data[k] for k in fields if k in data}
    if not updates: db.close(); return jsonify({'message': 'Nothing to update'})
    set_clause = ', '.join(f"{k}=?" for k in updates)
    db.execute(f"UPDATE users SET {set_clause} WHERE id=?", (*updates.values(), uid))
    db.commit(); db.close()
    return jsonify({'message': 'Profile updated'})

@students_bp.route('', methods=['GET'])
@jwt_required()
def list_students():
    uid = get_jwt_identity()
    uni = request.args.get('university','')
    q   = request.args.get('q','').strip().lower()
    db  = get_db()
    if uni:
        rows = db.execute("""
            SELECT u.id,u.first_name,u.father_name,u.university,u.program_type,u.academic_year,u.profile_photo,u.bio,u.linkedin,
                   EXISTS(SELECT 1 FROM connections c WHERE c.user_id=? AND c.connected_id=u.id) as connected,
                   EXISTS(SELECT 1 FROM network_follows nf WHERE nf.follower_id=? AND nf.followee_id=u.id) as following,
                   (SELECT COUNT(*) FROM club_members cm WHERE cm.user_id=u.id) as club_count
            FROM users u
            WHERE u.role='student' AND u.status='approved' AND u.university=? AND u.id!=?
        """, (uid, uid, uni, uid)).fetchall()
    else:
        rows = db.execute("""
            SELECT u.id,u.first_name,u.father_name,u.university,u.program_type,u.academic_year,u.profile_photo,u.bio,u.linkedin,
                   EXISTS(SELECT 1 FROM connections c WHERE c.user_id=? AND c.connected_id=u.id) as connected,
                   EXISTS(SELECT 1 FROM network_follows nf WHERE nf.follower_id=? AND nf.followee_id=u.id) as following,
                   (SELECT COUNT(*) FROM club_members cm WHERE cm.user_id=u.id) as club_count
            FROM users u
            WHERE u.role='student' AND u.status='approved' AND u.id!=?
        """, (uid, uid, uid)).fetchall()
    db.close()
    result = []
    for r in rows:
        d = _serialize_row(r)
        if q:
            hay = f"{d['first_name']} {d['father_name']} {d['university']} {d.get('program_type') or ''} {d.get('bio') or ''}".lower()
            if q not in hay:
                continue
        result.append(d)
    return jsonify(result)

@students_bp.route('/<int:sid>', methods=['GET'])
@jwt_required()
def get_student(sid):
    uid = get_jwt_identity()
    db  = get_db()
    row = db.execute("""
        SELECT id,first_name,father_name,university,program_type,academic_year,profile_photo,bio,linkedin,email,
               EXISTS(SELECT 1 FROM connections c WHERE c.user_id=? AND c.connected_id=users.id) as connected
        FROM users
        WHERE id=? AND role='student' AND status='approved'
    """, (uid, sid)).fetchone()
    clubs = db.execute("""
        SELECT c.id, c.name, c.university, cm.role
        FROM club_members cm JOIN clubs c ON c.id = cm.club_id
        WHERE cm.user_id=?
        ORDER BY c.name
    """, (sid,)).fetchall()
    db.close()
    if not row: return jsonify({'error': 'Not found'}), 404
    data = _serialize_row(row)
    data['clubs'] = [dict(c) for c in clubs]
    return jsonify(data)

@students_bp.route('/<int:sid>/connect', methods=['POST'])
@jwt_required()
def connect(sid):
    uid = get_jwt_identity()
    if uid == sid: return jsonify({'error': 'Cannot connect with yourself'}), 400
    db  = get_db()
    try:
        db.execute("INSERT OR IGNORE INTO connections (user_id, connected_id) VALUES (?,?)", (uid, sid))
        db.execute("INSERT OR IGNORE INTO connections (user_id, connected_id) VALUES (?,?)", (sid, uid))
        db.commit()
    finally: db.close()
    return jsonify({'message': 'Connected'})

@students_bp.route('/<int:sid>/disconnect', methods=['DELETE'])
@jwt_required()
def disconnect(sid):
    uid = get_jwt_identity()
    db  = get_db()
    db.execute("DELETE FROM connections WHERE (user_id=? AND connected_id=?) OR (user_id=? AND connected_id=?)", (uid,sid,sid,uid))
    db.commit(); db.close()
    return jsonify({'message': 'Disconnected'})


@students_bp.route('/nrc/portal', methods=['GET'])
@jwt_required()
def nrc_portal():
    uid = get_jwt_identity()
    db = get_db()
    member = db.execute("""
        SELECT n.*, u.first_name||' '||u.father_name as name, u.student_id, u.email, u.university as user_university
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        WHERE n.user_id=?
        ORDER BY n.id DESC LIMIT 1
    """, (uid,)).fetchone()
    if not member:
        db.close()
        return jsonify({'active': False, 'message': 'You are not currently serving as an NRC representative.'})
    db.execute("UPDATE nrc_members SET last_activity_at=DATETIME('now'), updated_at=DATETIME('now') WHERE id=?", (member['id'],))
    students = db.execute("""
        SELECT id, first_name, father_name, student_id, email, academic_year, program_type
        FROM users
        WHERE role='student' AND status='approved' AND university=?
        ORDER BY first_name, father_name
        LIMIT 30
    """, (member['university'],)).fetchall()
    documents = db.execute("""
        SELECT * FROM nrc_documents
        WHERE nrc_member_id=?
        ORDER BY submitted_at DESC
    """, (member['id'],)).fetchall()
    peers = db.execute("""
        SELECT n.id, n.university, n.status, n.eligibility_status,
               u.id as user_id, u.first_name||' '||u.father_name as name
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        WHERE n.status IN ('active','inactive','suspended')
        ORDER BY n.university
    """).fetchall()
    announcements = db.execute("""
        SELECT id, title, category, excerpt, created_at
        FROM news_events
        ORDER BY is_featured DESC, created_at DESC
        LIMIT 6
    """).fetchall()
    cycles = db.execute("""
        SELECT * FROM governance_election_cycles
        WHERE (body_type='NRC' AND (scope_value=? OR scope_type='all'))
           OR (body_type='NEC' AND cycle_type='mid_term')
        ORDER BY triggered_at DESC
        LIMIT 10
    """, (member['university'],)).fetchall()
    db.commit()
    db.close()
    return jsonify({
        'active': member['status'] == 'active',
        'member': dict(member),
        'students': [_serialize_row(r) for r in students],
        'documents': [_serialize_row(r) for r in documents],
        'peers': [_serialize_row(r) for r in peers],
        'announcements': [_serialize_row(r) for r in announcements],
        'cycles': [_serialize_row(r) for r in cycles],
        'responsibilities': [
            'Represent psychology students from your university accurately and actively.',
            'Promote EPSA initiatives and participate in governance discussions.',
            'Submit reports and transition materials before term completion or replacement.'
        ]
    })


@students_bp.route('/nrc/documents', methods=['POST'])
@jwt_required()
def upload_nrc_document():
    uid = get_jwt_identity()
    db = get_db()
    member = db.execute("""
        SELECT id, status
        FROM nrc_members
        WHERE user_id=?
        ORDER BY id DESC LIMIT 1
    """, (uid,)).fetchone()
    if not member or member['status'] not in ('active', 'inactive', 'suspended'):
        db.close()
        return jsonify({'error': 'Only NRC members can submit representative documents'}), 403
    data = request.form
    title = (data.get('title') or '').strip()
    if not title:
        db.close()
        return jsonify({'error': 'title is required'}), 400
    file = request.files.get('document')
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'bin'
        filename = save_upload(file, 'governance_docs', filename=f"nrc_{uuid.uuid4().hex[:10]}.{ext}")
    db.execute("""
        INSERT INTO nrc_documents (nrc_member_id, title, document_type, summary, file_path)
        VALUES (?, ?, ?, ?, ?)
    """, (member['id'], title, data.get('document_type', 'report'), data.get('summary', ''), filename))
    db.execute("UPDATE nrc_members SET last_activity_at=DATETIME('now'), updated_at=DATETIME('now') WHERE id=?", (member['id'],))
    db.commit()
    db.close()
    return jsonify({'message': 'Representative document submitted successfully'})
