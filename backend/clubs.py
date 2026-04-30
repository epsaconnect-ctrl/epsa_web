"""EPSA Clubs & Grants Routes"""
from datetime import datetime, date

def _serialize_row(row):
    d = _serialize_row(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import uuid

try:
    from .models import get_db
    from .storage import save_upload, upload_url
except ImportError:
    from models import get_db
    from storage import save_upload, upload_url

clubs_bp = Blueprint('clubs', __name__)

# ─── PUBLIC: List Verified/Approved Clubs ───────────────────────────
@clubs_bp.route('', methods=['GET'])
def list_clubs():
    db = get_db()
    rows = db.execute("""
        SELECT c.*, u.first_name||' '||u.father_name as president_name,
               (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id) as live_member_count,
               (SELECT COUNT(*) FROM club_follows cf WHERE cf.club_id = c.id) as follower_count,
               (SELECT COUNT(*) FROM club_activities ca WHERE ca.club_id = c.id) as activity_count
        FROM clubs c LEFT JOIN users u ON c.president_id = u.id
        WHERE c.status='approved' ORDER BY c.created_at DESC
    """).fetchall()
    result = []
    for r in rows:
        d = _serialize_row(r)
        if d['logo_path']:
            d['logo_url'] = upload_url('clubs', d['logo_path'])
        preview = db.execute("""
            SELECT image_path FROM club_activities
            WHERE club_id=? AND image_path IS NOT NULL AND image_path != ''
            ORDER BY created_at DESC LIMIT 1
        """, (d['id'],)).fetchone()
        if preview and preview['image_path']:
            d['cover_image_url'] = upload_url('club_activities', preview['image_path'])
        elif d.get('logo_url'):
            d['cover_image_url'] = d['logo_url']
        # Fetch leadership
        leaders = db.execute("""
            SELECT cl.role, u.first_name||' '||u.father_name as name, u.student_id
            FROM club_leadership cl JOIN users u ON cl.user_id = u.id
            WHERE cl.club_id=? ORDER BY cl.role
        """, (d['id'],)).fetchall()
        d['leadership'] = [dict(l) for l in leaders]
        result.append(d)
    db.close()
    return jsonify(result)

@clubs_bp.route('/<int:cid>', methods=['GET'])
def get_club(cid):
    db = get_db()
    club = db.execute("""
        SELECT c.*, u.first_name||' '||u.father_name as president_name
        FROM clubs c LEFT JOIN users u ON c.president_id = u.id WHERE c.id=?
    """, (cid,)).fetchone()
    if not club: db.close(); return jsonify({'error': 'Not found'}), 404
    members = db.execute("""
        SELECT cm.role, u.first_name, u.father_name, u.university, u.student_id, u.profile_photo
        FROM club_members cm JOIN users u ON cm.user_id = u.id WHERE cm.club_id=?
    """, (cid,)).fetchall()
    db.close()
    d = dict(club)
    if d['logo_path']: d['logo_url'] = upload_url('clubs', d['logo_path'])
    d['members'] = [dict(m) for m in members]
    return jsonify(d)

# ─── STUDENT: Register a Club ────────────────────────────────────────
@clubs_bp.route('/register', methods=['POST'])
@jwt_required()
def register_club():
    uid  = get_jwt_identity()
    data = request.form
    file = request.files.get('logo')
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1]
        filename = save_upload(file, 'clubs', filename=f"club_{uuid.uuid4().hex[:8]}.{ext}")
    db = get_db()
    # Validate student is approved
    u = db.execute("SELECT status, university FROM users WHERE id=?", (uid,)).fetchone()
    if not u or u['status'] != 'approved':
        db.close(); return jsonify({'error': 'Only approved EPSA members can register clubs'}), 403
    
    # Validate VP and Secretary IDs
    vp_sid = data.get('vp_student_id', '').strip()
    sec_sid = data.get('sec_student_id', '').strip()
    vp_user = db.execute("SELECT id FROM users WHERE student_id=? AND status='approved'", (vp_sid,)).fetchone() if vp_sid else None
    sec_user = db.execute("SELECT id FROM users WHERE student_id=? AND status='approved'", (sec_sid,)).fetchone() if sec_sid else None
    
    if not vp_user:
        db.close(); return jsonify({'error': f'Vice President EPSA ID ({vp_sid}) not found or student is not approved.'}), 404
    if not sec_user:
        db.close(); return jsonify({'error': f'Secretary EPSA ID ({sec_sid}) not found or student is not approved.'}), 404
    if vp_user['id'] == uid or sec_user['id'] == uid or vp_user['id'] == sec_user['id']:
        db.close(); return jsonify({'error': 'President, VP, and Secretary must be different users.'}), 400

    member_count = int(data.get('member_count', 5))

    cur = db.execute("""
        INSERT INTO clubs (name, university, year_established, logo_path, description, president_id, member_count, status)
        VALUES (?,?,?,?,?,?,?,'pending')
    """, (data.get('name'), data.get('university', u['university']),
          data.get('year_established'), filename, data.get('description'), 
          uid, member_count))
    club_id = cur.lastrowid
    
    # Auto-add leadership as members
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?,?,'president')", (club_id, uid))
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?,?,'vice president')", (club_id, vp_user['id']))
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?,?,'secretary')", (club_id, sec_user['id']))
    
    db.execute("INSERT OR IGNORE INTO club_leadership (club_id, user_id, role) VALUES (?,?,?)", (club_id, uid, 'President'))
    db.execute("INSERT OR IGNORE INTO club_leadership (club_id, user_id, role) VALUES (?,?,?)", (club_id, vp_user['id'], 'Vice President'))
    db.execute("INSERT OR IGNORE INTO club_leadership (club_id, user_id, role) VALUES (?,?,?)", (club_id, sec_user['id'], 'Secretary'))

    db.commit(); db.close()
    return jsonify({'message': 'Club registration submitted for admin approval', 'club_id': club_id}), 201

