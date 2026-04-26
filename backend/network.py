"""EPSA Social Network Feed Routes"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import get_db
import uuid

from storage import save_upload, upload_url

network_bp = Blueprint('network', __name__)


def _network_uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


# ─── FEED: Get Posts ─────────────────────────────────────────────────
@network_bp.route('/feed', methods=['GET'])
@jwt_required()
def get_feed():
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    page   = int(request.args.get('page', 1))
    post_filter = request.args.get('filter', 'all')
    limit  = 15
    offset = (page - 1) * limit
    db     = get_db()
    where = ""
    params = [uid]
    if post_filter == 'club':
        where = "WHERE np.post_type='club'"
    elif post_filter == 'student':
        where = "WHERE np.post_type='student'"
    posts = db.execute("""
        SELECT np.*,
               u.first_name||' '||u.father_name as author_name,
               u.profile_photo as author_photo,
               u.university as author_uni,
               c.name as club_name,
               (SELECT COUNT(*) FROM network_comments nc WHERE nc.post_id = np.id) as comment_count,
               (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = np.id AND pl.user_id = ?) as user_liked
        FROM network_posts np
        JOIN users u ON np.user_id = u.id
        LEFT JOIN clubs c ON np.club_id = c.id
        """ + where + """
        ORDER BY np.created_at DESC
        LIMIT ? OFFSET ?
    """, (*params, limit, offset)).fetchall()
    db.close()
    result = []
    for p in posts:
        d = dict(p)
        if d['image_path']:
            d['image_url'] = upload_url('feed', d['image_path'])
        if d['author_photo']:
            d['author_photo_url'] = upload_url('profiles', d['author_photo'])
        result.append(d)
    return jsonify(result)

@network_bp.route('/search', methods=['GET'])
@jwt_required()
def search_network():
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    q = request.args.get('q', '').strip().lower()
    db = get_db()
    student_rows = db.execute("""
        SELECT u.id, u.first_name, u.father_name, u.university, u.program_type, u.academic_year, u.profile_photo, u.bio,
               EXISTS(SELECT 1 FROM connections c WHERE c.user_id=? AND c.connected_id=u.id) as connected,
               (SELECT COUNT(*) FROM club_members cm WHERE cm.user_id=u.id) as club_count
        FROM users u
        WHERE u.role='student' AND u.status='approved' AND u.id != ?
        ORDER BY u.first_name, u.father_name
        LIMIT 30
    """, (uid, uid)).fetchall()
    club_rows = db.execute("""
        SELECT c.id, c.name, c.university, c.description, c.member_count,
               (SELECT COUNT(*) FROM club_follows cf WHERE cf.club_id=c.id) as follower_count,
               EXISTS(SELECT 1 FROM club_follows cf WHERE cf.club_id=c.id AND cf.user_id=?) as following
        FROM clubs c
        WHERE c.status='approved'
        ORDER BY c.name
        LIMIT 20
    """, (uid,)).fetchall()
    db.close()

    students = []
    for row in student_rows:
        d = dict(row)
        hay = f"{d['first_name']} {d['father_name']} {d['university']} {d.get('program_type') or ''} {d.get('bio') or ''}".lower()
        if q and q not in hay:
            continue
        if d.get('profile_photo'):
            d['photo_url'] = upload_url('profiles', d['profile_photo'])
        students.append(d)

    clubs = []
    for row in club_rows:
        d = dict(row)
        hay = f"{d['name']} {d['university']} {d.get('description') or ''}".lower()
        if q and q not in hay:
            continue
        clubs.append(d)

    return jsonify({'students': students, 'clubs': clubs})

# ─── FEED: Create Post ───────────────────────────────────────────────
@network_bp.route('/posts', methods=['POST'])
@jwt_required()
def create_post():
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    data = request.form if request.files else (request.json or {})
    file = request.files.get('image') if request.files else None
    filename = ''
    if file and file.filename:
        ext = file.filename.rsplit('.', 1)[-1]
        filename = save_upload(file, 'feed', filename=f"post_{uuid.uuid4().hex[:8]}.{ext}")

    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'Post content is required'}), 400

    db = get_db()
    # Determine if it's a club post
    club_id   = data.get('club_id') or None
    post_type = 'club' if club_id else 'student'
    if club_id:
        # Validate president
        pres = db.execute("SELECT president_id FROM clubs WHERE id=?", (club_id,)).fetchone()
        if not pres or pres['president_id'] != uid:
            db.close(); return jsonify({'error': 'Only club president can post as a club'}), 403

    cur = db.execute("""
        INSERT INTO network_posts (user_id, club_id, content, image_path, post_type)
        VALUES (?,?,?,?,?)
    """, (uid, club_id, content, filename, post_type))
    post_id = cur.lastrowid
    db.commit(); db.close()
    return jsonify({'message': 'Post created', 'post_id': post_id}), 201

# ─── FEED: Delete Post ───────────────────────────────────────────────
@network_bp.route('/posts/<int:pid>', methods=['DELETE'])
@jwt_required()
def delete_post(pid):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db  = get_db()
    post = db.execute("SELECT user_id FROM network_posts WHERE id=?", (pid,)).fetchone()
    u    = db.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
    if not post: db.close(); return jsonify({'error': 'Not found'}), 404
    if post['user_id'] != uid and u['role'] not in ('admin', 'super_admin'):
        db.close(); return jsonify({'error': 'Not authorized'}), 403
    db.execute("DELETE FROM network_comments WHERE post_id=?", (pid,))
    db.execute("DELETE FROM post_likes WHERE post_id=?", (pid,))
    db.execute("DELETE FROM network_posts WHERE id=?", (pid,))
    db.commit(); db.close()
    return jsonify({'message': 'Post deleted'})

# ─── COMMENTS ────────────────────────────────────────────────────────
@network_bp.route('/posts/<int:pid>/comments', methods=['GET'])
@jwt_required()
def get_comments(pid):
    db = get_db()
    rows = db.execute("""
        SELECT nc.*, u.first_name||' '||u.father_name as author_name, u.profile_photo as author_photo
        FROM network_comments nc JOIN users u ON nc.user_id = u.id
        WHERE nc.post_id=? ORDER BY nc.created_at ASC
    """, (pid,)).fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        if d['author_photo']:
            d['author_photo_url'] = upload_url('profiles', d['author_photo'])
        result.append(d)
    return jsonify(result)

@network_bp.route('/posts/<int:pid>/comments', methods=['POST'])
@jwt_required()
def add_comment(pid):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    content = (request.json or {}).get('content', '').strip()
    if not content:
        return jsonify({'error': 'Comment cannot be empty'}), 400
    db = get_db()
    db.execute("INSERT INTO network_comments (post_id, user_id, content) VALUES (?,?,?)", (pid, uid, content))
    db.commit(); db.close()
    return jsonify({'message': 'Comment added'}), 201

# ─── LIKES ───────────────────────────────────────────────────────────
@network_bp.route('/posts/<int:pid>/like', methods=['POST'])
@jwt_required()
def toggle_like(pid):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db  = get_db()
    existing = db.execute("SELECT id FROM post_likes WHERE post_id=? AND user_id=?", (pid, uid)).fetchone()
    if existing:
        db.execute("DELETE FROM post_likes WHERE post_id=? AND user_id=?", (pid, uid))
        db.execute("UPDATE network_posts SET likes = MAX(0, likes-1) WHERE id=?", (pid,))
        liked = False
    else:
        db.execute("INSERT INTO post_likes (post_id, user_id) VALUES (?,?)", (pid, uid))
        db.execute("UPDATE network_posts SET likes = likes+1 WHERE id=?", (pid,))
        liked = True
    new_count = db.execute("SELECT likes FROM network_posts WHERE id=?", (pid,)).fetchone()['likes']
    db.commit(); db.close()
    return jsonify({'liked': liked, 'likes': new_count})

# ─── SUGGESTED CONNECTIONS ────────────────────────────────────────────
@network_bp.route('/suggestions', methods=['GET'])
@jwt_required()
def suggestions():
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db  = get_db()
    me  = db.execute("SELECT university FROM users WHERE id=?", (uid,)).fetchone()
    # Same university first
    rows = db.execute("""
        SELECT id, first_name, father_name, university, profile_photo
        FROM users WHERE role='student' AND status='approved' AND id != ?
        AND id NOT IN (SELECT connected_id FROM connections WHERE user_id=?)
        AND university = ?
        ORDER BY RANDOM() LIMIT 5
    """, (uid, uid, me['university'] if me else '')).fetchall()
    # If fewer than 5, add from same club memberships
    if len(rows) < 5:
        extras = db.execute("""
            SELECT DISTINCT u.id, u.first_name, u.father_name, u.university, u.profile_photo
            FROM users u JOIN club_members cm ON u.id = cm.user_id
            WHERE cm.club_id IN (SELECT club_id FROM club_members WHERE user_id=?)
            AND u.id != ? AND u.id NOT IN (SELECT connected_id FROM connections WHERE user_id=?)
            AND u.status='approved'
            ORDER BY RANDOM() LIMIT ?
        """, (uid, uid, uid, 5 - len(rows))).fetchall()
        rows = list(rows) + list(extras)
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        if d['profile_photo']:
            d['photo_url'] = upload_url('profiles', d['profile_photo'])
        result.append(d)
    return jsonify(result)

# ─── CONNECTIONS (Connect / Disconnect) ───────────────────────────────
@network_bp.route('/connect/<int:target_id>', methods=['POST'])
@jwt_required()
def connect_user(target_id):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    if uid == target_id:
        return jsonify({'error': 'Cannot connect to self'}), 400
    db = get_db()
    other = db.execute(
        "SELECT id FROM users WHERE id=? AND role='student' AND status='approved'",
        (target_id,),
    ).fetchone()
    if not other:
        db.close()
        return jsonify({'error': 'Member not found'}), 404
    existing = db.execute(
        "SELECT 1 FROM connections WHERE user_id=? AND connected_id=?",
        (uid, target_id),
    ).fetchone()
    if existing:
        db.execute("DELETE FROM connections WHERE user_id=? AND connected_id=?", (uid, target_id))
        db.execute("DELETE FROM connections WHERE user_id=? AND connected_id=?", (target_id, uid))
        msg = 'Disconnected'
    else:
        db.execute("INSERT OR IGNORE INTO connections (user_id, connected_id) VALUES (?,?)", (uid, target_id))
        db.execute("INSERT OR IGNORE INTO connections (user_id, connected_id) VALUES (?,?)", (target_id, uid))
        msg = 'Connected'
    db.commit()
    db.close()
    return jsonify({'message': msg})


@network_bp.route('/follow/<int:target_id>', methods=['POST'])
@jwt_required()
def follow_user(target_id):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    if uid == target_id:
        return jsonify({'error': 'Cannot follow yourself'}), 400
    db = get_db()
    ok = db.execute(
        "SELECT id FROM users WHERE id=? AND role='student' AND status='approved'",
        (target_id,),
    ).fetchone()
    if not ok:
        db.close()
        return jsonify({'error': 'Member not found'}), 404
    try:
        db.execute(
            "INSERT OR IGNORE INTO network_follows (follower_id, followee_id) VALUES (?,?)",
            (uid, target_id),
        )
        db.commit()
    except Exception:
        db.rollback()
    db.close()
    return jsonify({'message': 'Following', 'following': True})


@network_bp.route('/follow/<int:target_id>', methods=['DELETE'])
@jwt_required()
def unfollow_user(target_id):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db = get_db()
    try:
        db.execute(
            "DELETE FROM network_follows WHERE follower_id=? AND followee_id=?",
            (uid, target_id),
        )
        db.commit()
    except Exception:
        db.rollback()
    db.close()
    return jsonify({'message': 'Unfollowed', 'following': False})

# ─── SHARE / REPOST ──────────────────────────────────────────────────
@network_bp.route('/posts/<int:pid>/share', methods=['POST'])
@jwt_required()
def share_post(pid):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db  = get_db()
    original = db.execute("SELECT content, image_path, club_id, user_id FROM network_posts WHERE id=?", (pid,)).fetchone()
    if not original: db.close(); return jsonify({'error': 'Post not found'}), 404
    orig_author = db.execute("SELECT first_name||' '||u.father_name as name FROM users u WHERE id=?", (original['user_id'],)).fetchone()
    share_content = f"🔄 Shared from {orig_author['name'] if orig_author else 'a member'}:\n\n{original['content']}"
    db.execute("""
        INSERT INTO network_posts (user_id, content, image_path, post_type)
        VALUES (?,?,?,?)
    """, (uid, share_content, original['image_path'], 'student'))
    db.execute("UPDATE network_posts SET shares = COALESCE(shares,0) + 1 WHERE id=?", (pid,))
    db.commit(); db.close()
    return jsonify({'message': 'Post shared to your feed'}), 201

# ─── CLUB-SPECIFIC FEED ──────────────────────────────────────────────
@network_bp.route('/club-feed/<int:cid>', methods=['GET'])
@jwt_required()
def club_feed(cid):
    uid = _network_uid()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    page = int(request.args.get('page', 1))
    limit = 15
    offset = (page - 1) * limit
    db = get_db()
    posts = db.execute("""
        SELECT np.*,
               u.first_name||' '||u.father_name as author_name,
               u.profile_photo as author_photo,
               u.university as author_uni,
               c.name as club_name,
               (SELECT COUNT(*) FROM network_comments nc WHERE nc.post_id = np.id) as comment_count,
               (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = np.id AND pl.user_id = ?) as user_liked
        FROM network_posts np
        JOIN users u ON np.user_id = u.id
        LEFT JOIN clubs c ON np.club_id = c.id
        WHERE np.club_id = ?
        ORDER BY np.created_at DESC
        LIMIT ? OFFSET ?
    """, (uid, cid, limit, offset)).fetchall()
    db.close()
    result = []
    for p in posts:
        d = dict(p)
        if d['image_path']:
            d['image_url'] = upload_url('feed', d['image_path'])
        if d['author_photo']:
            d['author_photo_url'] = upload_url('profiles', d['author_photo'])
        result.append(d)
    return jsonify(result)
