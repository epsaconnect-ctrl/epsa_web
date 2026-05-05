"""EPSA Admin Routes"""
import json
import logging
import os
import uuid
from datetime import datetime, date, timedelta

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
try:
    from .models import get_db
    from .storage import save_upload, upload_url
except ImportError:
    from models import get_db
    from storage import save_upload, upload_url

admin_bp = Blueprint('admin', __name__)
logger = logging.getLogger(__name__)

try:
    from .email_service import send_email
except ImportError:
    from email_service import send_email


def _serialize_row(row):
    """Convert a DB row (sqlite3.Row or HybridRow) to a JSON-safe dict."""
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d


def require_admin(f):
    from functools import wraps
    @wraps(f)
    @jwt_required()
    def decorated(*args, **kwargs):
        uid = get_jwt_identity()
        db  = get_db()
        u   = db.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
        db.close()
        if not u or u['role'] not in ('admin','super_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/debug', methods=['GET'])
@require_admin
def admin_debug():
    """Diagnostic endpoint — shows DB counts, storage mode, and env state."""
    try:
        from .config import get_settings
    except ImportError:
        from config import get_settings
    settings = get_settings()
    db = get_db()
    try:
        total   = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        students = db.execute("SELECT COUNT(*) FROM users WHERE role='student'").fetchone()[0]
        pending  = db.execute("SELECT COUNT(*) FROM users WHERE role='student' AND status='pending'").fetchone()[0]
        approved = db.execute("SELECT COUNT(*) FROM users WHERE role='student' AND status='approved'").fetchone()[0]
        admins   = db.execute("SELECT COUNT(*) FROM users WHERE role IN ('admin','super_admin')").fetchone()[0]
        recent   = db.execute(
            "SELECT id, first_name, father_name, email, status, is_verified, is_active, created_at "
            "FROM users WHERE role='student' ORDER BY created_at DESC LIMIT 5"
        ).fetchall()
        recent_list = [_serialize_row(r) for r in recent]
    except Exception as exc:
        db.close()
        return jsonify({'error': str(exc)}), 500
    db.close()
    return jsonify({
        'db_engine': settings.db_engine,
        'storage_mode': settings.storage_mode,
        'supabase_url_set': bool(settings.supabase_url),
        'supabase_bucket': settings.supabase_bucket,
        'supabase_service_key_set': bool(settings.supabase_service_role_key),
        'resend_api_key_set': bool(settings.resend_api_key and 'REPLACE' not in (settings.resend_api_key or '')),
        'show_otp_in_response': settings.show_otp_in_response,
        'users_total': total,
        'users_students': students,
        'students_pending': pending,
        'students_approved': approved,
        'admins': admins,
        'recent_student_applications': recent_list,
    })




def _save_governance_document(file_storage):
    if not file_storage or not file_storage.filename:
        return ''
    ext = file_storage.filename.rsplit('.', 1)[-1] if '.' in file_storage.filename else 'bin'
    filename = f"gov_{uuid.uuid4().hex[:12]}.{ext}"
    return save_upload(file_storage, 'governance_docs', filename=filename)


def _create_executive_decision(db, decision_type, actor_id, reference_code, member_id=None,
                               target_user_id=None, vacancy_id=None, notes='', document_path=''):
    cur = db.execute("""
        INSERT INTO executive_decisions
        (decision_type, member_id, target_user_id, vacancy_id, reference_code, notes, decision_document_path, issued_by)
        VALUES (?,?,?,?,?,?,?,?)
    """, (decision_type, member_id, target_user_id, vacancy_id, reference_code, notes, document_path, actor_id))
    return cur.lastrowid


def _log_executive_audit(db, actor_id, action_type, member_id=None, target_user_id=None, details=None):
    db.execute("""
        INSERT INTO executive_audit_log (actor_user_id, action_type, member_id, target_user_id, details)
        VALUES (?,?,?,?,?)
    """, (actor_id, action_type, member_id, target_user_id, json.dumps(details or {})))


def _create_executive_notification(db, title, body, member_id=None, recipient_user_id=None, audience='member'):
    db.execute("""
        INSERT INTO executive_notifications (member_id, recipient_user_id, audience, title, body)
        VALUES (?,?,?,?,?)
    """, (member_id, recipient_user_id, audience, title, body))


def _safe_json_object(raw_value):
    try:
        parsed = json.loads(raw_value) if raw_value else {}
    except Exception:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def _duration_minutes(started_at, ended_at):
    if not started_at or not ended_at:
        return None
    try:
        start_dt = datetime.fromisoformat(str(started_at).replace('Z', ''))
        end_dt = datetime.fromisoformat(str(ended_at).replace('Z', ''))
        return round(max((end_dt - start_dt).total_seconds(), 0) / 60, 1)
    except Exception:
        return None


def _manual_notification_warning(email, context):
    logger.warning(
        "[Manual Notify] %s for email=%s",
        context,
        email or "unknown",
    )


def _ensure_handover_items(db, member_id):
    defaults = [
        'Submit outgoing role report',
        'Upload handover notes and supporting documents',
        'Confirm transition meeting with successor or admin'
    ]
    for item in defaults:
        exists = db.execute("""
            SELECT id FROM executive_handover_items
            WHERE member_id=? AND item_title=?
        """, (member_id, item)).fetchone()
        if not exists:
            db.execute("""
                INSERT INTO executive_handover_items (member_id, item_title, notes)
                VALUES (?, ?, ?)
            """, (member_id, item, 'Required for governance-compliant transition.'))


def _sync_legacy_election_results(db, ranked_candidates):
    db.execute("""
        UPDATE election_results
        SET is_active = 0
        WHERE LOWER(position) NOT LIKE '%representative%'
    """)
    top_roles = [('President', 1), ('Vice President', 2), ('Secretary General', 3)]
    for idx, candidate in enumerate(ranked_candidates[:3]):
        role_name, role_rank = top_roles[idx]
        db.execute("""
            INSERT INTO election_results (user_id, position, position_rank, is_active)
            VALUES (?, ?, ?, 1)
        """, (candidate['user_id'], role_name, role_rank))


def _build_phase_two_ranking(db, phase_id):
    return db.execute("""
        SELECT n.id as nomination_id, n.user_id, COUNT(v.id) as votes,
               u.first_name||' '||u.father_name as name, u.university
        FROM nominations n
        JOIN users u ON n.user_id = u.id
        LEFT JOIN votes v ON v.candidate_id = n.user_id AND v.phase_id = ?
        WHERE n.phase_id = ? AND n.is_approved = 1
        GROUP BY n.id
        ORDER BY votes DESC, n.nominated_at ASC, u.first_name ASC
    """, (phase_id, phase_id)).fetchall()


def _form_executive_committee_from_phase(db, actor_id, phase_id, reference_code='AUTO-NATIONAL-ELECTION'):
    ranked = _build_phase_two_ranking(db, phase_id)
    if not ranked:
        return []

    locked_roles = ['President', 'Vice President', 'Secretary General']
    active_user_ids = [row['user_id'] for row in ranked]
    if active_user_ids:
        placeholders = ','.join('?' for _ in active_user_ids)
        db.execute(f"""
            UPDATE executive_committee_members
            SET status='archived', updated_at=DATETIME('now')
            WHERE governance_origin='national_election'
              AND status IN ('active','reassigned','standby')
              AND user_id NOT IN ({placeholders})
        """, active_user_ids)

    for idx, candidate in enumerate(ranked, start=1):
        assigned_role = locked_roles[idx - 1] if idx <= 3 else None
        is_top_three = 1 if idx <= 3 else 0
        is_role_locked = 1 if idx <= 3 else 0
        existing = db.execute("""
            SELECT id, assigned_role FROM executive_committee_members
            WHERE user_id=? AND governance_origin='national_election'
              AND status IN ('active','reassigned','standby')
            ORDER BY id DESC LIMIT 1
        """, (candidate['user_id'],)).fetchone()
        if existing:
            db.execute("""
                UPDATE executive_committee_members
                SET source_nomination_id=?, source_phase_id=?, vote_count=?, vote_rank=?,
                    assigned_role=?, status=?, is_top_three=?, is_role_locked=?,
                    decision_reference=?, term_end=COALESCE(term_end, DATETIME('now', '+365 days')),
                    updated_at=DATETIME('now')
                WHERE id=?
            """, (
                candidate['nomination_id'], phase_id, candidate['votes'], idx, assigned_role,
                'active' if idx <= 3 else 'standby', is_top_three, is_role_locked,
                reference_code, existing['id']
            ))
            member_id = existing['id']
        else:
            cur = db.execute("""
                INSERT INTO executive_committee_members
                (user_id, source_nomination_id, source_phase_id, governance_origin, vote_count, vote_rank,
                 assigned_role, status, is_top_three, is_role_locked, term_start, term_end, decision_reference)
                VALUES (?,?,?,?,?,?,?,?,?,?,DATETIME('now'), DATETIME('now', '+365 days'), ?)
            """, (
                candidate['user_id'], candidate['nomination_id'], phase_id, 'national_election',
                candidate['votes'], idx, assigned_role, 'active' if idx <= 3 else 'standby',
                is_top_three, is_role_locked, reference_code
            ))
            member_id = cur.lastrowid
        if idx <= 3:
            decision_id = _create_executive_decision(
                db, 'auto_assignment', actor_id, reference_code, member_id=member_id,
                target_user_id=candidate['user_id'],
                notes=f"Automatically assigned {assigned_role} from national vote ranking."
            )
            db.execute("""
                INSERT INTO executive_role_history
                (member_id, old_role, new_role, change_type, decision_id, changed_by)
                VALUES (?, ?, ?, 'auto_assignment', ?, ?)
            """, (member_id, existing['assigned_role'] if existing else None, assigned_role, decision_id, actor_id))
            _create_executive_notification(
                db,
                f'Executive role assigned: {assigned_role}',
                'Your role was automatically assigned from the national election ranking.',
                member_id=member_id,
                recipient_user_id=candidate['user_id'],
                audience='member'
            )
        else:
            _create_executive_notification(
                db,
                'Executive committee membership confirmed',
                'You are in the executive committee pool and await NEB-directed role assignment.',
                member_id=member_id,
                recipient_user_id=candidate['user_id'],
                audience='member'
            )
        _log_executive_audit(
            db,
            actor_id,
            'executive_pool_sync',
            member_id=member_id,
            target_user_id=candidate['user_id'],
            details={
                'vote_rank': idx,
                'vote_count': candidate['votes'],
                'assigned_role': assigned_role,
                'reference_code': reference_code
            }
        )

    _sync_legacy_election_results(db, ranked)
    return ranked


def _is_user_graduated(user_row):
    if not user_row:
        return False
    status = (user_row['graduation_status'] or '').lower() if 'graduation_status' in user_row.keys() else ''
    if status == 'graduated':
        return True
    grad_year = user_row['graduation_year'] if 'graduation_year' in user_row.keys() else None
    now_year = datetime.utcnow().year
    return bool(grad_year and int(grad_year) < now_year)


def _ensure_governance_cycle(db, body_type, cycle_type, scope_type, scope_value, related_member_id=None, related_role=None, notes=''):
    existing = db.execute("""
        SELECT id FROM governance_election_cycles
        WHERE body_type=? AND cycle_type=? AND COALESCE(scope_type,'')=COALESCE(?, '')
          AND COALESCE(scope_value,'')=COALESCE(?, '')
          AND COALESCE(related_member_id,0)=COALESCE(?, 0)
          AND status IN ('scheduled','active')
        ORDER BY id DESC LIMIT 1
    """, (body_type, cycle_type, scope_type, scope_value, related_member_id)).fetchone()
    if existing:
        return existing['id']
    cur = db.execute("""
        INSERT INTO governance_election_cycles
        (body_type, cycle_type, scope_type, scope_value, related_member_id, related_role, status, opens_at, closes_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'scheduled', DATETIME('now'), DATETIME('now', '+21 days'), ?)
    """, (body_type, cycle_type, scope_type, scope_value, related_member_id, related_role, notes))
    return cur.lastrowid


def _log_nrc_audit(db, actor_id, nrc_member_id, action_type, details=None):
    db.execute("""
        INSERT INTO nrc_audit_log (actor_user_id, nrc_member_id, action_type, details)
        VALUES (?, ?, ?, ?)
    """, (actor_id, nrc_member_id, action_type, json.dumps(details or {})))


def _sync_nrc_members_from_results(db, actor_id, reference_code='AUTO-UR-ACTIVATION'):
    results = db.execute("""
        SELECT er.id as result_id, er.user_id, u.university, u.graduation_year, u.graduation_status
        FROM election_results er
        JOIN users u ON u.id = er.user_id
        WHERE er.is_active=1 AND LOWER(er.position) LIKE '%representative%'
    """).fetchall()
    member_count = 0
    for row in results:
        graduated = _is_user_graduated(row)
        existing = db.execute("""
            SELECT id, status FROM nrc_members
            WHERE user_id=? AND university=?
            ORDER BY id DESC LIMIT 1
        """, (row['user_id'], row['university'])).fetchone()
        status = 'removed' if graduated else 'active'
        eligibility = 'ineligible' if graduated else 'eligible'
        if existing:
            db.execute("""
                UPDATE nrc_members
                SET source_result_id=?, status=?, eligibility_status=?, is_primary=1,
                    term_end=COALESCE(term_end, DATETIME('now', '+365 days')),
                    activation_reference=COALESCE(activation_reference, ?),
                    updated_at=DATETIME('now')
                WHERE id=?
            """, (row['result_id'], status, eligibility, reference_code, existing['id']))
            member_id = existing['id']
        else:
            cur = db.execute("""
                INSERT INTO nrc_members
                (user_id, university, source_result_id, status, eligibility_status, is_primary,
                 term_start, term_end, activation_reference)
                VALUES (?, ?, ?, ?, ?, 1, DATETIME('now'), DATETIME('now', '+365 days'), ?)
            """, (row['user_id'], row['university'], row['result_id'], status, eligibility, reference_code))
            member_id = cur.lastrowid
        _log_nrc_audit(
            db, actor_id, member_id, 'nrc_sync',
            {'reference_code': reference_code, 'status': status, 'eligibility_status': eligibility}
        )
        member_count += 1
    return member_count