# ─── STUDENT: My Clubs ───────────────────────────────────────────────
@clubs_bp.route('/mine', methods=['GET'])
@jwt_required()
def my_clubs():
    uid = get_jwt_identity()
    db  = get_db()
    rows = db.execute("""
        SELECT c.*, cm.role as my_role
        FROM club_members cm JOIN clubs c ON cm.club_id = c.id
        WHERE cm.user_id=? ORDER BY c.name
    """, (uid,)).fetchall()
    db.close()
    result = []
    for r in rows:
        d = _serialize_row(r)
        if d['logo_path']: d['logo_url'] = upload_url('clubs', d['logo_path'])
        result.append(d)
    return jsonify(result)

# ─── CLUB PRESIDENT: Add/Remove Members ─────────────────────────────
@clubs_bp.route('/<int:cid>/members', methods=['POST'])
@jwt_required()
def add_member(cid):
    uid     = get_jwt_identity()
    data    = request.json or {}
    student_id = data.get('student_id', '').strip()
    db = get_db()
    # Verify requester is president
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only the club president can add members'}), 403
    # Find student by EPSA ID
    target = db.execute("SELECT id FROM users WHERE student_id=? AND status='approved'", (student_id,)).fetchone()
    if not target:
        db.close(); return jsonify({'error': 'Student not found or not approved'}), 404
    try:
        db.execute("INSERT INTO club_members (club_id, user_id, role) VALUES (?,?,'member')", (cid, target['id']))
        db.execute("UPDATE clubs SET member_count = member_count + 1 WHERE id=?", (cid,))
        db.commit()
        return jsonify({'message': 'Member added'})
    except Exception:
        return jsonify({'error': 'Member already in club'}), 409
    finally:
        db.close()

