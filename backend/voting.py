"""EPSA Voting Routes"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import get_db
from storage import save_upload

voting_bp = Blueprint('voting', __name__)


def _vote_uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _active_phase(db, requested_phase=None, fallback_to_any=False):
    if requested_phase is not None:
        phase = db.execute("""
            SELECT * FROM voting_phases
            WHERE phase_number=? AND is_active=1 AND status='active'
        """, (requested_phase,)).fetchone()
        if phase:
            return phase
        if not fallback_to_any:
            return None
    return db.execute("""
        SELECT * FROM voting_phases
        WHERE is_active=1 AND status='active'
        ORDER BY phase_number ASC
        LIMIT 1
    """).fetchone()

@voting_bp.route('/candidates', methods=['GET'])
@jwt_required()
def get_candidates():
    uid = _vote_uid()
    phase = request.args.get('phase', 1, type=int)
    db    = get_db()
    if uid is None:
        db.close()
        return jsonify({'error': 'Invalid session', 'active': False, 'candidates': [], 'my_nomination': None}), 401
    user  = db.execute("SELECT university FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        db.close()
        return jsonify({'error': 'User not found', 'active': False, 'candidates': [], 'my_nomination': None}), 404

    # Try to auto-detect active phase from DB if caller wants "auto"
    vote_phase = _active_phase(db, requested_phase=phase, fallback_to_any=True)
    if not vote_phase: db.close(); return jsonify({'active': False, 'candidates': [], 'my_nomination': None})

    actual_phase = vote_phase['phase_number']

    if actual_phase == 1:
        rows = db.execute("""
            SELECT n.id, n.is_approved, u.id as user_id, u.first_name||' '||u.father_name as name,
                   u.university, u.program_type, u.academic_year, u.profile_photo,
                   n.statement, n.vision, n.manifesto_path, n.video_url, n.bio,
                   COUNT(v.id) as vote_count
            FROM nominations n JOIN users u ON n.user_id=u.id
            LEFT JOIN votes v ON v.candidate_id=u.id AND v.phase_id=n.phase_id
            WHERE n.phase_id=? AND n.is_approved=1 AND u.university=?
            GROUP BY n.id ORDER BY vote_count DESC
        """, (vote_phase['id'], user['university'])).fetchall()
    else:
        rows = db.execute("""
            SELECT n.id, n.is_approved, u.id as user_id, u.first_name||' '||u.father_name as name,
                   u.university, n.position, u.profile_photo,
                   n.statement, n.vision, n.manifesto_path, n.video_url, n.bio,
                   COUNT(v.id) as vote_count
            FROM nominations n JOIN users u ON n.user_id=u.id
            LEFT JOIN votes v ON v.candidate_id=u.id AND v.phase_id=n.phase_id
            WHERE n.phase_id=? AND n.is_approved=1
            GROUP BY n.id ORDER BY vote_count DESC
        """, (vote_phase['id'],)).fetchall()

    my_vote = db.execute("SELECT candidate_id FROM votes WHERE voter_id=? AND phase_id=?", (uid, vote_phase['id'])).fetchone()

    # Check if the logged-in student has their own nomination (even if pending/rejected — so they can see their card)
    my_nom = db.execute("""
        SELECT n.id, n.is_approved, n.position, n.bio, n.statement, n.vision, n.manifesto_path, n.video_url,
               u.id as user_id, u.first_name||' '||u.father_name as name, u.university,
               u.program_type, u.academic_year, u.profile_photo,
               COUNT(v.id) as vote_count
        FROM nominations n JOIN users u ON n.user_id=u.id
        LEFT JOIN votes v ON v.candidate_id=u.id AND v.phase_id=n.phase_id
        WHERE n.phase_id=? AND n.user_id=?
        GROUP BY n.id LIMIT 1
    """, (vote_phase['id'], uid)).fetchone()

    db.close()

    candidates = [dict(r) for r in rows]
    my_nomination = dict(my_nom) if my_nom else None

    # If the student is nominated but pending/rejected, inject their card at top so they can see it
    if my_nomination and my_nomination.get('is_approved') != 1:
        my_nomination['_is_self_pending'] = True

    return jsonify({
        'active':        True,
        'phase':         dict(vote_phase),
        'candidates':    candidates,
        'my_vote_id':    my_vote['candidate_id'] if my_vote else None,
        'my_nomination': my_nomination,
    })

@voting_bp.route('/nominate', methods=['POST'])
@jwt_required()
def nominate():
    import secrets
    from werkzeug.utils import secure_filename
    
    uid = _vote_uid()
    db   = get_db()
    if uid is None:
        db.close()
        return jsonify({'error': 'Invalid session'}), 401
    
    # Check for form data since we accept files now
    data = request.form
    phase_num = data.get('phase', 1, type=int)
    
    phase = _active_phase(db, requested_phase=phase_num)
    if not phase: db.close(); return jsonify({'error': 'No active voting phase'}), 400
    user_row = db.execute("""
        SELECT id, graduation_year, graduation_status, university, status
        FROM users WHERE id=?
    """, (uid,)).fetchone()
    if not user_row or user_row['status'] != 'approved':
        db.close(); return jsonify({'error': 'Only approved EPSA members can nominate themselves'}), 403
    if (user_row['graduation_status'] or '').lower() == 'graduated':
        db.close(); return jsonify({'error': 'Graduated members cannot run for office'}), 403
    if phase_num == 2:
        nrc_member = db.execute("""
            SELECT id, status, eligibility_status
            FROM nrc_members
            WHERE user_id=? AND status='active' AND eligibility_status='eligible'
            ORDER BY id DESC LIMIT 1
        """, (uid,)).fetchone()
        if not nrc_member:
            db.close(); return jsonify({'error': 'Only active and eligible NRC members can run for Executive Committee positions'}), 403
    
    manifesto_name = None
    if 'manifesto' in request.files:
        f = request.files['manifesto']
        if f and '.' in f.filename and f.filename.rsplit('.',1)[1].lower() in {'pdf'}:
            manifesto_name = secure_filename(f"{secrets.token_hex(8)}_{f.filename}")
            manifesto_name = save_upload(f, 'manifestos', filename=manifesto_name)

    try:
        db.execute("""
            INSERT INTO nominations (user_id, phase_id, position, bio, statement, vision, manifesto_path, video_url) 
            VALUES (?,?,?,?,?,?,?,?)
        """, (uid, phase['id'], data.get('position','Representative'), data.get('bio',''), 
              data.get('statement',''), data.get('vision',''), manifesto_name, data.get('video_url','')))
        db.commit()
    except Exception as e:
        db.close(); return jsonify({'error': 'Already nominated'}), 409
    db.close()
    return jsonify({'message': 'Nomination submitted. Awaiting admin approval.'})

@voting_bp.route('/vote', methods=['POST'])
@jwt_required()
def cast_vote():
    uid = _vote_uid()
    candidate_id = (request.json or {}).get('candidate_id')
    if not candidate_id: return jsonify({'error': 'candidate_id required'}), 400
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db = get_db()
    # Get active phase
    phase = _active_phase(db)
    if not phase: db.close(); return jsonify({'error': 'No active voting phase'}), 400
    # Check already voted
    existing = db.execute("SELECT id FROM votes WHERE voter_id=? AND phase_id=?", (uid, phase['id'])).fetchone()
    if existing: db.close(); return jsonify({'error': 'You have already voted in this phase'}), 409
    # Verify candidate exists in this phase
    nom = db.execute("SELECT * FROM nominations WHERE user_id=? AND phase_id=? AND is_approved=1", (candidate_id, phase['id'])).fetchone()
    if not nom: db.close(); return jsonify({'error': 'Invalid candidate'}), 400
    
    if phase['phase_number'] == 1:
        voter_uni = db.execute("SELECT university FROM users WHERE id=?", (uid,)).fetchone()['university']
        cand_uni = db.execute("SELECT university FROM users WHERE id=?", (candidate_id,)).fetchone()['university']
        if voter_uni != cand_uni:
            db.close(); return jsonify({'error': 'You can only vote for candidates from your university in Phase 1'}), 403

    db.execute("INSERT INTO votes (voter_id, candidate_id, phase_id) VALUES (?,?,?)", (uid, candidate_id, phase['id']))
    db.commit(); db.close()
    return jsonify({'message': 'Vote cast successfully'})

@voting_bp.route('/results', methods=['GET'])
@jwt_required()
def results():
    db   = get_db()
    rows = db.execute("""
        SELECT u.first_name||' '||u.father_name as name, u.university,
               n.position, COUNT(v.id) as votes
        FROM nominations n JOIN users u ON n.user_id=u.id
        LEFT JOIN votes v ON v.candidate_id=u.id
        WHERE n.is_approved=1
        GROUP BY n.id ORDER BY votes DESC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])