def _refresh_governance_terms(db):
    now = datetime.utcnow()
    now_iso = now.strftime('%Y-%m-%d %H:%M:%S')
    exec_rows = db.execute("""
        SELECT e.id, e.user_id, e.assigned_role, e.status, e.term_start, e.term_end, e.midterm_status,
               u.first_name||' '||u.father_name as name, u.graduation_year, u.graduation_status
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.status IN ('active','reassigned','standby')
    """).fetchall()
    for row in exec_rows:
        graduated = _is_user_graduated(row)
        if graduated:
            db.execute("""
                UPDATE executive_committee_members
                SET eligibility_status='ineligible', status='removed',
                    removed_reason='Graduated and therefore no longer eligible to hold office.',
                    removed_at=COALESCE(removed_at, DATETIME('now')),
                    assigned_role=NULL,
                    updated_at=DATETIME('now')
                WHERE id=?
            """, (row['id'],))
            continue
        if row['term_start'] and row['term_end']:
            start = datetime.fromisoformat(str(row['term_start']).replace('Z', ''))
            end = datetime.fromisoformat(str(row['term_end']).replace('Z', ''))
            midpoint = start + (end - start) / 2
            if now >= midpoint and row['midterm_status'] == 'pending':
                _ensure_governance_cycle(
                    db, 'NEC', 'mid_term', 'council', 'all',
                    related_member_id=row['id'],
                    related_role=row['assigned_role'],
                    notes='Automatic mid-term NEC review cycle'
                )
                db.execute("""
                    UPDATE executive_committee_members
                    SET midterm_status='due', midterm_notified_at=COALESCE(midterm_notified_at, ?), updated_at=DATETIME('now')
                    WHERE id=?
                """, (now_iso, row['id']))
                _create_executive_notification(
                    db,
                    'Mid-term NEC review is due',
                    'Your executive position is now in the mid-term democratic review window.',
                    member_id=row['id'],
                    recipient_user_id=row['user_id']
                )
            if now >= end and row['status'] != 'removed':
                db.execute("""
                    UPDATE executive_committee_members
                    SET status='inactive', eligibility_status='eligible', updated_at=DATETIME('now')
                    WHERE id=?
                """, (row['id'],))

    nrc_rows = db.execute("""
        SELECT n.id, n.user_id, n.university, n.status, n.term_start, n.term_end, n.midterm_status, n.last_activity_at,
               u.graduation_year, u.graduation_status
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        WHERE n.status IN ('active','inactive','suspended')
    """).fetchall()
    for row in nrc_rows:
        graduated = _is_user_graduated(row)
        if graduated:
            db.execute("""
                UPDATE nrc_members
                SET eligibility_status='ineligible', status='removed',
                    removal_reason='Graduated and no longer eligible to serve as University Representative.',
                    removed_at=COALESCE(removed_at, DATETIME('now')),
                    updated_at=DATETIME('now')
                WHERE id=?
            """, (row['id'],))
            continue
        if row['term_start'] and row['term_end']:
            start = datetime.fromisoformat(str(row['term_start']).replace('Z', ''))
            end = datetime.fromisoformat(str(row['term_end']).replace('Z', ''))
            midpoint = start + (end - start) / 2
            if now >= midpoint and row['midterm_status'] == 'pending':
                _ensure_governance_cycle(
                    db, 'NRC', 'mid_term', 'university', row['university'],
                    related_member_id=row['id'],
                    notes='Automatic mid-term NRC representative review cycle'
                )
                db.execute("""
                    UPDATE nrc_members
                    SET midterm_status='due', midterm_notified_at=COALESCE(midterm_notified_at, ?), updated_at=DATETIME('now')
                    WHERE id=?
                """, (now_iso, row['id']))
            if now >= end and row['status'] != 'removed':
                db.execute("""
                    UPDATE nrc_members
                    SET status='inactive', updated_at=DATETIME('now')
                    WHERE id=?
                """, (row['id'],))
        if row['last_activity_at']:
            last_active = datetime.fromisoformat(str(row['last_activity_at']).replace('Z', ''))
            if now - last_active > timedelta(days=30):
                db.execute("""
                    UPDATE nrc_members
                    SET inactivity_flag='Review required: representative inactive beyond threshold.',
                        updated_at=DATETIME('now')
                    WHERE id=?
                """, (row['id'],))


def _canonical_phase_status(raw_status, is_active):
    if is_active:
        return 'active'
    status = (raw_status or '').strip().lower()
    if status in ('finalized', 'closed'):
        return 'finalized'
    return 'not_started'


def _serialize_voting_phases(db):
    rows = db.execute("SELECT * FROM voting_phases ORDER BY phase_number ASC").fetchall()
    serialized = []
    phase_one_finalized = False
    for row in rows:
        item = dict(row)
        item['status'] = _canonical_phase_status(item.get('status'), item.get('is_active'))
        if item['phase_number'] == 1:
            can_start = item['status'] == 'not_started'
            can_finalize = item['status'] == 'active'
            helper_text = (
                'Launch university representative voting first.'
                if item['status'] == 'not_started'
                else 'Finalize this phase to lock university winners and sync the NRC.'
                if item['status'] == 'active'
                else 'Phase 1 is locked. University representatives have been published.'
            )
            phase_one_finalized = item['status'] == 'finalized'
        else:
            can_start = item['status'] == 'not_started' and phase_one_finalized
            can_finalize = item['status'] == 'active'
            helper_text = (
                'Finalize Phase 1 before launching the executive election.'
                if not phase_one_finalized and item['status'] == 'not_started'
                else 'Launch the national executive election once representatives are locked.'
                if item['status'] == 'not_started'
                else 'Finalize this phase to build the executive committee and lock the top three roles.'
                if item['status'] == 'active'
                else 'Phase 2 is locked. Executive governance is now driven from the final result.'
            )
        item['can_start'] = can_start
        item['can_finalize'] = can_finalize
        item['helper_text'] = helper_text
        serialized.append(item)
    return serialized

@admin_bp.route('/stats', methods=['GET'])
@require_admin
def stats():
    db = get_db()
    def _count(sql):
        try:
            return db.execute(sql).fetchone()[0]
        except Exception as exc:
            logger.warning("[Admin/stats] query failed: %s — %s", sql[:80], exc)
            return 0
    data = {
        'total_students':   _count("SELECT COUNT(*) FROM users WHERE role='student'"),
        'pending':          _count("SELECT COUNT(*) FROM users WHERE status='pending'"),
        'approved':         _count("SELECT COUNT(*) FROM users WHERE status='approved'"),
        'rejected':         _count("SELECT COUNT(*) FROM users WHERE status='rejected'"),
        'active_trainings': _count("SELECT COUNT(*) FROM trainings WHERE is_active=1"),
        'training_apps':    _count("SELECT COUNT(*) FROM training_applications"),
        'pending_receipts': _count("SELECT COUNT(*) FROM training_applications WHERE status='receipt'"),
        'total_votes':      _count("SELECT COUNT(*) FROM votes"),
        'active_exams':     _count("SELECT COUNT(*) FROM exams WHERE is_active=1"),
        'messages_today':   _count("SELECT COUNT(*) FROM messages WHERE DATE(sent_at)=DATE('now')"),
    }
    db.close()
    return jsonify(data)

@admin_bp.route('/applicants', methods=['GET'])
@require_admin
def list_applicants():
    status = request.args.get('status', 'pending')
    uni    = request.args.get('university', '')
    db     = get_db()
    query  = (
        "SELECT id,first_name,father_name,email,phone,university,program_type,"
        "academic_year,profile_photo,reg_slip,status,is_verified,is_active,"
        "created_at,rejection_reason FROM users WHERE role='student'"
    )
    params = []
    if status == 'pending':
        query += " AND status='pending'"
    elif status != 'all':
        query += ' AND status=?'
        params.append(status)
    if uni:
        query += ' AND university=?'
        params.append(uni)
    query += ' ORDER BY created_at DESC'
    try:
        rows = db.execute(query, params).fetchall()
        logger.info("[Admin] list_applicants status=%s found=%s", status, len(rows))
        result = [_serialize_row(r) for r in rows]
    except Exception as exc:
        logger.error("[Admin] list_applicants ERROR: %s", exc, exc_info=True)
        db.close()
        return jsonify({'error': 'Failed to load applicants', 'detail': str(exc)}), 500
    db.close()
    return jsonify(result)


@admin_bp.route('/applicants/<int:uid>/approve', methods=['POST'])
@require_admin
def approve(uid):
    db = get_db()
    user_data = db.execute(
        "SELECT first_name, email, username, student_id, profile_photo FROM users WHERE id=? AND role='student'",
        (uid,),
    ).fetchone()
    if not user_data:
        db.close()
        return jsonify({'error': 'Applicant not found'}), 404
    db.execute(
        """
        UPDATE users
        SET status='approved',
            approved_at=DATETIME('now'),
            rejection_reason=NULL,
            is_verified=1,
            is_active=1
        WHERE id=?
        """,
        (uid,),
    )
    db.commit()
    _manual_notification_warning(user_data['email'], 'Student approved; admin should notify manually')
    db.close()
    return jsonify({'message': 'Approved'})

@admin_bp.route('/applicants/<int:uid>/reject', methods=['POST'])
@require_admin
def reject(uid):
    reason = (request.json or {}).get('reason','Does not meet eligibility criteria')
    db = get_db()
    db.execute("UPDATE users SET status='rejected', rejection_reason=? WHERE id=?", (reason, uid))
    db.commit()
    user = db.execute("SELECT first_name, email FROM users WHERE id=?", (uid,)).fetchone()
    db.close()
    if user:
        _manual_notification_warning(user['email'], 'Student rejected; admin should notify manually')
    return jsonify({'message': 'Rejected'})