@clubs_bp.route('/<int:cid>/members/<int:mid>', methods=['DELETE'])
@jwt_required()
def remove_member(cid, mid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can remove members'}), 403
    db.execute("DELETE FROM club_members WHERE club_id=? AND user_id=?", (cid, mid))
    db.execute("UPDATE clubs SET member_count = MAX(0, member_count - 1) WHERE id=?", (cid,))
    db.commit(); db.close()
    return jsonify({'message': 'Member removed'})

# ─── CLUB PRESIDENT: Grant Proposals ────────────────────────────────
@clubs_bp.route('/<int:cid>/proposals', methods=['GET'])
@jwt_required()
def list_proposals(cid):
    uid = get_jwt_identity()
    db  = get_db()
    rows = db.execute("SELECT * FROM proposals WHERE club_id=? ORDER BY submitted_at DESC", (cid,)).fetchall()
    db.close()
    return jsonify([_serialize_row(r) for r in rows])

@clubs_bp.route('/<int:cid>/proposals', methods=['POST'])
@jwt_required()
def submit_proposal(cid):
    uid  = get_jwt_identity()
    data = request.form
    file = request.files.get('attachment')
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1]
        filename = save_upload(file, 'proposals', filename=f"prop_{uuid.uuid4().hex[:8]}.{ext}")
    db = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can submit proposals'}), 403
    db.execute("""
        INSERT INTO proposals (club_id, title, objective, budget, timeline, attachment_path)
        VALUES (?,?,?,?,?,?)
    """, (cid, data.get('title'), data.get('objective'), float(data.get('budget', 0)),
          data.get('timeline'), filename))
    db.commit(); db.close()
    return jsonify({'message': 'Proposal submitted'}), 201

# ─── CLUB: Financial Report ──────────────────────────────────────────
@clubs_bp.route('/proposals/<int:pid>/report', methods=['POST'])
@jwt_required()
def submit_proposal_financial_report(pid):
    uid  = get_jwt_identity()
    data = request.form
    file = request.files.get('receipt')
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1]
        filename = save_upload(file, 'fin_receipts', filename=f"receipt_{uuid.uuid4().hex[:8]}.{ext}")
    db = get_db()
    prop = db.execute("SELECT club_id FROM proposals WHERE id=?", (pid,)).fetchone()
    if not prop: db.close(); return jsonify({'error': 'Proposal not found'}), 404
    db.execute("""
        INSERT INTO financial_reports (proposal_id, club_id, receipt_path, expense_details, total_spent)
        VALUES (?,?,?,?,?)
    """, (pid, prop['club_id'], filename, data.get('expense_details'), float(data.get('total_spent', 0))))
    db.execute("UPDATE proposals SET status='awaiting_verification' WHERE id=?", (pid,))
    db.commit(); db.close()
    return jsonify({'message': 'Financial report submitted for admin verification'}), 201

# ─── CLUB LEADERSHIP (VP, Secretary, etc.) ───────────────────────
@clubs_bp.route('/<int:cid>/leadership', methods=['GET'])
def get_leadership(cid):
    db = get_db()
    rows = db.execute("""
        SELECT cl.role, u.first_name||' '||u.father_name as name,
               u.student_id, u.university, u.profile_photo
        FROM club_leadership cl JOIN users u ON cl.user_id = u.id
        WHERE cl.club_id=? ORDER BY cl.role
    """, (cid,)).fetchall()
    db.close()
    return jsonify([_serialize_row(r) for r in rows])

