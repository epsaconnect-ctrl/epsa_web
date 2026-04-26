"""EPSA Messaging Routes"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import get_db

messaging_bp = Blueprint('messaging', __name__)


def _user_id():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _partner_name(db, pid):
    row = db.execute(
        "SELECT first_name, father_name, university, profile_photo, role FROM users WHERE id=?",
        (pid,),
    ).fetchone()
    if not row:
        return None, None, None, None
    name = f"{row['first_name'] or ''} {row['father_name'] or ''}".strip() or "EPSA Member"
    return name, row['university'], row['profile_photo'], row['role']


@messaging_bp.route('/support-contact', methods=['GET'])
@jwt_required()
def support_contact():
    """Primary admin account students may message for platform support."""
    db = get_db()
    row = db.execute(
        """
        SELECT id, first_name, father_name, university, role
        FROM users
        WHERE role IN ('super_admin', 'admin')
        ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
        """
    ).fetchone()
    db.close()
    if not row:
        return jsonify({'error': 'No administrator configured'}), 404
    name = f"{row['first_name'] or ''} {row['father_name'] or ''}".strip() or 'EPSA Administration'
    return jsonify(
        {
            'id': row['id'],
            'name': name,
            'label': 'EPSA Administration',
            'university': row['university'] or 'National',
            'role': row['role'],
        }
    )


@messaging_bp.route('/conversations', methods=['GET'])
@jwt_required()
def conversations():
    uid = _user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 422
    db = get_db()
    # Distinct partners + last activity (SQLite-safe: no alias inside nested SELECT)
    threads = db.execute(
        """
        SELECT
            CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END AS partner_id,
            MAX(m.sent_at) AS last_time
        FROM messages m
        WHERE m.from_user_id = ? OR m.to_user_id = ?
        GROUP BY partner_id
        ORDER BY last_time DESC
        """,
        (uid, uid, uid),
    ).fetchall()
    out = []
    for t in threads:
        pid = t['partner_id']
        last_msg = db.execute(
            """
            SELECT text FROM messages
            WHERE (from_user_id = ? AND to_user_id = ?)
               OR (from_user_id = ? AND to_user_id = ?)
            ORDER BY sent_at DESC LIMIT 1
            """,
            (uid, pid, pid, uid),
        ).fetchone()
        unread = db.execute(
            """
            SELECT COUNT(*) FROM messages
            WHERE to_user_id = ? AND from_user_id = ? AND is_read = 0
            """,
            (uid, pid),
        ).fetchone()[0]
        name, uni, photo, role = _partner_name(db, pid)
        if not name:
            continue
        initials = ''.join(w[0] for w in name.split()[:2]).upper() or '?'
        if role in ('admin', 'super_admin'):
            display = 'EPSA Administration'
            initials = 'EA'
        else:
            display = name
        out.append(
            {
                'id': pid,
                'name': display,
                'full_name': name,
                'uni': uni or '',
                'lastMsg': last_msg['text'] if last_msg else '',
                'unread': int(unread or 0),
                'time': t['last_time'],
                'initials': initials,
                'is_staff': role in ('admin', 'super_admin'),
            }
        )
    db.close()
    return jsonify(out)


@messaging_bp.route('/<int:partner_id>', methods=['GET'])
@jwt_required()
def get_messages(partner_id):
    uid = _user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 422
    db = get_db()
    db.execute(
        "UPDATE messages SET is_read=1 WHERE from_user_id=? AND to_user_id=?",
        (partner_id, uid),
    )
    db.commit()
    rows = db.execute(
        """
        SELECT id, from_user_id, to_user_id, text, sent_at
        FROM messages
        WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)
        ORDER BY sent_at ASC LIMIT 200
        """,
        (uid, partner_id, partner_id, uid),
    ).fetchall()
    db.close()
    result = []
    for r in rows:
        from_uid = int(r['from_user_id'])
        result.append(
            {
                'id': r['id'],
                'from': 'me' if from_uid == uid else 'them',
                'text': r['text'],
                'time': r['sent_at'],
            }
        )
    return jsonify(result)


@messaging_bp.route('', methods=['POST'])
@jwt_required()
def send_message():
    uid = _user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 422
    data = request.json or {}
    try:
        to_id = int(data.get('to_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'to_id and text required'}), 400
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'to_id and text required'}), 400
    db = get_db()
    target = db.execute(
        """
        SELECT id, role, status FROM users WHERE id=?
        """,
        (to_id,),
    ).fetchone()
    if not target:
        db.close()
        return jsonify({'error': 'Recipient not found'}), 404
    if target['role'] in ('admin', 'super_admin'):
        pass
    elif target['status'] != 'approved':
        db.close()
        return jsonify({'error': 'Recipient is not an active member'}), 403
    db.execute(
        "INSERT INTO messages (from_user_id, to_user_id, text) VALUES (?,?,?)",
        (uid, to_id, text),
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Sent'})