@admin_bp.route('/applicants/<int:uid>/delete', methods=['DELETE'])
@require_admin
def delete_applicant(uid):
    db = get_db()
    # Check if user exists
    user = db.execute("SELECT first_name, email FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        db.close()
        return jsonify({'error': 'User not found'}), 404
    
    # Delete related records (cascade delete)
    db.execute("DELETE FROM face_embeddings WHERE user_id=?", (uid,))
    db.execute("DELETE FROM exam_face_verifications WHERE user_id=?", (uid,))
    db.execute("DELETE FROM exam_submissions WHERE user_id=?", (uid,))
    db.execute("DELETE FROM training_applications WHERE user_id=?", (uid,))
    db.execute("DELETE FROM club_members WHERE user_id=?", (uid,))
    db.execute("DELETE FROM connections WHERE user_id=? OR connected_id=?", (uid, uid))
    db.execute("DELETE FROM messages WHERE from_user_id=? OR to_user_id=?", (uid, uid))
    db.execute("DELETE FROM votes WHERE user_id=?", (uid,))
    db.execute("DELETE FROM nominations WHERE user_id=?", (uid,))
    db.execute("DELETE FROM network_posts WHERE user_id=?", (uid,))
    db.execute("DELETE FROM network_comments WHERE user_id=?", (uid,))
    
    # Delete the user record
    db.execute("DELETE FROM users WHERE id=?", (uid,))
    db.commit()
    db.close()
    
    # Send notification email
    if user:
        name = user['first_name']
        send_email(user['email'], 'EPSA Account Deleted', f"""
        <html><body style="font-family:Arial,sans-serif;color:#333;line-height:1.6;">
        <div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #e8eaed;border-radius:8px;">
          <h2 style="color:#c0392b;text-align:center;">Account Deleted</h2>
          <p>Dear {name},</p>
          <p>Your EPSA account and all associated data have been permanently deleted from our system.</p>
          <p>This action was taken by an EPSA administrator. If you believe this was done in error, please contact the EPSA administration team immediately.</p>
          <p style="font-size:0.85rem;color:#777;margin-top:30px;text-align:center;">Ethiopian Psychology Students' Association</p>
        </div>
        </body></html>
        """)
    
    return jsonify({'message': 'User and all associated data deleted successfully'})

@admin_bp.route('/students/<int:uid>/delete', methods=['DELETE'])
@require_admin
def delete_student(uid):
    db = get_db()
    user = db.execute("SELECT first_name, email FROM users WHERE id=? AND role='student'", (uid,)).fetchone()
    if not user:
        db.close()
        return jsonify({'error': 'Student not found'}), 404

    db.execute("DELETE FROM face_embeddings WHERE user_id=?", (uid,))
    db.execute("DELETE FROM exam_face_verifications WHERE user_id=?", (uid,))
    db.execute("DELETE FROM exam_submissions WHERE user_id=?", (uid,))
    db.execute("DELETE FROM training_applications WHERE user_id=?", (uid,))
    db.execute("DELETE FROM club_members WHERE user_id=?", (uid,))
    db.execute("DELETE FROM connections WHERE user_id=? OR connected_id=?", (uid, uid))
    db.execute("DELETE FROM messages WHERE from_user_id=? OR to_user_id=?", (uid, uid))
    db.execute("DELETE FROM votes WHERE user_id=?", (uid,))
    db.execute("DELETE FROM nominations WHERE user_id=?", (uid,))
    db.execute("DELETE FROM network_posts WHERE user_id=?", (uid,))
    db.execute("DELETE FROM network_comments WHERE user_id=?", (uid,))
    try:
        db.execute("DELETE FROM network_follows WHERE follower_id=? OR followee_id=?", (uid, uid))
    except Exception:
        pass
    db.execute("DELETE FROM users WHERE id=?", (uid,))
    db.commit()
    db.close()

    if user:
        name = user['first_name']
        send_email(user['email'], 'EPSA Account Removed', f"""
        <html><body style="font-family:Arial,sans-serif;color:#333;line-height:1.6;">
        <div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #e8eaed;border-radius:8px;">
          <h2 style="color:#c0392b;text-align:center;">Account Removed</h2>
          <p>Dear {name},</p>
          <p>Your EPSA student account and associated records have been permanently removed from the platform by an administrator.</p>
          <p>If you believe this was done in error, contact the EPSA administration team.</p>
          <p style="font-size:0.85rem;color:#777;margin-top:30px;text-align:center;">Ethiopian Psychology Students' Association</p>
        </div>
        </body></html>
        """)

    return jsonify({'message': 'Student account deleted successfully'})

@admin_bp.route('/trainings', methods=['GET'])
@require_admin
def list_trainings_admin():
    db = get_db()
    rows = db.execute("""
        SELECT t.*, COUNT(ta.id) as applicant_count
        FROM trainings t
        LEFT JOIN training_applications ta ON t.id = ta.training_id
        GROUP BY t.id
        ORDER BY t.created_at DESC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/trainings', methods=['POST'])
@require_admin
def create_training():
    uid = get_jwt_identity()
    if request.content_type and 'multipart/form-data' in request.content_type:
        data = request.form.to_dict()
    else:
        data = request.json or {}
    db = get_db()
    try:
        price = float(data.get('price', 0) or 0)
    except (TypeError, ValueError):
        price = 0.0

    graphic_design = None
    graphic_caption = (data.get('graphic_caption') or '').strip() or None

    file = request.files.get('graphic_design')
    if file and file.filename:
        from werkzeug.utils import secure_filename
        import uuid as _uuid

        raw_name = secure_filename(file.filename)
        file_ext = raw_name.rsplit(".", 1)[1].lower() if "." in raw_name else "bin"
        unique_filename = f"{_uuid.uuid4().hex[:12]}.{file_ext}"
        save_upload(file, 'training_graphics', filename=unique_filename)
        graphic_design = unique_filename
    
    db.execute("""
        INSERT INTO trainings (title,description,format,price,is_free,icon,cert_title,cert_desc,content_url,graphic_design,graphic_caption,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (data.get('title'), data.get('description'), data.get('format','online'),
          price, 1 if price==0 else 0,
          data.get('icon','🎓'), data.get('cert_title'), data.get('cert_desc'),
          data.get('content_url'), graphic_design, graphic_caption, uid))
    db.commit(); db.close()
    return jsonify({'message': 'Training created successfully', 'graphic_design': graphic_design}), 201

@admin_bp.route('/trainings/<int:tid>', methods=['PUT'])
@require_admin
def update_training(tid):
    data = request.json or {}
    db = get_db()
    db.execute("""
        UPDATE trainings 
        SET title=COALESCE(?, title), description=COALESCE(?, description), 
            price=COALESCE(?, price), format=COALESCE(?, format)
        WHERE id=?
    """, (data.get('title'), data.get('description'), data.get('price'), data.get('format'), tid))
    db.commit(); db.close()
    return jsonify({'message': 'Training updated'})

@admin_bp.route('/trainings/<int:tid>/toggle', methods=['POST'])
@require_admin
def toggle_training(tid):
    db = get_db()
    row = db.execute("SELECT is_active FROM trainings WHERE id=?", (tid,)).fetchone()
    if not row: db.close(); return jsonify({'error': 'Not found'}), 404
    new_status = 0 if row['is_active'] else 1
    db.execute("UPDATE trainings SET is_active=? WHERE id=?", (new_status, tid))
    db.commit(); db.close()
    return jsonify({'message': 'Training activated' if new_status else 'Training deactivated', 'is_active': new_status})

@admin_bp.route('/trainings/<int:tid>', methods=['DELETE'])
@require_admin
def delete_training(tid):
    db = get_db()
    db.execute("UPDATE trainings SET is_active=0 WHERE id=?", (tid,))
    db.commit(); db.close()
    return jsonify({'message': 'Training deactivated'})

@admin_bp.route('/training-applications', methods=['GET'])
@require_admin
def training_applications():
    status = request.args.get('status','receipt')
    db = get_db()
    rows = db.execute("""
        SELECT ta.*, u.first_name||' '||u.father_name as student_name,
               u.university, t.title as training_title
        FROM training_applications ta
        JOIN users u ON ta.user_id=u.id
        JOIN trainings t ON ta.training_id=t.id
        WHERE ta.status=? ORDER BY ta.submitted_at DESC
    """, (status,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/training-applications/<int:aid>/verify', methods=['POST'])
@require_admin
def verify_receipt(aid):
    uid = get_jwt_identity()
    db  = get_db()
    db.execute("UPDATE training_applications SET status='verified', verified_at=DATETIME('now'), verified_by=? WHERE id=?", (uid, aid))
    db.commit(); db.close()
    return jsonify({'message': 'Receipt verified. Student can now access training.'})

@admin_bp.route('/training-applications/<int:aid>/register', methods=['POST'])
@require_admin
def register_student(aid):
    uid = get_jwt_identity()
    db  = get_db()
    db.execute("UPDATE training_applications SET status='registered', verified_at=DATETIME('now'), verified_by=? WHERE id=?", (uid, aid))
    db.commit(); db.close()
    return jsonify({'message': 'Student registered for training.'})

@admin_bp.route('/exams', methods=['GET'])
@require_admin
def list_exams_admin():
    db = get_db()
    rows = db.execute("""
        SELECT e.*,
            COUNT(DISTINCT eq.id) as question_count,
            COUNT(DISTINCT es.id) as submission_count
        FROM exams e
        LEFT JOIN exam_questions eq ON e.id = eq.exam_id
        LEFT JOIN exam_submissions es ON e.id = es.exam_id
        GROUP BY e.id
        ORDER BY e.created_at DESC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/exams', methods=['POST'])
@require_admin
def create_exam():
    uid  = get_jwt_identity()
    data = request.json or {}
    db   = get_db()
    try:
        passing = float(data.get('passing_score', 60) or 60)
    except (TypeError, ValueError):
        passing = 60.0
    passing = max(0.0, min(100.0, passing))
    cur  = db.execute("""
        INSERT INTO exams (title,description,duration_mins,scheduled_at,is_active,created_by,passing_score)
        VALUES (?,?,?,?,0,?,?)
    """, (data.get('title'), data.get('description'), data.get('duration_mins',60),
          data.get('scheduled_at'), uid, passing))
    exam_id = cur.lastrowid
    for i, q in enumerate(data.get('questions',[])):
        db.execute("""
            INSERT INTO exam_questions (exam_id,question,option_a,option_b,option_c,option_d,correct_idx,order_num)
            VALUES (?,?,?,?,?,?,?,?)
        """, (exam_id, q['question'], q['option_a'], q['option_b'], q['option_c'], q.get('option_d',''), q['correct_idx'], i))
    db.commit(); db.close()
    return jsonify({'message': 'Exam created (draft — publish when ready)', 'exam_id': exam_id}), 201

@admin_bp.route('/exams/<int:eid>/publish', methods=['POST'])
@require_admin
def publish_exam(eid):
    db = get_db()
    row = db.execute("SELECT is_active FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(silent=True) or {}
    if 'active' in data:
        new_status = 1 if data.get('active') else 0
    else:
        # Legacy: toggle (easy to mis-click publish twice — prefer explicit body.active from the admin UI)
        cur = int(row['is_active'] or 0)
        new_status = 0 if cur else 1
    db.execute("UPDATE exams SET is_active=? WHERE id=?", (new_status, eid))
    db.commit(); db.close()
    label = 'published and visible to students' if new_status else 'unpublished (hidden from students)'
    return jsonify({'message': f'Exam {label}', 'is_active': new_status})

@admin_bp.route('/exams/<int:eid>', methods=['PUT'])
@require_admin
def update_exam(eid):
    data = request.json or {}
    db = get_db()
    db.execute("""
        UPDATE exams 
        SET title=COALESCE(?, title), duration_mins=COALESCE(?, duration_mins), 
            scheduled_at=COALESCE(?, scheduled_at),
            passing_score=COALESCE(?, passing_score)
        WHERE id=?
    """, (
        data.get('title'),
        data.get('duration_mins'),
        data.get('scheduled_at'),
        data.get('passing_score'),
        eid,
    ))
    db.commit(); db.close()
    return jsonify({'message': 'Exam updated'})

@admin_bp.route('/exams/<int:eid>', methods=['DELETE'])
@require_admin
def delete_exam(eid):
    db = get_db()
    db.execute("UPDATE exams SET is_active=0 WHERE id=?", (eid,))
    db.commit(); db.close()
    return jsonify({'message': 'Exam deactivated'})

# ── Question Management ──────────────────────────

@admin_bp.route('/exams/<int:eid>/questions', methods=['GET'])
@require_admin
def list_exam_questions(eid):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM exam_questions WHERE exam_id=? ORDER BY order_num", (eid,)
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/exams/<int:eid>/questions', methods=['POST'])
@require_admin
def add_exam_question(eid):
    data = request.json or {}
    q = data.get('question','').strip()
    a = data.get('option_a','').strip()
    b = data.get('option_b','').strip()
    c = data.get('option_c','').strip()
    if not q or not a or not b or not c:
        return jsonify({'error': 'Question, option A, B, C are required'}), 400
    db = get_db()
    try:
        count = db.execute("SELECT COUNT(*) FROM exam_questions WHERE exam_id=?", (eid,)).fetchone()[0]
        cur = db.execute("""
            INSERT INTO exam_questions (exam_id,question,option_a,option_b,option_c,option_d,correct_idx,order_num)
            VALUES (?,?,?,?,?,?,?,?)
        """, (eid, q, a, b, c, data.get('option_d',''), int(data.get('correct_idx', 0)), count))
        db.commit()
        qid = cur.lastrowid
        return jsonify({'message': 'Question added', 'id': qid}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@admin_bp.route('/exam-questions/<int:qid>', methods=['DELETE'])
@require_admin
def delete_exam_question(qid):
    db = get_db()
    db.execute("DELETE FROM exam_questions WHERE id=?", (qid,))
    db.commit(); db.close()
    return jsonify({'message': 'Question deleted'})

# ── Submissions & Result Release ─────────────────

@admin_bp.route('/exams/<int:eid>/submissions', methods=['GET'])
@require_admin
def exam_submissions(eid):
    db = get_db()
    exam = db.execute("SELECT id, title, duration_mins, results_released FROM exams WHERE id=?", (eid,)).fetchone()
    if not exam: db.close(); return jsonify({'error': 'Not found'}), 404
    question_rows = db.execute("""
        SELECT id, question, option_a, option_b, option_c, option_d, correct_idx, order_num
        FROM exam_questions
        WHERE exam_id=?
        ORDER BY order_num ASC, id ASC
    """, (eid,)).fetchall()
    raw_rows = db.execute("""
        SELECT es.id, es.user_id, es.answers, es.score, es.status, es.progress_count, es.review_status,
               es.submitted_at, es.started_at, es.last_activity_at, es.reviewed_at,
               u.first_name||' '||u.father_name as student_name,
               u.university, u.student_id, u.email
        FROM exam_submissions es
        JOIN users u ON es.user_id = u.id
        WHERE es.exam_id=?
        ORDER BY
            CASE WHEN es.submitted_at IS NULL THEN 0 ELSE 1 END,
            es.last_activity_at DESC,
            es.submitted_at DESC
    """, (eid,)).fetchall()

    total_questions = len(question_rows)
    option_map = [('A', 'option_a'), ('B', 'option_b'), ('C', 'option_c'), ('D', 'option_d')]
    question_analytics = {
        q['id']: {
            'id': q['id'],
            'order_num': q['order_num'],
            'question': q['question'],
            'correct_idx': q['correct_idx'],
            'correct_option': chr(65 + int(q['correct_idx'])) if q['correct_idx'] is not None else '—',
            'options': [
                {'label': label, 'text': q[field]}
                for idx, (label, field) in enumerate(option_map)
                if q[field] or idx < 3
            ],
            'answered_count': 0,
            'correct_count': 0,
            'distribution': {str(idx): 0 for idx in range(4)}
        }
        for q in question_rows
    }

    submissions = []
    for row in raw_rows:
        answers = _safe_json_object(row['answers'])
        answered_count = 0
        correct_count = 0
        answer_breakdown = []
        for q in question_rows:
            answer = answers.get(str(q['id']))
            try:
                selected_idx = None if answer in (None, '') else int(answer)
            except (TypeError, ValueError):
                selected_idx = None
            if selected_idx is not None:
                answered_count += 1
                question_analytics[q['id']]['answered_count'] += 1
                if 0 <= selected_idx <= 3:
                    question_analytics[q['id']]['distribution'][str(selected_idx)] += 1
            is_correct = selected_idx is not None and str(selected_idx) == str(q['correct_idx'])
            if is_correct:
                correct_count += 1
                question_analytics[q['id']]['correct_count'] += 1
            answer_breakdown.append({
                'question_id': q['id'],
                'question': q['question'],
                'selected_option': chr(65 + selected_idx) if selected_idx is not None and 0 <= selected_idx <= 3 else '—',
                'correct_option': chr(65 + int(q['correct_idx'])) if q['correct_idx'] is not None else '—',
                'is_correct': bool(is_correct),
                'selected_text': q[f'option_{chr(97 + selected_idx)}'] if selected_idx is not None and 0 <= selected_idx <= 3 else '',
                'correct_text': q[f'option_{chr(97 + int(q["correct_idx"]))}'] if q['correct_idx'] is not None else ''
            })

        score = row['score']
        if score is None and row['submitted_at'] and total_questions:
            score = round((correct_count / total_questions) * 100, 1)
        status = row['status'] or ('submitted' if row['submitted_at'] else 'in_progress')
        review_status = row['review_status'] or ('approved' if exam['results_released'] and row['submitted_at'] else 'pending')
        progress_count = row['progress_count'] if row['progress_count'] is not None else answered_count
        progress_pct = round((progress_count / total_questions) * 100, 1) if total_questions else 0
        activity_end = row['submitted_at'] or row['last_activity_at']
        submissions.append({
            'id': row['id'],
            'user_id': row['user_id'],
            'student_name': row['student_name'],
            'university': row['university'],
            'student_id': row['student_id'],
            'email': row['email'],
            'status': status,
            'review_status': review_status,
            'score': score,
            'passed': score is not None and score >= 60,
            'answered_count': answered_count,
            'correct_count': correct_count,
            'progress_count': progress_count,
            'progress_pct': progress_pct,
            'started_at': row['started_at'],
            'last_activity_at': row['last_activity_at'],
            'submitted_at': row['submitted_at'],
            'reviewed_at': row['reviewed_at'],
            'duration_mins': _duration_minutes(row['started_at'], activity_end),
            'answers_breakdown': answer_breakdown
        })

    submitted_scores = [item['score'] for item in submissions if item['submitted_at'] and item['score'] is not None]
    submitted_count = len([item for item in submissions if item['submitted_at']])
    in_progress_count = len([item for item in submissions if item['status'] == 'in_progress' and not item['submitted_at']])
    started_count = len(submissions)
    pass_count = len([item for item in submissions if item['submitted_at'] and item['passed']])

    question_breakdown = []
    for q in question_rows:
        q_stats = question_analytics[q['id']]
        answered_total = q_stats['answered_count']
        question_breakdown.append({
            'id': q_stats['id'],
            'order_num': q_stats['order_num'],
            'question': q_stats['question'],
            'correct_option': q_stats['correct_option'],
            'answered_count': answered_total,
            'correct_count': q_stats['correct_count'],
            'correct_rate': round((q_stats['correct_count'] / answered_total) * 100, 1) if answered_total else 0,
            'options': [
                {
                    'label': option['label'],
                    'text': option['text'],
                    'count': q_stats['distribution'].get(str(idx), 0)
                }
                for idx, option in enumerate(q_stats['options'])
            ]
        })

    db.close()
    return jsonify({
        'exam_title':       exam['title'],
        'question_count':   total_questions,
        'duration_mins':    exam['duration_mins'],
        'results_released': exam['results_released'],
        'summary': {
            'started_count': started_count,
            'submitted_count': submitted_count,
            'in_progress_count': in_progress_count,
            'average_score': round(sum(submitted_scores) / len(submitted_scores), 1) if submitted_scores else 0,
            'pass_rate': round((pass_count / submitted_count) * 100, 1) if submitted_count else 0
        },
        'submissions': submissions,
        'question_breakdown': question_breakdown
    })

@admin_bp.route('/exams/<int:eid>/release-results', methods=['POST'])
@require_admin
def release_results(eid):
    db = get_db()
    reviewer_id = get_jwt_identity()
    row = db.execute("SELECT results_released FROM exams WHERE id=?", (eid,)).fetchone()
    if not row: db.close(); return jsonify({'error': 'Not found'}), 404
    new_val = 0 if row['results_released'] else 1
    db.execute("UPDATE exams SET results_released=? WHERE id=?", (new_val, eid))
    if new_val:
        db.execute("""
            UPDATE exam_submissions
            SET review_status='approved',
                reviewed_at=DATETIME('now'),
                reviewed_by=?
            WHERE exam_id=? AND submitted_at IS NOT NULL
        """, (reviewer_id, eid))
    else:
        db.execute("""
            UPDATE exam_submissions
            SET review_status='pending'
            WHERE exam_id=? AND submitted_at IS NOT NULL
        """, (eid,))
    db.commit(); db.close()
    label = 'Results approved and released to students' if new_val else 'Results hidden from students until approval'
    return jsonify({'message': label, 'results_released': new_val})

@admin_bp.route('/voting/nominations', methods=['GET'])
@require_admin
def pending_nominations():
    db   = get_db()
    rows = db.execute("""
        SELECT n.*, u.first_name||' '||u.father_name as name, u.university
        FROM nominations n JOIN users u ON n.user_id=u.id
        ORDER BY n.nominated_at DESC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/voting/nominations/<int:nid>/approve', methods=['POST'])
@require_admin
def approve_nomination(nid):
    db = get_db()
    db.execute("UPDATE nominations SET is_approved=1 WHERE id=?", (nid,))
    db.commit(); db.close()
    return jsonify({'message': 'Nomination approved'})

@admin_bp.route('/voting/nominations/<int:nid>/reject', methods=['POST'])
@require_admin
def reject_nomination(nid):
    db = get_db()
    db.execute("UPDATE nominations SET is_approved=-1 WHERE id=?", (nid,))
    db.commit(); db.close()
    return jsonify({'message': 'Nomination rejected'})

@admin_bp.route('/voting/config', methods=['GET'])
@require_admin
def get_voting_config():
    db = get_db()
    phases = _serialize_voting_phases(db)
    db.close()
    return jsonify(phases)

@admin_bp.route('/voting/config', methods=['PUT'])
@require_admin
def update_voting_config():
    data = request.json or {}
    db = get_db()
    for phase_data in data.get('phases', []):
        db.execute("""
            UPDATE voting_phases 
            SET starts_at=?, ends_at=?
            WHERE id=?
        """, (
            phase_data.get('starts_at') or None,
            phase_data.get('ends_at') or None,
            phase_data.get('id')
        ))
    db.commit()
    phases = _serialize_voting_phases(db)
    db.close()
    return jsonify({'message': 'Voting schedule updated', 'phases': phases})

@admin_bp.route('/voting/start_phase', methods=['POST'])
@require_admin
def start_voting_phase():
    data = request.json or {}
    phase_num = int(data.get('phase_number') or 0)
    if phase_num not in (1, 2):
        return jsonify({'error': 'phase_number must be 1 or 2'}), 400

    db = get_db()
    phase = db.execute("SELECT * FROM voting_phases WHERE phase_number=?", (phase_num,)).fetchone()
    if not phase:
        db.close()
        return jsonify({'error': 'Phase not found'}), 404

    phase_status = _canonical_phase_status(phase['status'], phase['is_active'])
    if phase_status == 'finalized':
        db.close()
        return jsonify({'error': f'Phase {phase_num} is already finalized and cannot be restarted.'}), 409
    if phase_status == 'active':
        db.close()
        return jsonify({'error': f'Phase {phase_num} is already active.'}), 409

    active_phase = db.execute("""
        SELECT phase_number FROM voting_phases
        WHERE is_active=1 OR status='active'
        ORDER BY phase_number ASC LIMIT 1
    """).fetchone()
    if active_phase:
        db.close()
        return jsonify({'error': f"Phase {active_phase['phase_number']} is already active. Finalize it before starting another phase."}), 409

    if phase_num == 2:
        phase_one = db.execute("SELECT * FROM voting_phases WHERE phase_number=1").fetchone()
        if not phase_one or _canonical_phase_status(phase_one['status'], phase_one['is_active']) != 'finalized':
            db.close()
            return jsonify({'error': 'Phase 1 must be finalized before Phase 2 can start.'}), 409

    db.execute("""
        UPDATE voting_phases
        SET is_active=CASE WHEN phase_number=? THEN 1 ELSE 0 END,
            status=CASE WHEN phase_number=? THEN 'active' ELSE status END,
            starts_at=CASE
                WHEN phase_number=? AND (starts_at IS NULL OR starts_at='') THEN DATETIME('now')
                ELSE starts_at
            END
    """, (phase_num, phase_num, phase_num))
    db.commit()
    phases = _serialize_voting_phases(db)
    db.close()
    return jsonify({'message': f'Phase {phase_num} started successfully.', 'phases': phases})

@admin_bp.route('/voting/reset', methods=['POST'])
@require_admin
def reset_election():
    db = get_db()
    db.execute("DELETE FROM votes")
    db.execute("DELETE FROM nominations")
    db.execute("DELETE FROM election_results")
    db.execute("DELETE FROM exam_face_verifications")
    db.execute("DELETE FROM executive_role_interest")
    db.execute("DELETE FROM executive_vacancy_elections")
    db.execute("DELETE FROM executive_vacancies")
    db.execute("DELETE FROM executive_role_history")
    db.execute("DELETE FROM executive_notifications")
    db.execute("DELETE FROM executive_handover_items")
    db.execute("DELETE FROM executive_decisions")
    db.execute("DELETE FROM executive_audit_log")
    db.execute("DELETE FROM executive_committee_members")
    db.execute("DELETE FROM nrc_audit_log")
    db.execute("DELETE FROM nrc_documents")
    db.execute("DELETE FROM nrc_members")
    db.execute("UPDATE voting_phases SET starts_at=NULL, ends_at=NULL, is_active=0, status='not_started'")
    # SQLite reset auto-increment counters safely
    db.execute("""
        DELETE FROM sqlite_sequence
        WHERE name IN (
            'votes', 'nominations', 'election_results', 'executive_role_interest',
            'executive_vacancy_elections', 'executive_vacancies', 'executive_role_history',
            'executive_notifications', 'executive_handover_items', 'executive_decisions',
            'executive_audit_log', 'executive_committee_members'
        )
    """)
    db.commit(); db.close()
    return jsonify({'message': 'Election cycle reset. All votes, nominations, governance sync records, and results cleared.'})

@admin_bp.route('/voting/analytics', methods=['GET'])
@require_admin
def get_voting_analytics():
    db = get_db()
    total_votes = db.execute("SELECT COUNT(*) FROM votes").fetchone()[0]
    # Votes per university
    uni_votes = db.execute("""
        SELECT u.university, COUNT(v.id) as count 
        FROM votes v JOIN users u ON v.voter_id = u.id 
        GROUP BY u.university ORDER BY count DESC
    """).fetchall()
    # Turnout
    total_students = db.execute("SELECT COUNT(*) FROM users WHERE role='student'").fetchone()[0]
    top_candidates = db.execute("""
        SELECT u.first_name||' '||u.father_name as name, u.university, COUNT(v.id) as votes
        FROM nominations n
        JOIN users u ON u.id = n.user_id
        LEFT JOIN votes v ON v.candidate_id = n.user_id AND v.phase_id = n.phase_id
        WHERE n.is_approved = 1
        GROUP BY n.id
        ORDER BY votes DESC, name ASC
        LIMIT 8
    """).fetchall()
    phase_breakdown = db.execute("""
        SELECT vp.phase_number, vp.title,
               (
                   SELECT COUNT(*)
                   FROM votes v
                   WHERE v.phase_id = vp.id
               ) as vote_count,
               (
                   SELECT COUNT(*)
                   FROM nominations n
                   WHERE n.phase_id = vp.id AND n.is_approved = 1
               ) as candidate_count
        FROM voting_phases vp
        ORDER BY vp.phase_number
    """).fetchall()
    db.close()
    return jsonify({
        'total_votes': total_votes,
        'uni_breakdown': [dict(r) for r in uni_votes],
        'turnout_pct': round((total_votes / total_students * 100), 1) if total_students else 0,
        'total_students': total_students,
        'top_candidates': [dict(r) for r in top_candidates],
        'phase_breakdown': [dict(r) for r in phase_breakdown]
    })

@admin_bp.route('/voting/finalize_phase', methods=['POST'])
@require_admin
def finalize_phase():
    data = request.json or {}
    phase_num = int(data.get('phase_number') or 0)
    if phase_num not in (1, 2):
        return jsonify({'error': 'phase_number must be 1 or 2'}), 400
    actor_id = get_jwt_identity()
    db = get_db()
    phase = db.execute("SELECT * FROM voting_phases WHERE phase_number=?", (phase_num,)).fetchone()
    if not phase:
        db.close()
        return jsonify({'error': 'Phase not found'}), 404

    phase_status = _canonical_phase_status(phase['status'], phase['is_active'])
    if phase_status == 'not_started':
        db.close()
        return jsonify({'error': f'Phase {phase_num} has not started yet.'}), 409
    if phase_status == 'finalized':
        db.close()
        return jsonify({'error': f'Phase {phase_num} is already finalized.'}), 409
    if phase_num == 2:
        phase_one = db.execute("SELECT * FROM voting_phases WHERE phase_number=1").fetchone()
        if not phase_one or _canonical_phase_status(phase_one['status'], phase_one['is_active']) != 'finalized':
            db.close()
            return jsonify({'error': 'Phase 1 must be finalized before Phase 2 can be finalized.'}), 409

    if phase_num == 1:
        # For each university, find highest voted approved candidate
        universities = db.execute("SELECT DISTINCT university FROM users WHERE role='student'").fetchall()
        for u in universities:
            uni = u['university']
            top = db.execute("""
                SELECT n.user_id, COUNT(v.id) as votes
                FROM nominations n
                JOIN users usr ON n.user_id = usr.id
                LEFT JOIN votes v ON v.candidate_id = n.user_id AND v.phase_id=?
                WHERE n.phase_id=? AND usr.university=? AND n.is_approved=1
                GROUP BY n.user_id ORDER BY votes DESC LIMIT 1
            """, (phase['id'], phase['id'], uni)).fetchone()
            if top:
                db.execute("INSERT OR IGNORE INTO election_results (user_id, position, position_rank, is_active) VALUES (?, 'University Representative', 10, 1)", (top['user_id'],))
        _sync_nrc_members_from_results(db, actor_id, reference_code='AUTO-UR-ACTIVATION')
    
    elif phase_num == 2:
        # Rank top candidates nationally
        _form_executive_committee_from_phase(
            db,
            actor_id,
            phase['id'],
            reference_code='AUTO-NATIONAL-ELECTION'
        )
                
    _refresh_governance_terms(db)
    db.execute("UPDATE voting_phases SET status='finalized', is_active=0 WHERE phase_number=?", (phase_num,))
    db.commit()
    phases = _serialize_voting_phases(db)
    db.close()
    if phase_num == 2:
        return jsonify({
            'message': 'Phase 2 finalized. Executive committee formed and top three roles assigned automatically.',
            'phases': phases
        })
    return jsonify({
        'message': f'Phase {phase_num} finalized and university representatives were locked successfully.',
        'phases': phases
    })

@admin_bp.route('/leadership/appointed', methods=['GET'])
@require_admin
def get_appointed_leadership():
    db = get_db()
    rows = db.execute("SELECT * FROM leadership_profiles ORDER BY order_num ASC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/leadership/appointed', methods=['POST'])
@require_admin
def add_appointed_leadership():
    data = request.form
    file = request.files.get('profile_photo')
    filename = ''
    if file:
        import uuid
        ext = file.filename.split('.')[-1]
        filename = f"leader_{uuid.uuid4().hex[:8]}.{ext}"
        filename = save_upload(file, 'appointees', filename=filename)
    
    db = get_db()
    db.execute("""
        INSERT INTO leadership_profiles (name, position, hierarchy, profile_photo, bio, order_num)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (data.get('name'), data.get('position'), data.get('hierarchy', 'NEB'), filename, data.get('bio'), int(data.get('order_num', 0))))
    db.commit(); db.close()
    return jsonify({'message': 'Leadership profile added successfully'})

@admin_bp.route('/leadership/appointed/<int:pid>', methods=['DELETE'])
@require_admin
def delete_appointed_leadership(pid):
    db = get_db()
    db.execute("DELETE FROM leadership_profiles WHERE id=?", (pid,))
    db.commit(); db.close()
    return jsonify({'message': 'Profile deleted'})


@admin_bp.route('/executive/dashboard', methods=['GET'])
@require_admin
def executive_dashboard():
    db = get_db()
    _refresh_governance_terms(db)
    members = db.execute("""
        SELECT e.*,
               u.first_name||' '||u.father_name as name,
               u.university, u.student_id, u.email, u.profile_photo
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.status != 'archived'
        ORDER BY CASE
            WHEN e.assigned_role='President' THEN 1
            WHEN e.assigned_role='Vice President' THEN 2
            WHEN e.assigned_role='Secretary General' THEN 3
            ELSE 10
        END, e.vote_rank ASC, e.id ASC
    """).fetchall()
    decisions = db.execute("""
        SELECT d.*, u.first_name||' '||u.father_name as issued_by_name
        FROM executive_decisions d
        LEFT JOIN users u ON u.id = d.issued_by
        ORDER BY d.issued_at DESC
        LIMIT 12
    """).fetchall()
    audit = db.execute("""
        SELECT a.*, u.first_name||' '||u.father_name as actor_name
        FROM executive_audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC
        LIMIT 20
    """).fetchall()
    vacancies = db.execute("""
        SELECT v.*,
               prev.user_id as previous_user_id,
               u.first_name||' '||u.father_name as previous_member_name,
               repl.user_id as replacement_user_id,
               ru.first_name||' '||ru.father_name as replacement_name
        FROM executive_vacancies v
        LEFT JOIN executive_committee_members prev ON prev.id = v.previous_member_id
        LEFT JOIN users u ON u.id = prev.user_id
        LEFT JOIN executive_committee_members repl ON repl.id = v.replacement_member_id
        LEFT JOIN users ru ON ru.id = repl.user_id
        ORDER BY v.created_at DESC
    """).fetchall()
    notifications = db.execute("""
        SELECT * FROM executive_notifications
        ORDER BY created_at DESC
        LIMIT 10
    """).fetchall()
    cycles = db.execute("""
        SELECT * FROM governance_election_cycles
        WHERE body_type='NEC'
        ORDER BY triggered_at DESC
        LIMIT 12
    """).fetchall()
    term_alerts = db.execute("""
        SELECT e.id as member_id, e.assigned_role, e.term_start, e.term_end,
               u.first_name||' '||u.father_name as name
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.status IN ('active','reassigned','standby')
          AND e.term_end IS NOT NULL
          AND e.term_end <= DATETIME('now', '+45 days')
        ORDER BY e.term_end ASC
    """).fetchall()
    active_pool = db.execute("""
        SELECT e.id as member_id, e.user_id, e.assigned_role, e.status,
               u.first_name||' '||u.father_name as name, u.university
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.status IN ('active','reassigned','standby')
        ORDER BY name ASC
    """).fetchall()
    nrc_candidates = db.execute("""
        SELECT DISTINCT er.user_id, u.first_name||' '||u.father_name as name, u.university
        FROM election_results er
        JOIN users u ON u.id = er.user_id
        WHERE er.is_active=1 AND LOWER(er.position) LIKE '%representative%'
        ORDER BY name ASC
    """).fetchall()
    latest_phase_two = db.execute("""
        SELECT id FROM voting_phases WHERE phase_number=2 ORDER BY id DESC LIMIT 1
    """).fetchone()
    phase_two_ranking = []
    if latest_phase_two:
        phase_two_ranking = [dict(r) for r in _build_phase_two_ranking(db, latest_phase_two['id'])]
    db.close()

    result_members = []
    for row in members:
        item = dict(row)
        if item.get('profile_photo'):
            item['photo_url'] = upload_url('profiles', item['profile_photo'])
        result_members.append(item)

    return jsonify({
        'summary': {
            'active_members': sum(1 for row in result_members if row['status'] in ('active', 'reassigned')),
            'awaiting_assignment': sum(1 for row in result_members if row['status'] == 'standby' and not row.get('assigned_role')),
            'removed_members': sum(1 for row in result_members if row['status'] == 'removed'),
            'open_vacancies': sum(1 for row in vacancies if row['status'] != 'resolved'),
            'expiring_soon': len(term_alerts),
            'flagged_engagement': sum(1 for row in result_members if row.get('engagement_status') == 'flagged' or row.get('performance_flag'))
        },
        'members': result_members,
        'vacancies': [dict(r) for r in vacancies],
        'decisions': [dict(r) for r in decisions],
        'audit': [dict(r) for r in audit],
        'notifications': [dict(r) for r in notifications],
        'cycles': [dict(r) for r in cycles],
        'term_alerts': [dict(r) for r in term_alerts],
        'active_member_pool': [dict(r) for r in active_pool],
        'nrc_candidates': [dict(r) for r in nrc_candidates],
        'phase_two_ranking': phase_two_ranking,
        'governance_guidelines': [
            'Top three offices are system-locked from the election ranking unless the member is formally removed.',
            'Every manual assignment, reassignment, or removal requires an NEB decision reference.',
            'Removed members stay in history and are excluded from public leadership automatically.',
            'Outgoing members must complete handover requirements before transition is fully closed.',
            'Engagement issues and ethical concerns should be flagged inside the dashboard for review traceability.'
        ]
    })


@admin_bp.route('/nrc/dashboard', methods=['GET'])
@require_admin
def nrc_dashboard():
    db = get_db()
    _refresh_governance_terms(db)
    rows = db.execute("""
        SELECT n.*, u.first_name||' '||u.father_name as name, u.student_id, u.email,
               u.university as user_university, u.graduation_year, u.graduation_status
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        ORDER BY n.university ASC, n.created_at DESC
    """).fetchall()
    docs = db.execute("""
        SELECT d.*, n.university, u.first_name||' '||u.father_name as representative_name
        FROM nrc_documents d
        JOIN nrc_members n ON n.id = d.nrc_member_id
        JOIN users u ON u.id = n.user_id
        ORDER BY d.submitted_at DESC
        LIMIT 20
    """).fetchall()
    cycles = db.execute("""
        SELECT * FROM governance_election_cycles
        WHERE body_type='NRC'
        ORDER BY triggered_at DESC
        LIMIT 20
    """).fetchall()
    universities = db.execute("""
        SELECT DISTINCT university FROM users
        WHERE role='student' AND status='approved'
        ORDER BY university
    """).fetchall()
    db.close()
    result = [dict(r) for r in rows]
    return jsonify({
        'summary': {
            'active': sum(1 for r in result if r['status'] == 'active'),
            'inactive': sum(1 for r in result if r['status'] == 'inactive'),
            'suspended': sum(1 for r in result if r['status'] == 'suspended'),
            'removed': sum(1 for r in result if r['status'] == 'removed'),
            'midterm_due': sum(1 for r in result if r['midterm_status'] == 'due'),
            'flagged_inactivity': sum(1 for r in result if r.get('inactivity_flag'))
        },
        'members': result,
        'documents': [dict(r) for r in docs],
        'cycles': [dict(r) for r in cycles],
        'universities': [r['university'] for r in universities],
        'guidelines': [
            'Each university should have one primary representative with active voting authority at a time.',
            'Representatives serve one-year terms and enter a mid-term review cycle automatically at the halfway mark.',
            'Graduated students immediately lose eligibility to hold or run for NRC and NEC offices.',
            'Inactive representatives should be reviewed and may be warned, suspended, or removed with traceability.'
        ]
    })


@admin_bp.route('/nrc/sync', methods=['POST'])
@require_admin
def sync_nrc_members():
    actor_id = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    count = _sync_nrc_members_from_results(db, actor_id, reference_code=data.get('reference_code', 'AUTO-UR-ACTIVATION'))
    _refresh_governance_terms(db)
    db.commit()
    db.close()
    return jsonify({'message': 'NRC membership synchronized from university representatives.', 'count': count})


@admin_bp.route('/nrc/<int:nid>/status', methods=['POST'])
@require_admin
def update_nrc_status(nid):
    actor_id = get_jwt_identity()
    data = request.json or {}
    new_status = (data.get('status') or '').strip().lower()
    reason = (data.get('reason') or '').strip()
    if new_status not in ('active', 'inactive', 'suspended', 'removed'):
        return jsonify({'error': 'status must be active, inactive, suspended, or removed'}), 400
    db = get_db()
    member = db.execute("SELECT * FROM nrc_members WHERE id=?", (nid,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'NRC member not found'}), 404
    db.execute("""
        UPDATE nrc_members
        SET status=?, removal_reason=CASE WHEN ?='removed' THEN ? ELSE removal_reason END,
            removed_at=CASE WHEN ?='removed' THEN DATETIME('now') ELSE removed_at END,
            updated_at=DATETIME('now')
        WHERE id=?
    """, (new_status, new_status, reason, new_status, nid))
    _log_nrc_audit(db, actor_id, nid, 'status_update', {'status': new_status, 'reason': reason})
    db.commit()
    db.close()
    return jsonify({'message': 'Representative status updated'})


@admin_bp.route('/nrc/<int:nid>/graduation', methods=['POST'])
@require_admin
def verify_nrc_graduation(nid):
    actor_id = get_jwt_identity()
    data = request.json or {}
    graduation_status = (data.get('graduation_status') or 'graduated').strip()
    db = get_db()
    member = db.execute("SELECT user_id FROM nrc_members WHERE id=?", (nid,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'NRC member not found'}), 404
    db.execute("""
        UPDATE users
        SET graduation_status=?, graduation_verified_at=DATETIME('now')
        WHERE id=?
    """, (graduation_status, member['user_id']))
    _refresh_governance_terms(db)
    _log_nrc_audit(db, actor_id, nid, 'graduation_verification', {'graduation_status': graduation_status})
    db.commit()
    db.close()
    return jsonify({'message': 'Graduation eligibility updated'})


@admin_bp.route('/nrc/<int:nid>/replace', methods=['POST'])
@require_admin
def replace_nrc_member(nid):
    actor_id = get_jwt_identity()
    data = request.json or {}
    replacement_user_id = data.get('replacement_user_id')
    reference_code = (data.get('reference_code') or 'INTERIM-REPLACEMENT').strip()
    if not replacement_user_id:
        return jsonify({'error': 'replacement_user_id is required'}), 400
    db = get_db()
    member = db.execute("SELECT * FROM nrc_members WHERE id=?", (nid,)).fetchone()
    replacement = db.execute("""
        SELECT id, university, graduation_status, graduation_year
        FROM users
        WHERE id=? AND status='approved' AND role='student'
    """, (replacement_user_id,)).fetchone()
    if not member or not replacement:
        db.close()
        return jsonify({'error': 'Representative or replacement student not found'}), 404
    if member['university'] != replacement['university']:
        db.close()
        return jsonify({'error': 'Replacement must come from the same university'}), 400
    if _is_user_graduated(replacement):
        db.close()
        return jsonify({'error': 'Graduated students cannot become representatives'}), 400
    db.execute("""
        UPDATE nrc_members
        SET status='removed', removal_reason='Replaced by admin workflow', removed_at=DATETIME('now'), updated_at=DATETIME('now')
        WHERE id=?
    """, (nid,))
    cur = db.execute("""
        INSERT INTO nrc_members
        (user_id, university, status, eligibility_status, is_primary, term_start, term_end, activation_reference)
        VALUES (?, ?, 'active', 'eligible', 1, DATETIME('now'), DATETIME('now', '+365 days'), ?)
    """, (replacement_user_id, replacement['university'], reference_code))
    new_id = cur.lastrowid
    _log_nrc_audit(db, actor_id, nid, 'replacement', {'replacement_user_id': replacement_user_id, 'new_member_id': new_id})
    _log_nrc_audit(db, actor_id, new_id, 'activation', {'reference_code': reference_code})
    db.commit()
    db.close()
    return jsonify({'message': 'Representative replacement completed', 'new_member_id': new_id})


@admin_bp.route('/executive/form-committee', methods=['POST'])
@require_admin
def form_executive_committee():
    actor_id = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    phase = db.execute("""
        SELECT id FROM voting_phases
        WHERE phase_number=2
        ORDER BY id DESC LIMIT 1
    """).fetchone()
    if not phase:
        db.close()
        return jsonify({'error': 'Phase 2 has not been configured yet'}), 404
    ranked = _form_executive_committee_from_phase(
        db,
        actor_id,
        phase['id'],
        reference_code=(data.get('decision_reference') or 'AUTO-NATIONAL-ELECTION')
    )
    db.commit()
    db.close()
    return jsonify({
        'message': 'Executive committee formed from the national election results.',
        'member_count': len(ranked)
    })


@admin_bp.route('/voting/assign_neb', methods=['POST'])
@require_admin
def assign_neb_role_legacy():
    actor_id = get_jwt_identity()
    data = request.json or {}
    user_id = data.get('user_id')
    role_name = (data.get('position') or '').strip()
    reference_code = (data.get('decision_reference') or 'LEGACY-NEB-DIRECTIVE').strip()
    if not user_id or not role_name:
        return jsonify({'error': 'user_id and position are required'}), 400
    if role_name in ('President', 'Vice President', 'Secretary General'):
        return jsonify({'error': 'Use vacancy resolution for locked top-three roles'}), 400

    db = get_db()
    member = db.execute("""
        SELECT * FROM executive_committee_members
        WHERE user_id=? AND status IN ('active','reassigned','standby')
        ORDER BY id DESC LIMIT 1
    """, (user_id,)).fetchone()
    if not member:
        cur = db.execute("""
            INSERT INTO executive_committee_members
            (user_id, governance_origin, status, vote_rank, term_start, term_end, decision_reference)
            VALUES (?, 'manual_assignment', 'standby', 999, DATETIME('now'), DATETIME('now', '+365 days'), ?)
        """, (user_id, reference_code))
        member_id = cur.lastrowid
        old_role = None
    else:
        member_id = member['id']
        old_role = member['assigned_role']
    occupant = db.execute("""
        SELECT id FROM executive_committee_members
        WHERE assigned_role=? AND status IN ('active','reassigned') AND id != ?
    """, (role_name, member_id)).fetchone()
    if occupant:
        db.close()
        return jsonify({'error': 'That role is already assigned to another executive member'}), 409
    decision_id = _create_executive_decision(
        db, 'manual_assignment', actor_id, reference_code,
        member_id=member_id, target_user_id=user_id,
        notes=f'Assigned through legacy NEB assignment flow to {role_name}.'
    )
    db.execute("""
        UPDATE executive_committee_members
        SET assigned_role=?, status=?, updated_at=DATETIME('now'), decision_reference=?
        WHERE id=?
    """, (role_name, 'reassigned' if old_role and old_role != role_name else 'active', reference_code, member_id))
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, ?, 'manual_assignment', ?, ?)
    """, (member_id, old_role, role_name, decision_id, actor_id))
    _log_executive_audit(
        db, actor_id, 'legacy_assign_neb', member_id=member_id, target_user_id=user_id,
        details={'old_role': old_role, 'new_role': role_name, 'reference_code': reference_code}
    )
    _create_executive_notification(
        db, f'Executive role assigned: {role_name}',
        'The admin recorded an NEB-directed role assignment for you.',
        member_id=member_id, recipient_user_id=user_id
    )
    db.commit()
    db.close()
    return jsonify({'message': f'{role_name} assigned successfully'})


@admin_bp.route('/executive/<int:member_id>/assign-role', methods=['POST'])
@require_admin
def assign_executive_role(member_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    role_name = (data.get('role_name') or data.get('position') or '').strip()
    reference_code = (data.get('decision_reference') or data.get('decision_id') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not role_name or not reference_code:
        return jsonify({'error': 'role_name and decision_reference are required'}), 400
    if role_name in ('President', 'Vice President', 'Secretary General'):
        return jsonify({'error': 'Top-three roles are reserved for automated election outcomes or vacancy resolution'}), 400

    db = get_db()
    member = db.execute("SELECT * FROM executive_committee_members WHERE id=?", (member_id,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'Executive member not found'}), 404
    if member['status'] == 'removed':
        db.close()
        return jsonify({'error': 'Cannot assign a role to a removed member'}), 400
    occupant = db.execute("""
        SELECT id FROM executive_committee_members
        WHERE assigned_role=? AND status IN ('active','reassigned') AND id != ?
    """, (role_name, member_id)).fetchone()
    if occupant:
        db.close()
        return jsonify({'error': 'That role is already assigned to another member'}), 409
    if member['is_role_locked'] and member['assigned_role'] and member['assigned_role'] != role_name:
        db.close()
        return jsonify({'error': 'This role is locked by election results and can only change through removal or vacancy resolution'}), 400

    decision_id = _create_executive_decision(
        db, 'manual_assignment', actor_id, reference_code, member_id=member_id,
        target_user_id=member['user_id'], notes=notes, document_path=document_path
    )
    db.execute("""
        UPDATE executive_committee_members
        SET assigned_role=?, status=?, decision_reference=?, decision_document_path=COALESCE(?, decision_document_path),
            updated_at=DATETIME('now')
        WHERE id=?
    """, (
        role_name,
        'reassigned' if member['assigned_role'] and member['assigned_role'] != role_name else 'active',
        reference_code, document_path or None, member_id
    ))
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, ?, 'manual_assignment', ?, ?)
    """, (member_id, member['assigned_role'], role_name, decision_id, actor_id))
    _log_executive_audit(
        db, actor_id, 'assign_role', member_id=member_id, target_user_id=member['user_id'],
        details={'old_role': member['assigned_role'], 'new_role': role_name, 'reference_code': reference_code}
    )
    _create_executive_notification(
        db, f'Executive role assigned: {role_name}',
        'Your executive portfolio was assigned based on an NEB directive.',
        member_id=member_id, recipient_user_id=member['user_id']
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Executive role assigned successfully'})


@admin_bp.route('/executive/<int:member_id>/reassign-role', methods=['POST'])
@require_admin
def reassign_executive_role(member_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    role_name = (data.get('role_name') or '').strip()
    reference_code = (data.get('decision_reference') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not role_name or not reference_code:
        return jsonify({'error': 'role_name and decision_reference are required'}), 400

    db = get_db()
    member = db.execute("SELECT * FROM executive_committee_members WHERE id=?", (member_id,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'Executive member not found'}), 404
    if member['is_role_locked'] and member['assigned_role'] in ('President', 'Vice President', 'Secretary General'):
        db.close()
        return jsonify({'error': 'Top-three roles cannot be reassigned directly. Remove the member first and resolve the vacancy.'}), 400
    occupant = db.execute("""
        SELECT id FROM executive_committee_members
        WHERE assigned_role=? AND status IN ('active','reassigned') AND id != ?
    """, (role_name, member_id)).fetchone()
    if occupant:
        db.close()
        return jsonify({'error': 'That role is already assigned to another member'}), 409
    decision_id = _create_executive_decision(
        db, 'role_reassignment', actor_id, reference_code, member_id=member_id,
        target_user_id=member['user_id'], notes=notes, document_path=document_path
    )
    db.execute("""
        UPDATE executive_committee_members
        SET assigned_role=?, status='reassigned', decision_reference=?, decision_document_path=COALESCE(?, decision_document_path),
            updated_at=DATETIME('now')
        WHERE id=?
    """, (role_name, reference_code, document_path or None, member_id))
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, ?, 'role_reassignment', ?, ?)
    """, (member_id, member['assigned_role'], role_name, decision_id, actor_id))
    _log_executive_audit(
        db, actor_id, 'reassign_role', member_id=member_id, target_user_id=member['user_id'],
        details={'old_role': member['assigned_role'], 'new_role': role_name, 'reference_code': reference_code}
    )
    _create_executive_notification(
        db, f'Executive role reassigned: {role_name}',
        'Your executive role was updated based on a formal NEB decision.',
        member_id=member_id, recipient_user_id=member['user_id']
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Executive role reassigned successfully'})


@admin_bp.route('/executive/<int:member_id>/remove', methods=['POST'])
@require_admin
def remove_executive_member(member_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    reason = (data.get('reason') or '').strip()
    reference_code = (data.get('decision_reference') or data.get('decision_id') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not reason or not reference_code:
        return jsonify({'error': 'reason and decision_reference are required'}), 400

    db = get_db()
    member = db.execute("""
        SELECT e.*, u.first_name||' '||u.father_name as name
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.id=?
    """, (member_id,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'Executive member not found'}), 404
    if member['status'] == 'removed':
        db.close()
        return jsonify({'error': 'Member is already removed'}), 400

    prior_role = member['assigned_role']
    decision_id = _create_executive_decision(
        db, 'removal', actor_id, reference_code, member_id=member_id,
        target_user_id=member['user_id'], notes=notes or reason, document_path=document_path
    )
    db.execute("""
        UPDATE executive_committee_members
        SET status='removed', removed_reason=?, removed_at=DATETIME('now'),
            assigned_role=NULL, is_role_locked=0, handover_status='required',
            decision_reference=?, decision_document_path=COALESCE(?, decision_document_path),
            updated_at=DATETIME('now')
        WHERE id=?
    """, (reason, reference_code, document_path or None, member_id))
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, NULL, 'removal', ?, ?)
    """, (member_id, prior_role, decision_id, actor_id))
    vacancy_id = None
    if prior_role:
        cur = db.execute("""
            INSERT INTO executive_vacancies
            (previous_member_id, role_name, reason, decision_reference, decision_document_path, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (member_id, prior_role, reason, reference_code, document_path, actor_id))
        vacancy_id = cur.lastrowid
    _ensure_handover_items(db, member_id)
    _log_executive_audit(
        db, actor_id, 'remove_member', member_id=member_id, target_user_id=member['user_id'],
        details={'prior_role': prior_role, 'reason': reason, 'vacancy_id': vacancy_id, 'reference_code': reference_code}
    )
    _create_executive_notification(
        db, 'Executive committee status updated',
        'You were removed from the executive committee by an NEB-referenced administrative action.',
        member_id=member_id, recipient_user_id=member['user_id']
    )
    db.commit()
    db.close()
    return jsonify({
        'message': 'Executive member removed and vacancy workflow started.',
        'vacancy_id': vacancy_id
    })


@admin_bp.route('/executive/<int:member_id>/engagement', methods=['POST'])
@require_admin
def update_executive_engagement(member_id):
    actor_id = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    member = db.execute("SELECT user_id FROM executive_committee_members WHERE id=?", (member_id,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'Executive member not found'}), 404
    db.execute("""
        UPDATE executive_committee_members
        SET engagement_status=COALESCE(?, engagement_status),
            engagement_notes=COALESCE(?, engagement_notes),
            performance_flag=COALESCE(?, performance_flag),
            updated_at=DATETIME('now')
        WHERE id=?
    """, (data.get('engagement_status'), data.get('engagement_notes'), data.get('performance_flag'), member_id))
    _log_executive_audit(
        db, actor_id, 'engagement_update', member_id=member_id, target_user_id=member['user_id'],
        details={
            'engagement_status': data.get('engagement_status'),
            'performance_flag': data.get('performance_flag')
        }
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Executive engagement status updated'})


@admin_bp.route('/executive/<int:member_id>/handover', methods=['GET'])
@require_admin
def get_executive_handover(member_id):
    db = get_db()
    rows = db.execute("""
        SELECT * FROM executive_handover_items
        WHERE member_id=?
        ORDER BY id ASC
    """, (member_id,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/executive/<int:member_id>/handover', methods=['POST'])
@require_admin
def update_executive_handover(member_id):
    actor_id = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    member = db.execute("SELECT user_id FROM executive_committee_members WHERE id=?", (member_id,)).fetchone()
    if not member:
        db.close()
        return jsonify({'error': 'Executive member not found'}), 404
    if data.get('item_id'):
        db.execute("""
            UPDATE executive_handover_items
            SET item_status=COALESCE(?, item_status),
                notes=COALESCE(?, notes),
                completed_at=CASE WHEN ?='completed' THEN DATETIME('now') ELSE completed_at END
            WHERE id=? AND member_id=?
        """, (data.get('item_status'), data.get('notes'), data.get('item_status'), data.get('item_id'), member_id))
    else:
        item_title = (data.get('item_title') or '').strip()
        if not item_title:
            db.close()
            return jsonify({'error': 'item_title is required'}), 400
        db.execute("""
            INSERT INTO executive_handover_items (member_id, item_title, item_status, notes, completed_at)
            VALUES (?, ?, COALESCE(?, 'pending'), ?, CASE WHEN ?='completed' THEN DATETIME('now') ELSE NULL END)
        """, (member_id, item_title, data.get('item_status'), data.get('notes'), data.get('item_status')))
    remaining = db.execute("""
        SELECT COUNT(*) FROM executive_handover_items
        WHERE member_id=? AND item_status != 'completed'
    """, (member_id,)).fetchone()[0]
    db.execute("""
        UPDATE executive_committee_members
        SET handover_status=CASE WHEN ?=0 THEN 'completed' ELSE 'required' END,
            updated_at=DATETIME('now')
        WHERE id=?
    """, (remaining, member_id))
    _log_executive_audit(
        db, actor_id, 'handover_update', member_id=member_id, target_user_id=member['user_id'],
        details={'remaining_items': remaining}
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Handover checklist updated', 'remaining_items': remaining})


@admin_bp.route('/executive/vacancies/<int:vacancy_id>/interest', methods=['POST'])
@require_admin
def record_vacancy_interest(vacancy_id):
    actor_id = get_jwt_identity()
    data = request.json or {}
    member_id = data.get('member_id')
    statement = (data.get('statement') or '').strip()
    if not member_id:
        return jsonify({'error': 'member_id is required'}), 400
    db = get_db()
    vacancy = db.execute("SELECT * FROM executive_vacancies WHERE id=?", (vacancy_id,)).fetchone()
    member = db.execute("""
        SELECT * FROM executive_committee_members
        WHERE id=? AND status IN ('active','reassigned','standby')
    """, (member_id,)).fetchone()
    if not vacancy or not member:
        db.close()
        return jsonify({'error': 'Vacancy or member not found'}), 404
    try:
        db.execute("""
            INSERT INTO executive_role_interest (vacancy_id, member_id, statement)
            VALUES (?, ?, ?)
        """, (vacancy_id, member_id, statement))
    except Exception:
        db.close()
        return jsonify({'error': 'Interest has already been recorded for this member'}), 409
    _log_executive_audit(
        db, actor_id, 'vacancy_interest', member_id=member_id, target_user_id=member['user_id'],
        details={'vacancy_id': vacancy_id, 'statement': statement}
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Interest recorded for vacancy review'})


@admin_bp.route('/executive/vacancies/<int:vacancy_id>/resolve-internal', methods=['POST'])
@require_admin
def resolve_vacancy_internal(vacancy_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    member_id = data.get('member_id')
    reference_code = (data.get('decision_reference') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not member_id or not reference_code:
        return jsonify({'error': 'member_id and decision_reference are required'}), 400

    db = get_db()
    vacancy = db.execute("SELECT * FROM executive_vacancies WHERE id=?", (vacancy_id,)).fetchone()
    member = db.execute("""
        SELECT * FROM executive_committee_members
        WHERE id=? AND status IN ('active','reassigned','standby')
    """, (member_id,)).fetchone()
    if not vacancy or not member:
        db.close()
        return jsonify({'error': 'Vacancy or executive member not found'}), 404
    if vacancy['status'] == 'resolved':
        db.close()
        return jsonify({'error': 'This vacancy has already been resolved'}), 400
    occupant = db.execute("""
        SELECT id FROM executive_committee_members
        WHERE assigned_role=? AND status IN ('active','reassigned') AND id != ?
    """, (vacancy['role_name'], member_id)).fetchone()
    if occupant:
        db.close()
        return jsonify({'error': 'This role is already occupied'}), 409

    decision_id = _create_executive_decision(
        db, 'vacancy_internal_resolution', actor_id, reference_code, member_id=member_id,
        target_user_id=member['user_id'], vacancy_id=vacancy_id, notes=notes, document_path=document_path
    )
    db.execute("""
        UPDATE executive_committee_members
        SET assigned_role=?, status='reassigned', decision_reference=?, decision_document_path=COALESCE(?, decision_document_path),
            updated_at=DATETIME('now')
        WHERE id=?
    """, (vacancy['role_name'], reference_code, document_path or None, member_id))
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, ?, 'vacancy_internal_resolution', ?, ?)
    """, (member_id, member['assigned_role'], vacancy['role_name'], decision_id, actor_id))
    db.execute("""
        UPDATE executive_vacancies
        SET status='resolved', resolution_path='internal_reassignment',
            replacement_member_id=?, resolved_at=DATETIME('now')
        WHERE id=?
    """, (member_id, vacancy_id))
    _log_executive_audit(
        db, actor_id, 'resolve_vacancy_internal', member_id=member_id, target_user_id=member['user_id'],
        details={'vacancy_id': vacancy_id, 'role_name': vacancy['role_name'], 'reference_code': reference_code}
    )
    _create_executive_notification(
        db, f'Vacancy resolved: {vacancy["role_name"]}',
        'You were selected internally to fill an executive vacancy.',
        member_id=member_id, recipient_user_id=member['user_id']
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Vacancy resolved through internal reassignment'})


@admin_bp.route('/executive/vacancies/<int:vacancy_id>/start-election', methods=['POST'])
@require_admin
def start_vacancy_election(vacancy_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    reference_code = (data.get('decision_reference') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not reference_code:
        return jsonify({'error': 'decision_reference is required'}), 400
    db = get_db()
    vacancy = db.execute("SELECT * FROM executive_vacancies WHERE id=?", (vacancy_id,)).fetchone()
    if not vacancy:
        db.close()
        return jsonify({'error': 'Vacancy not found'}), 404
    if vacancy['status'] == 'resolved':
        db.close()
        return jsonify({'error': 'This vacancy is already resolved'}), 400
    existing = db.execute("""
        SELECT id FROM executive_vacancy_elections
        WHERE vacancy_id=? AND status IN ('draft','active')
        ORDER BY id DESC LIMIT 1
    """, (vacancy_id,)).fetchone()
    decision_id = _create_executive_decision(
        db, 'vacancy_election_start', actor_id, reference_code, vacancy_id=vacancy_id,
        notes=notes, document_path=document_path
    )
    if existing:
        db.execute("""
            UPDATE executive_vacancy_elections
            SET status='active', result_reference=COALESCE(result_reference, ?)
            WHERE id=?
        """, (reference_code, existing['id']))
    else:
        db.execute("""
            INSERT INTO executive_vacancy_elections
            (vacancy_id, position_name, status, eligible_group, result_reference)
            VALUES (?, ?, 'active', 'nrc', ?)
        """, (vacancy_id, vacancy['role_name'], reference_code))
    db.execute("""
        UPDATE executive_vacancies
        SET status='in_election', resolution_path='external_election', decision_document_path=COALESCE(?, decision_document_path)
        WHERE id=?
    """, (document_path or None, vacancy_id))
    _log_executive_audit(
        db, actor_id, 'start_vacancy_election', details={
            'vacancy_id': vacancy_id,
            'role_name': vacancy['role_name'],
            'decision_reference': reference_code,
            'decision_id': decision_id
        }
    )
    _create_executive_notification(
        db,
        f'Vacancy election opened: {vacancy["role_name"]}',
        'A role-specific election workflow has been opened for NRC-backed replacement.',
        audience='nrc'
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Vacancy election opened for NRC candidates'})


@admin_bp.route('/executive/vacancies/<int:vacancy_id>/complete-election', methods=['POST'])
@require_admin
def complete_vacancy_election(vacancy_id):
    actor_id = get_jwt_identity()
    data = request.form if request.files else (request.json or {})
    winner_user_id = data.get('winner_user_id')
    winner_vote_count = int(data.get('winner_vote_count') or 0)
    result_reference = (data.get('result_reference') or data.get('decision_reference') or '').strip()
    notes = (data.get('notes') or '').strip()
    document_path = _save_governance_document(request.files.get('decision_document') if request.files else None)
    if not winner_user_id or not result_reference:
        return jsonify({'error': 'winner_user_id and result_reference are required'}), 400

    db = get_db()
    vacancy = db.execute("SELECT * FROM executive_vacancies WHERE id=?", (vacancy_id,)).fetchone()
    election = db.execute("""
        SELECT * FROM executive_vacancy_elections
        WHERE vacancy_id=? ORDER BY id DESC LIMIT 1
    """, (vacancy_id,)).fetchone()
    eligible = db.execute("""
        SELECT er.user_id
        FROM election_results er
        WHERE er.user_id=? AND er.is_active=1 AND LOWER(er.position) LIKE '%representative%'
    """, (winner_user_id,)).fetchone()
    if not vacancy or not election:
        db.close()
        return jsonify({'error': 'Vacancy or vacancy election not found'}), 404
    if not eligible:
        db.close()
        return jsonify({'error': 'Winner must come from the NRC representative pool'}), 400

    member = db.execute("""
        SELECT * FROM executive_committee_members
        WHERE user_id=? AND status IN ('active','reassigned','standby')
        ORDER BY id DESC LIMIT 1
    """, (winner_user_id,)).fetchone()
    if member:
        member_id = member['id']
        old_role = member['assigned_role']
        db.execute("""
            UPDATE executive_committee_members
            SET assigned_role=?, status='reassigned', governance_origin='vacancy_election',
                vote_count=?, decision_reference=?, decision_document_path=COALESCE(?, decision_document_path),
                updated_at=DATETIME('now')
            WHERE id=?
        """, (vacancy['role_name'], winner_vote_count, result_reference, document_path or None, member_id))
    else:
        cur = db.execute("""
            INSERT INTO executive_committee_members
            (user_id, governance_origin, vote_count, assigned_role, status, term_start, term_end, decision_reference, decision_document_path)
            VALUES (?, 'vacancy_election', ?, ?, 'active', DATETIME('now'), DATETIME('now', '+365 days'), ?, ?)
        """, (winner_user_id, winner_vote_count, vacancy['role_name'], result_reference, document_path))
        member_id = cur.lastrowid
        old_role = None

    decision_id = _create_executive_decision(
        db, 'vacancy_election_result', actor_id, result_reference,
        member_id=member_id, target_user_id=winner_user_id, vacancy_id=vacancy_id,
        notes=notes, document_path=document_path
    )
    db.execute("""
        INSERT INTO executive_role_history
        (member_id, old_role, new_role, change_type, decision_id, changed_by)
        VALUES (?, ?, ?, 'vacancy_election_result', ?, ?)
    """, (member_id, old_role, vacancy['role_name'], decision_id, actor_id))
    db.execute("""
        UPDATE executive_vacancy_elections
        SET status='completed', winner_user_id=?, winner_vote_count=?, result_reference=?, ended_at=DATETIME('now')
        WHERE id=?
    """, (winner_user_id, winner_vote_count, result_reference, election['id']))
    db.execute("""
        UPDATE executive_vacancies
        SET status='resolved', resolution_path='external_election', replacement_member_id=?, resolved_at=DATETIME('now'),
            decision_document_path=COALESCE(?, decision_document_path)
        WHERE id=?
    """, (member_id, document_path or None, vacancy_id))
    _log_executive_audit(
        db, actor_id, 'complete_vacancy_election', member_id=member_id, target_user_id=winner_user_id,
        details={'vacancy_id': vacancy_id, 'role_name': vacancy['role_name'], 'winner_vote_count': winner_vote_count}
    )
    _create_executive_notification(
        db, f'Elected to executive office: {vacancy["role_name"]}',
        'You were recorded as the winner of the position-specific vacancy election.',
        member_id=member_id, recipient_user_id=winner_user_id
    )
    db.commit()
    db.close()
    return jsonify({'message': 'Vacancy election completed and the role has been assigned'})

@admin_bp.route('/news', methods=['GET'])
@require_admin
def get_all_news():
    db = get_db()
    rows = db.execute("SELECT * FROM news_events ORDER BY created_at DESC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/news', methods=['POST'])
@require_admin
def add_news():
    data = request.form
    file = request.files.get('image')
    filename = ''
    if file:
        import uuid
        ext = file.filename.split('.')[-1]
        filename = f"news_{uuid.uuid4().hex[:8]}.{ext}"
        filename = save_upload(file, 'news', filename=filename)
    
    db = get_db()
    if data.get('is_featured') == '1':
        db.execute("UPDATE news_events SET is_featured=0")  # Ensures only one is featured
        
    db.execute("""
        INSERT INTO news_events (title, category, excerpt, content, image_path, is_featured)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (data.get('title'), data.get('category'), data.get('excerpt'), data.get('content'), filename, int(data.get('is_featured', 0))))
    db.commit(); db.close()
    return jsonify({'message': 'News published successfully'})

@admin_bp.route('/news/<int:nid>', methods=['DELETE'])
@require_admin
def delete_news(nid):
    db = get_db()
    db.execute("DELETE FROM news_events WHERE id=?", (nid,))
    db.commit(); db.close()
    return jsonify({'message': 'News removed'})

@admin_bp.route('/students', methods=['GET'])
@require_admin
def all_students():
    db   = get_db()
    rows = db.execute("SELECT id,first_name,father_name,email,university,program_type,academic_year,status,is_verified,is_active,student_id,created_at FROM users WHERE role='student' ORDER BY created_at DESC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ══════════════════════════════════════════════════════════════
# CLUBS & OVERSIGHT
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/clubs', methods=['GET'])
@require_admin
def admin_list_clubs():
    status = request.args.get('status', 'all')
    db = get_db()
    query = """
        SELECT c.*, u.first_name||' '||u.father_name as president_name, u.email as president_email,
               (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id) as member_count_live,
               (SELECT COUNT(*) FROM club_activities ca WHERE ca.club_id = c.id) as activity_count,
               (SELECT COUNT(*) FROM support_requests sr WHERE sr.club_id = c.id AND sr.status='pending') as pending_support_requests
        FROM clubs c LEFT JOIN users u ON c.president_id = u.id
    """
    if status != 'all':
        rows = db.execute(query + " WHERE c.status=? ORDER BY c.created_at DESC", (status,)).fetchall()
    else:
        rows = db.execute(query + " ORDER BY c.created_at DESC").fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        if d['logo_path']: d['logo_url'] = upload_url('clubs', d['logo_path'])
        result.append(d)
    return jsonify(result)

@admin_bp.route('/clubs/<int:cid>/approve', methods=['POST'])
@require_admin
def admin_approve_club(cid):
    db = get_db()
    db.execute("UPDATE clubs SET status='approved' WHERE id=?", (cid,))
    db.commit(); db.close()
    return jsonify({'message': 'Club approved and is now publicly visible'})

@admin_bp.route('/clubs/<int:cid>/reject', methods=['POST'])
@require_admin
def admin_reject_club(cid):
    reason = (request.json or {}).get('reason', 'Does not meet requirements')
    db = get_db()
    db.execute("UPDATE clubs SET status='rejected' WHERE id=?", (cid,))
    db.commit(); db.close()
    return jsonify({'message': f'Club rejected: {reason}'})

@admin_bp.route('/clubs/<int:cid>', methods=['DELETE'])
@require_admin
def admin_delete_club(cid):
    db = get_db()
    db.execute("DELETE FROM club_members WHERE club_id=?", (cid,))
    db.execute("DELETE FROM clubs WHERE id=?", (cid,))
    db.commit(); db.close()
    return jsonify({'message': 'Club removed'})

@admin_bp.route('/clubs/<int:cid>/members', methods=['GET'])
@require_admin
def admin_club_members(cid):
    db = get_db()
    rows = db.execute("""
        SELECT cm.role, u.first_name||' '||u.father_name as name, u.university, u.student_id, u.email
        FROM club_members cm JOIN users u ON cm.user_id = u.id WHERE cm.club_id=?
    """, (cid,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ══════════════════════════════════════════════════════════════
# GRANTS & FINANCIAL AUDITOR
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/proposals', methods=['GET'])
@require_admin
def admin_list_proposals():
    status = request.args.get('status', 'all')
    db = get_db()
    query = """
        SELECT p.*, c.name as club_name, c.university as club_uni
        FROM proposals p JOIN clubs c ON p.club_id = c.id
    """
    if status != 'all':
        rows = db.execute(query + " WHERE p.status=? ORDER BY p.submitted_at DESC", (status,)).fetchall()
    else:
        rows = db.execute(query + " ORDER BY p.submitted_at DESC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/proposals/<int:pid>/approve', methods=['POST'])
@require_admin
def admin_approve_proposal(pid):
    data = request.json or {}
    db = get_db()
    db.execute("UPDATE proposals SET status='approved', admin_notes=?, reviewed_at=DATETIME('now') WHERE id=?",
               (data.get('notes', ''), pid))
    db.commit(); db.close()
    return jsonify({'message': 'Proposal approved — club can now begin project'})

@admin_bp.route('/proposals/<int:pid>/reject', methods=['POST'])
@require_admin
def admin_reject_proposal(pid):
    reason = (request.json or {}).get('reason', 'Does not meet funding criteria')
    db = get_db()
    db.execute("UPDATE proposals SET status='rejected', admin_notes=?, reviewed_at=DATETIME('now') WHERE id=?",
               (reason, pid))
    db.commit(); db.close()
    return jsonify({'message': 'Proposal rejected'})

@admin_bp.route('/proposals/<int:pid>/fund', methods=['POST'])
@require_admin
def admin_fund_proposal(pid):
    data = request.json or {}
    db = get_db()
    proposal = db.execute("SELECT budget, funded_amount FROM proposals WHERE id=?", (pid,)).fetchone()
    if not proposal:
        db.close(); return jsonify({'error': 'Proposal not found'}), 404
    funded_amount = float(data.get('funded_amount') or proposal['funded_amount'] or proposal['budget'] or 0)
    grant_source_id = data.get('grant_source_id')
    if grant_source_id:
        source = db.execute("SELECT id, amount_received FROM grant_sources WHERE id=?", (grant_source_id,)).fetchone()
        if not source:
            db.close(); return jsonify({'error': 'Grant source not found'}), 404
        remaining = float(source['amount_received'] or 0)
        if remaining and funded_amount > remaining:
            db.close(); return jsonify({'error': 'Allocated amount exceeds available grant source balance'}), 400
        db.execute("""
            UPDATE grant_sources
            SET amount_received = MAX(0, amount_received - ?)
            WHERE id=?
        """, (funded_amount, grant_source_id))
    db.execute("""
        UPDATE proposals
        SET status='funded', funded_amount=?, admin_notes=COALESCE(?, admin_notes), reviewed_at=DATETIME('now')
        WHERE id=?
    """, (funded_amount, data.get('notes'), pid))
    db.commit(); db.close()
    return jsonify({'message': 'Proposal marked as funded — club must submit financial report to complete'})

@admin_bp.route('/grant-sources', methods=['GET'])
@require_admin
def admin_grant_sources():
    status = request.args.get('status', 'all')
    db = get_db()
    query = """
        SELECT gs.*, p.name as partner_name, p.category as partner_category
        FROM grant_sources gs
        LEFT JOIN partners p ON p.id = gs.partner_id
    """
    if status != 'all':
        rows = db.execute(query + " WHERE gs.status=? ORDER BY gs.created_at DESC", (status,)).fetchall()
    else:
        rows = db.execute(query + " ORDER BY gs.created_at DESC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/grant-sources', methods=['POST'])
@require_admin
def admin_create_grant_source():
    data = request.json or {}
    title = (data.get('title') or '').strip()
    sponsor_name = (data.get('sponsor_name') or '').strip()
    db = get_db()
    partner_id = data.get('partner_id')
    if partner_id:
        partner = db.execute("SELECT name FROM partners WHERE id=?", (partner_id,)).fetchone()
        if partner:
            sponsor_name = partner['name']
    if not title or not sponsor_name:
        db.close()
        return jsonify({'error': 'title and sponsor are required'}), 400
    db.execute("""
        INSERT INTO grant_sources (title, sponsor_name, sponsor_type, partner_id, amount_committed, amount_received, status, notes, received_at)
        VALUES (?,?,?,?,?,?,?,?, COALESCE(?, DATETIME('now')))
    """, (
        title,
        sponsor_name,
        data.get('sponsor_type', 'individual'),
        partner_id,
        float(data.get('amount_committed') or 0),
        float(data.get('amount_received') or data.get('amount_committed') or 0),
        data.get('status', 'active'),
        data.get('notes', ''),
        data.get('received_at')
    ))
    db.commit(); db.close()
    return jsonify({'message': 'Grant source added'}), 201

@admin_bp.route('/grant-sources/<int:gid>', methods=['PUT'])
@require_admin
def admin_update_grant_source(gid):
    data = request.json or {}
    db = get_db()
    db.execute("""
        UPDATE grant_sources
        SET title=COALESCE(?, title),
            sponsor_name=COALESCE(?, sponsor_name),
            sponsor_type=COALESCE(?, sponsor_type),
            partner_id=COALESCE(?, partner_id),
            amount_committed=COALESCE(?, amount_committed),
            amount_received=COALESCE(?, amount_received),
            status=COALESCE(?, status),
            notes=COALESCE(?, notes),
            received_at=COALESCE(?, received_at)
        WHERE id=?
    """, (
        data.get('title'),
        data.get('sponsor_name'),
        data.get('sponsor_type'),
        data.get('partner_id'),
        data.get('amount_committed'),
        data.get('amount_received'),
        data.get('status'),
        data.get('notes'),
        data.get('received_at'),
        gid
    ))
    db.commit(); db.close()
    return jsonify({'message': 'Grant source updated'})

@admin_bp.route('/grant-sources/<int:gid>', methods=['DELETE'])
@require_admin
def admin_delete_grant_source(gid):
    db = get_db()
    db.execute("DELETE FROM grant_sources WHERE id=?", (gid,))
    db.commit(); db.close()
    return jsonify({'message': 'Grant source removed'})

@admin_bp.route('/financial-reports', methods=['GET'])
@require_admin
def admin_financial_reports():
    db = get_db()
    rows = db.execute("""
        SELECT fr.*, p.title as proposal_title, c.name as club_name
        FROM financial_reports fr
        JOIN proposals p ON fr.proposal_id = p.id
        JOIN clubs c ON fr.club_id = c.id
        ORDER BY fr.submitted_at DESC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/financial-reports/<int:rid>/verify', methods=['POST'])
@require_admin
def admin_verify_financial_report(rid):
    uid = get_jwt_identity()
    db  = get_db()
    fr  = db.execute("SELECT proposal_id FROM financial_reports WHERE id=?", (rid,)).fetchone()
    if not fr: db.close(); return jsonify({'error': 'Not found'}), 404
    db.execute("UPDATE financial_reports SET status='verified', verified_at=DATETIME('now'), verified_by=? WHERE id=?", (uid, rid))
    db.execute("UPDATE proposals SET status='completed' WHERE id=?", (fr['proposal_id'],))
    db.commit(); db.close()
    return jsonify({'message': 'Financial report verified — project marked complete'})

# ══════════════════════════════════════════════════════════════
# PARTNER CONTROL PANEL
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/partners', methods=['GET'])
@require_admin
def admin_list_partners():
    db = get_db()
    rows = db.execute("""
        SELECT p.*,
               (SELECT COUNT(*) FROM partner_gallery pg WHERE pg.partner_id = p.id) as gallery_count,
               (SELECT COUNT(*) FROM grant_sources gs WHERE gs.partner_id = p.id) as grant_source_count
        FROM partners p
        ORDER BY p.name
    """).fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        if d['logo_path']: d['logo_url'] = upload_url('partners', d['logo_path'])
        result.append(d)
    return jsonify(result)

@admin_bp.route('/partners', methods=['POST'])
@require_admin
def admin_create_partner():
    data = request.form
    file = request.files.get('logo')
    filename = ''
    if file and file.filename:
        import uuid
        ext = file.filename.rsplit('.', 1)[-1]
        filename = f"partner_{uuid.uuid4().hex[:8]}.{ext}"
        filename = save_upload(file, 'partners', filename=filename)
    db = get_db()
    db.execute("""
        INSERT INTO partners (name, category, logo_path, description, website, partnership_type, what_they_do, is_active)
        VALUES (?,?,?,?,?,?,?,?)
    """, (data.get('name'), data.get('category', 'NGO'), filename,
          data.get('description'), data.get('website'),
          data.get('partnership_type', 'Strategic'), data.get('what_they_do'),
          0 if str(data.get('is_active', '1')).lower() in ('0', 'false', 'no') else 1))
    db.commit(); db.close()
    return jsonify({'message': 'Partner created'}), 201

@admin_bp.route('/partners/<int:pid>', methods=['PUT'])
@require_admin
def admin_update_partner(pid):
    data = request.json or {}
    db = get_db()
    db.execute("""
        UPDATE partners SET name=COALESCE(?,name), description=COALESCE(?,description),
        category=COALESCE(?,category), website=COALESCE(?,website),
        partnership_type=COALESCE(?,partnership_type), what_they_do=COALESCE(?,what_they_do),
        is_active=COALESCE(?,is_active) WHERE id=?
    """, (data.get('name'), data.get('description'), data.get('category'), data.get('website'),
          data.get('partnership_type'), data.get('what_they_do'), data.get('is_active'), pid))
    db.commit(); db.close()
    return jsonify({'message': 'Partner updated'})

@admin_bp.route('/partners/<int:pid>/toggle', methods=['POST'])
@require_admin
def admin_toggle_partner(pid):
    db = get_db()
    row = db.execute("SELECT is_active FROM partners WHERE id=?", (pid,)).fetchone()
    if not row:
        db.close(); return jsonify({'error': 'Not found'}), 404
    new_status = 0 if row['is_active'] else 1
    db.execute("UPDATE partners SET is_active=? WHERE id=?", (new_status, pid))
    db.commit(); db.close()
    return jsonify({'message': 'Partner activated' if new_status else 'Partner hidden', 'is_active': new_status})

@admin_bp.route('/partners/<int:pid>', methods=['DELETE'])
@require_admin
def admin_delete_partner(pid):
    db = get_db()
    db.execute("DELETE FROM partner_gallery WHERE partner_id=?", (pid,))
    db.execute("DELETE FROM partners WHERE id=?", (pid,))
    db.commit(); db.close()
    return jsonify({'message': 'Partner removed'})

@admin_bp.route('/partners/<int:pid>/gallery', methods=['POST'])
@require_admin
def admin_add_partner_gallery(pid):
    file = request.files.get('image')
    if not file or not file.filename:
        return jsonify({'error': 'No image provided'}), 400
    import uuid
    ext = file.filename.rsplit('.', 1)[-1]
    filename = f"pgal_{uuid.uuid4().hex[:8]}.{ext}"
    filename = save_upload(file, 'partner_gallery', filename=filename)
    db = get_db()
    db.execute("INSERT INTO partner_gallery (partner_id, image_path, caption, order_num) VALUES (?,?,?,?)",
               (pid, filename, request.form.get('caption', ''), int(request.form.get('order_num', 0))))
    db.commit(); db.close()
    return jsonify({'message': 'Gallery image added'}), 201

# ─── EPSA SETTINGS (Budget Control) ──────────────────────────────────
@admin_bp.route('/settings', methods=['GET'])
@require_admin
def get_epsa_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM epsa_settings").fetchall()
    db.close()
    return jsonify({r['key']: r['value'] for r in rows})

@admin_bp.route('/settings', methods=['POST'])
@require_admin
def update_epsa_settings():
    data = request.json or {}
    db = get_db()
    for k, v in data.items():
        db.execute("INSERT INTO epsa_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?", (k, str(v), str(v)))
    db.commit(); db.close()
    return jsonify({'message': 'Settings updated'})

# ══════════════════════════════════════════════════════════════
# SUPPORT REQUESTS OVERSIGHT
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/support-requests', methods=['GET'])
@require_admin
def admin_support_requests():
    status = request.args.get('status', 'all')
    db = get_db()
    query = """
        SELECT sr.*, c.name as club_name, c.university as club_uni
        FROM support_requests sr JOIN clubs c ON sr.club_id = c.id
    """
    if status != 'all':
        rows = db.execute(query + " WHERE sr.status=? ORDER BY sr.submitted_at DESC", (status,)).fetchall()
    else:
        rows = db.execute(query + " ORDER BY sr.submitted_at DESC").fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@admin_bp.route('/support-requests/<int:sid>/respond', methods=['POST'])
@require_admin
def admin_respond_support(sid):
    data = request.json or {}
    new_status = data.get('status', 'reviewed')
    response = data.get('response', '')
    db = get_db()
    db.execute("""
        UPDATE support_requests SET status=?, admin_response=?, reviewed_at=DATETIME('now')
        WHERE id=?
    """, (new_status, response, sid))
    db.commit(); db.close()
    return jsonify({'message': 'Support request updated'})

# ══════════════════════════════════════════════════════════════
# FINANCIAL REPORT FLAGGING
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/financial-reports/<int:rid>/flag', methods=['POST'])
@require_admin
def admin_flag_financial_report(rid):
    reason = (request.json or {}).get('reason', 'Discrepancy detected')
    db = get_db()
    db.execute("UPDATE financial_reports SET status='flagged', admin_notes=? WHERE id=?", (reason, rid))
    db.commit(); db.close()
    return jsonify({'message': 'Financial report flagged for review'})

# ══════════════════════════════════════════════════════════════
# CLUB ACTIVITY MONITORING
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/clubs/<int:cid>/activities', methods=['GET'])
@require_admin
def admin_club_activities(cid):
    db = get_db()
    rows = db.execute("""
        SELECT ca.*, u.first_name||' '||u.father_name as author_name
        FROM club_activities ca JOIN users u ON ca.posted_by = u.id
        WHERE ca.club_id=? ORDER BY ca.created_at DESC LIMIT 50
    """, (cid,)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ══════════════════════════════════════════════════════════════
# BUDGET ALLOCATION TRACKING
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/budget/overview', methods=['GET'])
@require_admin
def budget_overview():
    db = get_db()
    settings = {r['key']: r['value'] for r in db.execute("SELECT key, value FROM epsa_settings").fetchall()}
    sourced_pool = db.execute("""
        SELECT COALESCE(SUM(amount_committed),0)
        FROM grant_sources
        WHERE status IN ('active','completed','pledged')
    """).fetchone()[0]
    total_pool = float(sourced_pool or settings.get('grant_pool_total', 500000))
    available_grants = db.execute("""
        SELECT COALESCE(SUM(amount_received),0)
        FROM grant_sources
        WHERE status IN ('active','completed','pledged')
    """).fetchone()[0]
    total_funded = db.execute("""
        SELECT COALESCE(SUM(CASE WHEN funded_amount > 0 THEN funded_amount ELSE budget END),0)
        FROM proposals WHERE status IN ('funded','completed')
    """).fetchone()[0]
    total_spent = db.execute("SELECT COALESCE(SUM(total_spent),0) FROM financial_reports WHERE status='verified'").fetchone()[0]
    pending_amount = db.execute("SELECT COALESCE(SUM(budget),0) FROM proposals WHERE status='pending'").fetchone()[0]
    approved_amount = db.execute("SELECT COALESCE(SUM(budget),0) FROM proposals WHERE status='approved'").fetchone()[0]
    clubs_funded = db.execute("SELECT COUNT(DISTINCT club_id) FROM proposals WHERE status IN ('funded','completed')").fetchone()[0]
    pending_verifications = db.execute("SELECT COUNT(*) FROM financial_reports WHERE status='pending'").fetchone()[0]
    flagged_reports = db.execute("SELECT COUNT(*) FROM financial_reports WHERE status='flagged'").fetchone()[0]
    db.close()
    return jsonify({
        'total_pool': total_pool,
        'remaining': total_pool - total_funded,
        'total_funded': total_funded,
        'available_grants': available_grants,
        'total_spent': total_spent,
        'committed_grants': total_pool,
        'allocated_grants': total_funded,
        'verified_spend': total_spent,
        'pending_amount': pending_amount,
        'approved_amount': approved_amount,
        'clubs_funded': clubs_funded,
        'pending_verifications': pending_verifications,
        'flagged_reports': flagged_reports,
        'term_definitions': {
            'grant_pool': 'All committed money recorded for EPSA grants from partners and individual supporters.',
            'allocated': 'Amount already awarded by EPSA to approved club proposals.',
            'available': 'Amount still available to allocate after current funding decisions.',
            'funded_clubs': 'Number of distinct clubs that have already received grant allocations.',
            'verified_spend': 'Amount whose post-project spending has been reviewed and verified by admin.',
            'committed_amount': 'The full value a donor or partner promises to the national grant pool.',
            'available_amount': 'The portion of that source still not assigned to a club project.',
            'status': 'Use active for usable grants, pledged for promised but not fully usable funds, and completed for closed grant sources.'
        }
    })

@admin_bp.route('/telegram/broadcast', methods=['POST'])
@require_admin
def telegram_broadcast():
    data = request.form if request.form else (request.json or {})
    message_text = (data.get('message') or '').strip()
    button_type = (data.get('button_type') or 'open_portal').strip().lower()
    media_file = request.files.get('media')

    if not message_text and not (media_file and media_file.filename):
        return jsonify({'error': 'Add a message or attach media before sending.'}), 400

    try:
        from .config import get_settings
    except ImportError:
        from config import get_settings
    settings = get_settings()
    bot_token = settings.telegram_bot_token

    if not bot_token:
        return jsonify({'error': 'Telegram Bot Token is not configured.'}), 500

    import requests
    import json

    # We must use https://t.me/ because the Telegram API rejects tg:// URLs 
    # for inline buttons with a BUTTON_URL_INVALID error. 
    public_base_url = "https://epsahub.com"
    home_url = "https://t.me/epsahub_bot/EPSA"
    
    register_url = "https://t.me/epsahub_bot/EPSA?startapp=register"
    portal_url = "https://t.me/epsahub_bot/EPSA?startapp=login"

    button_map = {
        'open_portal': {
            'text': 'Open EPSA Portal',
            'url': portal_url,
        },
        'join_hub': {
            'text': 'Join EPSA HUB',
            'url': register_url,
        },
        'see_epsa': {
            'text': 'Explore EPSA',
            'url': home_url,
        },
    }
    chosen_button = button_map.get(button_type, button_map['open_portal'])

    reply_markup = {
        "inline_keyboard": [
            [
                {
                    "text": chosen_button["text"],
                    "url": chosen_button["url"]
                }
            ]
        ]
    }

    # ── Send to both the member hub AND the official public channel ──
    BROADCAST_TARGETS = [
        "@epsahub",              # existing member bot group
        "@EPSA_Official_Channel", # public channel (bot must be admin)
    ]

    endpoint = "sendMessage"
    request_payload_base = {}
    request_payload_base["reply_markup"] = json.dumps(reply_markup)
    
    files = None
    if media_file and media_file.filename:
        ext = media_file.filename.rsplit('.', 1)[-1].lower() if '.' in media_file.filename else ''
        media_kind = 'photo' if (
            (media_file.mimetype or '').startswith('image/')
            or ext in {'jpg', 'jpeg', 'png', 'webp'}
        ) else 'video'
        endpoint = 'sendPhoto' if media_kind == 'photo' else 'sendVideo'
        request_payload_base.update({'caption': message_text[:1024]})
        media_file.stream.seek(0)
        media_bytes = media_file.stream.read()
        files_template = (media_file.filename, media_bytes, media_file.mimetype or 'application/octet-stream')
        media_key = media_kind
    else:
        request_payload_base['text'] = message_text
        media_bytes = None
        files_template = None
        media_key = None

    url = f"https://api.telegram.org/bot{bot_token}/{endpoint}"

    successes = []
    failures = []
    try:
        for target in BROADCAST_TARGETS:
            send_payload = {**request_payload_base, "chat_id": target}
            
            if files_template and media_key:
                files = {media_key: files_template}
                resp = requests.post(url, data=send_payload, files=files, timeout=30)
            else:
                resp = requests.post(url, data=send_payload, timeout=30)
            resp_data = resp.json()
            if resp_data.get('ok'):
                successes.append(target)
            else:
                err = resp_data.get('description', 'Unknown error')
                logger.warning(f"[Broadcast] Failed for {target}: {err}")
                failures.append({"target": target, "error": err})

        if not successes:
            return jsonify({'error': f"Broadcast failed for all targets. Details: {failures}"}), 500

        msg = f"Broadcast sent to {len(successes)} target(s): {', '.join(successes)}."
        if failures:
            msg += f" Failed for: {[f['target'] for f in failures]}."
        return jsonify({'message': msg, 'successes': successes, 'failures': failures})

    except Exception as e:
        logger.error(f"Broadcast error: {e}")
        return jsonify({'error': f"Failed to connect to Telegram: {str(e)}\n"}), 500