@clubs_bp.route('/<int:cid>/leadership', methods=['POST'])
@jwt_required()
def set_leadership(cid):
    uid  = get_jwt_identity()
    data = request.json or {}
    db   = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can set leadership'}), 403
    student_id = data.get('student_id','').strip()
    role       = data.get('role','').strip()
    if not student_id or not role:
        db.close(); return jsonify({'error': 'student_id and role required'}), 400
    target = db.execute("SELECT id FROM users WHERE student_id=? AND status='approved'", (student_id,)).fetchone()
    if not target:
        db.close(); return jsonify({'error': 'Student not found or not approved'}), 404
    # Ensure member
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?,?,?)", (cid, target['id'], role))
    existing_role = db.execute(
        "SELECT id FROM club_leadership WHERE club_id=? AND user_id=?",
        (cid, target['id']),
    ).fetchone()
    if existing_role:
        db.execute("UPDATE club_leadership SET role=? WHERE id=?", (role, existing_role['id']))
    else:
        db.execute("INSERT INTO club_leadership (club_id, user_id, role) VALUES (?,?,?)", (cid, target['id'], role))
    # Update specific columns
    if role.lower() in ('vice president', 'vp'):
        db.execute("UPDATE clubs SET vp_id=? WHERE id=?", (target['id'], cid))
    elif role.lower() == 'secretary':
        db.execute("UPDATE clubs SET secretary_id=? WHERE id=?", (target['id'], cid))
    db.commit(); db.close()
    return jsonify({'message': f'{role} assigned successfully'}), 201

@clubs_bp.route('/<int:cid>/leadership/<int:lid>', methods=['DELETE'])
@jwt_required()
def remove_leadership(cid, lid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only president can remove leadership roles'}), 403
    db.execute("DELETE FROM club_leadership WHERE club_id=? AND user_id=?", (cid, lid))
    db.commit(); db.close()
    return jsonify({'message': 'Leadership role removed'})

# ─── FOLLOW/UNFOLLOW CLUBS ───────────────────────────────────────
@clubs_bp.route('/<int:cid>/follow', methods=['POST'])
@jwt_required()
def toggle_follow(cid):
    uid = get_jwt_identity()
    db  = get_db()
    existing = db.execute("SELECT id FROM club_follows WHERE user_id=? AND club_id=?", (uid, cid)).fetchone()
    if existing:
        db.execute("DELETE FROM club_follows WHERE user_id=? AND club_id=?", (uid, cid))
        following = False
    else:
        db.execute("INSERT INTO club_follows (user_id, club_id) VALUES (?,?)", (uid, cid))
        following = True
    count = db.execute("SELECT COUNT(*) as c FROM club_follows WHERE club_id=?", (cid,)).fetchone()['c']
    db.commit(); db.close()
    return jsonify({'following': following, 'followers': count})

@clubs_bp.route('/<int:cid>/follow', methods=['GET'])
@jwt_required()
def follow_status(cid):
    uid = get_jwt_identity()
    db  = get_db()
    existing = db.execute("SELECT id FROM club_follows WHERE user_id=? AND club_id=?", (uid, cid)).fetchone()
    count    = db.execute("SELECT COUNT(*) as c FROM club_follows WHERE club_id=?", (cid,)).fetchone()['c']
    db.close()
    return jsonify({'following': bool(existing), 'followers': count})

# ─── CLUB ACTIVITIES (Events, Posts, Announcements) ──────────────
@clubs_bp.route('/<int:cid>/activities', methods=['GET'])
def list_activities(cid):
    db   = get_db()
    rows = db.execute("""
        SELECT ca.*, u.first_name||' '||u.father_name as author_name
        FROM club_activities ca JOIN users u ON ca.posted_by = u.id
        WHERE ca.club_id=? ORDER BY ca.created_at DESC LIMIT 30
    """, (cid,)).fetchall()
    db.close()
    result = []
    for r in rows:
        d = _serialize_row(r)
        if d['image_path']: d['image_url'] = upload_url('club_activities', d['image_path'])
        result.append(d)
    return jsonify(result)

@clubs_bp.route('/<int:cid>/activities', methods=['POST'])
@jwt_required()
def post_activity(cid):
    uid  = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    file = request.files.get('image') if request.files else None
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1]
        filename = save_upload(file, 'club_activities', filename=f"act_{uuid.uuid4().hex[:8]}.{ext}")
    db = get_db()
    # Must be president, VP, or secretary
    mem = db.execute("SELECT role FROM club_members WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    if not mem or mem['role'] not in ('president','vice president','vp','secretary'):
        db.close(); return jsonify({'error': 'Only club leadership can post activities'}), 403
    title   = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    a_type  = data.get('activity_type', 'announcement')
    if not title:
        db.close(); return jsonify({'error': 'Title is required'}), 400
    cur = db.execute("""
        INSERT INTO club_activities (club_id, posted_by, activity_type, title, content, image_path)
        VALUES (?,?,?,?,?,?)
    """, (cid, uid, a_type, title, content, filename))
    act_id = cur.lastrowid
    # Also cross-post to network feed
    feed_content = f"[{a_type.upper()}] {title}" + (f"\n\n{content}" if content else '')
    db.execute("INSERT INTO network_posts (user_id, club_id, content, image_path, post_type) VALUES (?,?,?,?,?)",
               (uid, cid, feed_content, filename, 'club'))
    db.commit(); db.close()
    return jsonify({'message': 'Activity posted and synced to network feed', 'activity_id': act_id}), 201

# ─── FUNDING TRANSPARENCY (Public) ───────────────────────────────
@clubs_bp.route('/funding/overview', methods=['GET'])
def funding_overview():
    db = get_db()
    settings = {r['key']: r['value'] for r in db.execute("SELECT key, value FROM epsa_settings").fetchall()}
    # Funded proposals
    funded = db.execute("""
        SELECT p.*, c.name as club_name, c.university FROM proposals p
        JOIN clubs c ON p.club_id = c.id
        WHERE p.status IN ('funded','completed') ORDER BY p.reviewed_at DESC LIMIT 10
    """).fetchall()
    sources = db.execute("""
        SELECT gs.*, p.name as partner_name
        FROM grant_sources gs
        LEFT JOIN partners p ON p.id = gs.partner_id
        WHERE gs.status IN ('active','completed','pledged')
        ORDER BY COALESCE(gs.received_at, gs.created_at) DESC
        LIMIT 6
    """).fetchall()
    # Stats
    sourced_pool = db.execute("""
        SELECT COALESCE(SUM(amount_committed),0) as t
        FROM grant_sources
        WHERE status IN ('active','completed','pledged')
    """).fetchone()['t']
    total_funded = db.execute("SELECT COALESCE(SUM(CASE WHEN funded_amount > 0 THEN funded_amount ELSE budget END),0) as t FROM proposals WHERE status IN ('funded','completed')").fetchone()['t']
    total_spent  = db.execute("SELECT COALESCE(SUM(total_spent),0) as t FROM financial_reports WHERE status='verified'").fetchone()['t']
    pending_count = db.execute("SELECT COUNT(*) as c FROM proposals WHERE status='pending'").fetchone()['c']
    funded_clubs = db.execute("SELECT COUNT(DISTINCT club_id) as c FROM proposals WHERE status IN ('funded','completed')").fetchone()['c']
    available_balance = db.execute("""
        SELECT COALESCE(SUM(amount_received),0) as t
        FROM grant_sources
        WHERE status IN ('active','completed','pledged')
    """).fetchone()['t']
    db.close()
    return jsonify({
        'grant_pool_total': float(sourced_pool or settings.get('grant_pool_total', 500000)),
        'allocated_total': total_funded,
        'available_balance': available_balance,
        'verified_spend': total_spent,
        'grant_pool_description': settings.get('grant_pool_description', 'EPSA National Grant Pool'),
        'total_funded': total_funded,
        'total_spent': total_spent,
        'funded_clubs': funded_clubs,
        'pending_proposals': pending_count,
        'term_definitions': {
            'total_grant_pool': 'Total committed grant value recorded by EPSA from partners and individual supporters.',
            'funds_awarded': 'Money formally allocated by EPSA to approved club proposals.',
            'verified_spend': 'Portion of awarded money that has been checked and verified through submitted financial reports.',
            'available_balance': 'Amount still available for future allocations after existing funding decisions.'
        },
        'funded_projects': [_serialize_row(r) for r in funded],
        'grant_sources': [_serialize_row(r) for r in sources]
    })

# ─── CLUB JOIN REQUESTS ──────────────────────────────────────────
@clubs_bp.route('/<int:cid>/join', methods=['POST'])
@jwt_required()
def request_join(cid):
    uid = get_jwt_identity()
    db  = get_db()
    user = db.execute("SELECT university, status FROM users WHERE id=?", (uid,)).fetchone()
    if not user or user['status'] != 'approved':
        db.close(); return jsonify({'error': 'Only approved EPSA members can join clubs'}), 403
    club = db.execute("SELECT university, status FROM clubs WHERE id=?", (cid,)).fetchone()
    if not club or club['status'] != 'approved':
        db.close(); return jsonify({'error': 'Club not found or not approved'}), 404
    # University restriction
    if user['university'] != club['university']:
        db.close(); return jsonify({'error': 'You can only join clubs at your own university'}), 403
    # Check if already a member
    existing = db.execute("SELECT id FROM club_members WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    if existing:
        db.close(); return jsonify({'error': 'You are already a member of this club'}), 409
    # Check existing pending request
    req = db.execute("SELECT id, status FROM club_join_requests WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    if req:
        if req['status'] == 'pending':
            db.close(); return jsonify({'error': 'Join request already pending'}), 409
        if req['status'] == 'rejected':
            db.execute("UPDATE club_join_requests SET status='pending', requested_at=DATETIME('now') WHERE id=?", (req['id'],))
            db.commit(); db.close()
            return jsonify({'message': 'Join request re-submitted'})
    db.execute("INSERT INTO club_join_requests (club_id, user_id) VALUES (?,?)", (cid, uid))
    db.commit(); db.close()
    return jsonify({'message': 'Join request submitted — the club president will review it'}), 201

@clubs_bp.route('/<int:cid>/join-requests', methods=['GET'])
@jwt_required()
def list_join_requests(cid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can view join requests'}), 403
    rows = db.execute("""
        SELECT jr.*, u.first_name||' '||u.father_name as name, u.university, u.student_id, u.profile_photo
        FROM club_join_requests jr JOIN users u ON jr.user_id = u.id
        WHERE jr.club_id=? AND jr.status='pending' ORDER BY jr.requested_at DESC
    """, (cid,)).fetchall()
    db.close()
    return jsonify([_serialize_row(r) for r in rows])

@clubs_bp.route('/<int:cid>/join-requests/<int:jid>/approve', methods=['POST'])
@jwt_required()
def approve_join(cid, jid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can approve'}), 403
    jr = db.execute("SELECT user_id FROM club_join_requests WHERE id=? AND club_id=?", (jid, cid)).fetchone()
    if not jr: db.close(); return jsonify({'error': 'Request not found'}), 404
    db.execute("UPDATE club_join_requests SET status='approved', reviewed_at=DATETIME('now') WHERE id=?", (jid,))
    db.execute("INSERT OR IGNORE INTO club_members (club_id, user_id, role) VALUES (?,?,'member')", (cid, jr['user_id']))
    db.execute("UPDATE clubs SET member_count = member_count + 1 WHERE id=?", (cid,))
    db.commit(); db.close()
    return jsonify({'message': 'Member approved and added to club'})

@clubs_bp.route('/<int:cid>/join-requests/<int:jid>/reject', methods=['POST'])
@jwt_required()
def reject_join(cid, jid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can reject'}), 403
    db.execute("UPDATE club_join_requests SET status='rejected', reviewed_at=DATETIME('now') WHERE id=?", (jid,))
    db.commit(); db.close()
    return jsonify({'message': 'Join request rejected'})

@clubs_bp.route('/<int:cid>/join-status', methods=['GET'])
@jwt_required()
def join_status(cid):
    uid = get_jwt_identity()
    db  = get_db()
    member = db.execute("SELECT role FROM club_members WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    if member:
        db.close(); return jsonify({'status': 'member', 'role': member['role']})
    req = db.execute("SELECT status FROM club_join_requests WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    user = db.execute("SELECT university FROM users WHERE id=?", (uid,)).fetchone()
    club = db.execute("SELECT university FROM clubs WHERE id=?", (cid,)).fetchone()
    db.close()
    can_join = user and club and user['university'] == club['university']
    return jsonify({
        'status': req['status'] if req else 'none',
        'can_join': can_join
    })

# ─── SUPPORT REQUESTS ───────────────────────────────────────────
@clubs_bp.route('/<int:cid>/support-requests', methods=['GET'])
@jwt_required()
def list_support_requests(cid):
    uid = get_jwt_identity()
    db  = get_db()
    mem = db.execute("SELECT role FROM club_members WHERE club_id=? AND user_id=?", (cid, uid)).fetchone()
    if not mem or mem['role'] not in ('president','vice president','vp','secretary'):
        db.close(); return jsonify({'error': 'Only club leadership can view support requests'}), 403
    rows = db.execute("SELECT * FROM support_requests WHERE club_id=? ORDER BY submitted_at DESC", (cid,)).fetchall()
    db.close()
    return jsonify([_serialize_row(r) for r in rows])

@clubs_bp.route('/<int:cid>/support-request', methods=['POST'])
@clubs_bp.route('/<int:cid>/support-requests', methods=['POST'])
@jwt_required()
def submit_support_request(cid):
    uid  = get_jwt_identity()
    data = request.json or {}
    db   = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can submit support requests'}), 403
    title = (data.get('title') or '').strip()
    if not title:
        db.close(); return jsonify({'error': 'Title is required'}), 400
    db.execute("""
        INSERT INTO support_requests (club_id, request_type, title, description)
        VALUES (?,?,?,?)
    """, (cid, data.get('request_type', 'funding'), title, data.get('description', '')))
    db.commit(); db.close()
    return jsonify({'message': 'Support request submitted'}), 201

# ─── CLUB ACTIVITIES ─────────────────────────────────────────────
# ─── FINANCIAL REPORT SUBMISSION ─────────────────────────────────
@clubs_bp.route('/<int:cid>/financial-report', methods=['POST'])
@jwt_required()
def submit_club_financial_report(cid):
    uid = get_jwt_identity()
    db  = get_db()
    pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (cid,)).fetchone()
    if not pres or pres['president_id'] != uid:
        db.close(); return jsonify({'error': 'Only club president can submit financial reports'}), 403

    proposal_id = request.form.get('proposal_id')
    total_spent = request.form.get('total_spent', 0)
    summary     = request.form.get('summary', '')

    if not proposal_id:
        db.close(); return jsonify({'error': 'Proposal is required'}), 400

    # Verify that the proposal belongs to this club and is funded
    prop = db.execute("SELECT * FROM proposals WHERE id=? AND club_id=?", (proposal_id, cid)).fetchone()
    if not prop:
        db.close(); return jsonify({'error': 'Proposal not found for this club'}), 404
    if prop['status'] not in ('funded', 'awaiting_verification'):
        db.close(); return jsonify({'error': 'Proposal must be in funded status'}), 400

    receipt_path = None
    if 'receipt' in request.files:
        f   = request.files['receipt']
        ext = f.filename.rsplit('.', 1)[-1] if '.' in f.filename else 'bin'
        receipt_path = save_upload(f, 'fin_receipts', filename=f"report_{uuid.uuid4().hex[:12]}.{ext}")

    db.execute("""
        INSERT INTO financial_reports (proposal_id, club_id, total_spent, expense_details, receipt_path, status)
        VALUES (?,?,?,?,?,?)
    """, (proposal_id, cid, total_spent, summary, receipt_path, 'pending'))
    # Update proposal status to awaiting_verification
    db.execute("UPDATE proposals SET status='awaiting_verification' WHERE id=?", (proposal_id,))
    db.commit(); db.close()
    return jsonify({'message': 'Financial report submitted — awaiting admin verification'}), 201
