"""EPSA Exams Routes"""
import json
from datetime import datetime, timedelta
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
    from .face_verification import (
        DEFAULT_THRESHOLD,
        FaceVerificationError,
        deserialize_embedding,
        deserialize_embedding_set,
        verify_live_capture_against_set,
    )
    from .models import get_db
except ImportError:
    from face_verification import (
        DEFAULT_THRESHOLD,
        FaceVerificationError,
        deserialize_embedding,
        deserialize_embedding_set,
        verify_live_capture_against_set,
    )
    from models import get_db

exams_bp = Blueprint('exams', __name__)
EXAM_FACE_VERIFY_WINDOW_MINUTES = 10


def _exam_user_id():
    """JWT identity is stored as string; SQLite user_id columns are INTEGER — normalize everywhere."""
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _safe_answers(raw_value):
    try:
        parsed = json.loads(raw_value) if raw_value else {}
    except Exception:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_submission_payload(exam_row, submission_row):
    if not submission_row:
        return None
    payload = dict(submission_row)
    results_released = bool(int(exam_row.get('results_released', 0) or 0)) if isinstance(exam_row, dict) else bool(
        exam_row['results_released']
    )
    payload['status'] = payload.get('status') or ('submitted' if payload.get('submitted_at') else 'in_progress')
    payload['result_pending'] = bool(payload.get('submitted_at')) and not results_released
    if not results_released:
        payload['score'] = None
        payload['passed'] = None
    else:
        try:
            raw_ps = exam_row.get('passing_score', 60) if isinstance(exam_row, dict) else exam_row['passing_score']
            passing_mark = float(raw_ps if raw_ps is not None else 60)
        except (TypeError, ValueError):
            passing_mark = 60.0
        if payload.get('passed') is None and payload.get('score') is not None:
            payload['passed'] = float(payload['score'] or 0) >= passing_mark
        payload['passing_score'] = passing_mark
    return payload


def _get_face_profile(db, user_id):
    return db.execute("""
        SELECT *
        FROM face_embeddings
        WHERE user_id=? AND registration_verified=1
        ORDER BY id DESC LIMIT 1
    """, (user_id,)).fetchone()


def _recent_exam_face_verification(db, exam_id, user_id):
    return db.execute("""
        SELECT *
        FROM exam_face_verifications
        WHERE exam_id=? AND user_id=? AND status='approved'
          AND created_at >= DATETIME('now', ?)
        ORDER BY id DESC LIMIT 1
    """, (exam_id, user_id, f'-{EXAM_FACE_VERIFY_WINDOW_MINUTES} minutes')).fetchone()

@exams_bp.route('', methods=['GET'])
@jwt_required()
def list_exams():
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session', 'server_time': datetime.now().isoformat(), 'exams': []}), 401
    db  = get_db()
    face_profile = _get_face_profile(db, uid)
    rows = db.execute(
        """
        SELECT * FROM exams
        WHERE COALESCE(CAST(is_active AS INTEGER), 0) = 1
        ORDER BY scheduled_at
        """
    ).fetchall()
    result = []
    for r in rows:
        e = _serialize_row(r)
        sub = db.execute("""
            SELECT score, submitted_at, started_at, status, review_status, progress_count, last_activity_at, passed
            FROM exam_submissions
            WHERE exam_id=? AND user_id=?
        """, (r['id'], uid)).fetchone()
        e['my_submission'] = _normalize_submission_payload(e, sub)
        e['question_count'] = db.execute("SELECT COUNT(*) FROM exam_questions WHERE exam_id=?", (r['id'],)).fetchone()[0]
        e['requires_face_verification'] = True
        e['face_registered'] = bool(face_profile)
        e['recent_face_verification'] = bool(_recent_exam_face_verification(db, r['id'], uid))
        result.append(e)
    db.close()
    return jsonify({
        'server_time': datetime.now().isoformat(),
        'exams': result
    })


@exams_bp.route('/<int:eid>/verify-face', methods=['POST'])
@jwt_required()
def verify_exam_face(eid):
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    payload = request.json or {}
    live_capture = payload.get('live_capture')
    if not live_capture:
        return jsonify({'error': 'Live face capture is required.'}), 400

    db = get_db()
    exam = db.execute("SELECT id, is_active FROM exams WHERE id=?", (eid,)).fetchone()
    if not exam or not exam['is_active']:
        db.close()
        return jsonify({'error': 'Exam not found or not active'}), 404
    face_profile = _get_face_profile(db, uid)
    if not face_profile:
        db.close()
        return jsonify({'error': 'No verified face profile found. Complete registration face verification first.'}), 403

    try:
        reference_set = [deserialize_embedding(face_profile['embedding'])]
        reference_set.extend(deserialize_embedding_set(face_profile['angle_embeddings']))
        ref_thresh = float(face_profile['match_threshold'] or DEFAULT_THRESHOLD)
        adaptive = max(0.42, min(ref_thresh, DEFAULT_THRESHOLD + 0.12))
        result = verify_live_capture_against_set(
            reference_set,
            live_capture,
            threshold=adaptive,
        )
    except FaceVerificationError as exc:
        db.close()
        return jsonify({'error': str(exc)}), 400

    db.execute("""
        INSERT INTO exam_face_verifications (exam_id, user_id, status, score, threshold, engine)
        VALUES (?,?,?,?,?,?)
    """, (
        eid,
        uid,
        'approved' if result.verified else 'flagged',
        result.score,
        result.threshold,
        result.engine,
    ))
    db.execute("""
        UPDATE face_embeddings
        SET last_exam_score=?,
            last_exam_verified_at=CASE WHEN ? THEN DATETIME('now') ELSE last_exam_verified_at END,
            updated_at=DATETIME('now')
        WHERE user_id=?
    """, (result.score, 1 if result.verified else 0, uid))
    db.commit()
    db.close()
    status_code = 200 if result.verified else 403
    return jsonify({
        'verified': result.verified,
        'score': result.score,
        'threshold': result.threshold,
        'engine': result.engine,
        'message': 'Identity verified. You can start the exam now.' if result.verified else 'Face verification failed. Please try again with better lighting and camera alignment.'
    }), status_code

@exams_bp.route('/<int:eid>/start', methods=['POST'])
@jwt_required()
def start_exam(eid):
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    payload = request.json or {}
    preview_mode = bool(payload.get('preview'))
    db  = get_db()
    exam = db.execute("SELECT * FROM exams WHERE id=? AND is_active=1", (eid,)).fetchone()
    if not exam: db.close(); return jsonify({'error': 'Exam not found or not active'}), 404
    if not preview_mode:
        face_profile = _get_face_profile(db, uid)
        if not face_profile:
            db.close()
            return jsonify({'error': 'Face verification profile not found. Contact admin support.', 'code': 'face_profile_missing'}), 403
        recent_face_check = _recent_exam_face_verification(db, eid, uid)
        if not recent_face_check:
            db.close()
            return jsonify({
                'error': f'Complete facial verification before starting this exam. Approved checks stay valid for {EXAM_FACE_VERIFY_WINDOW_MINUTES} minutes.',
                'code': 'face_verification_required'
            }), 403
    sub = db.execute("SELECT * FROM exam_submissions WHERE exam_id=? AND user_id=?", (eid, uid)).fetchone()
    if sub and sub['submitted_at']: db.close(); return jsonify({'error': 'Already submitted'}), 409
    if not preview_mode:
        if not sub:
            db.execute("""
                INSERT INTO exam_submissions (exam_id, user_id, status, progress_count, last_activity_at)
                VALUES (?,?,?,?,DATETIME('now'))
            """, (eid, uid, 'in_progress', 0))
        else:
            db.execute("""
                UPDATE exam_submissions
                SET status='in_progress',
                    last_activity_at=DATETIME('now')
                WHERE exam_id=? AND user_id=?
            """, (eid, uid))
        db.commit()
    questions = db.execute("SELECT id,question,option_a,option_b,option_c,option_d FROM exam_questions WHERE exam_id=? ORDER BY order_num", (eid,)).fetchall()
    db.close()
    # Calculate server-based remaining seconds from open time
    scheduled = exam['scheduled_at']
    duration_secs = exam['duration_mins'] * 60
    try:
        scheduled_dt = datetime.strptime(scheduled, '%Y-%m-%dT%H:%M')
    except Exception:
        try:
            scheduled_dt = datetime.strptime(scheduled, '%Y-%m-%d %H:%M:%S')
        except Exception:
            scheduled_dt = datetime.now()
    elapsed_since_open = max(0, (datetime.now() - scheduled_dt).total_seconds())
    remaining_secs = max(0, duration_secs - int(elapsed_since_open))

    return jsonify({
        'exam':          _serialize_row(exam),
        'questions':     [_serialize_row(q) for q in questions],
        'server_time':   datetime.now().isoformat(),
        'remaining_secs': remaining_secs,
        'preview': preview_mode,
    })



@exams_bp.route('/<int:eid>/progress', methods=['POST'])
@jwt_required()
def update_exam_progress(eid):
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    payload = request.json or {}
    answers = payload.get('answers') or {}
    try:
        progress_count = int(payload.get('progress_count') or len(answers))
    except (TypeError, ValueError):
        progress_count = len(answers)
    db = get_db()
    sub = db.execute("SELECT id, submitted_at FROM exam_submissions WHERE exam_id=? AND user_id=?", (eid, uid)).fetchone()
    if not sub:
        db.close()
        return jsonify({'error': 'Exam not started'}), 400
    if sub['submitted_at']:
        db.close()
        return jsonify({'error': 'Exam already submitted'}), 409

    db.execute("""
        UPDATE exam_submissions
        SET answers=?,
            progress_count=?,
            status='in_progress',
            last_activity_at=DATETIME('now')
        WHERE exam_id=? AND user_id=?
    """, (json.dumps(answers), progress_count, eid, uid))
    db.commit()
    db.close()
    return jsonify({'message': 'Progress updated', 'progress_count': progress_count})

@exams_bp.route('/<int:eid>/submit', methods=['POST'])
@jwt_required()
def submit_exam(eid):
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    answers = (request.json or {}).get('answers', {})
    db      = get_db()
    exam = db.execute("SELECT id, results_released, passing_score FROM exams WHERE id=?", (eid,)).fetchone()
    if not exam:
        db.close()
        return jsonify({'error': 'Exam not found'}), 404
    sub = db.execute("SELECT * FROM exam_submissions WHERE exam_id=? AND user_id=?", (eid, uid)).fetchone()
    if not sub: db.close(); return jsonify({'error': 'Exam not started'}), 400
    if sub['submitted_at']: db.close(); return jsonify({'error': 'Already submitted'}), 409

    questions = db.execute("SELECT id, correct_idx FROM exam_questions WHERE exam_id=?", (eid,)).fetchall()
    correct = sum(1 for q in questions if str(answers.get(str(q['id']))) == str(q['correct_idx']))
    total   = len(questions)
    score   = round((correct / total * 100) if total else 0, 1)
    try:
        passing_mark = float(exam['passing_score'] if exam['passing_score'] is not None else 60)
    except (TypeError, ValueError):
        passing_mark = 60.0
    passed_flag = 1 if score >= passing_mark else 0

    db.execute("""
        UPDATE exam_submissions
        SET answers=?,
            score=?,
            progress_count=?,
            status='submitted',
            submitted_at=DATETIME('now'),
            last_activity_at=DATETIME('now'),
            review_status=CASE WHEN ? THEN 'approved' ELSE 'pending' END,
            passed=?
        WHERE exam_id=? AND user_id=?
    """, (json.dumps(answers), score, len(answers), 1 if exam['results_released'] else 0, passed_flag, eid, uid))
    db.commit(); db.close()
    return jsonify({
        'submitted': True,
        'pending_review': not bool(exam['results_released']),
        'message': 'Exam submitted successfully. Your result will remain hidden until the admin releases it.'
    })

@exams_bp.route('/<int:eid>/results', methods=['GET'])
@jwt_required()
def get_results(eid):
    uid = _exam_user_id()
    if uid is None:
        return jsonify({'error': 'Invalid session'}), 401
    db  = get_db()
    exam = db.execute("SELECT title, results_released, passing_score FROM exams WHERE id=?", (eid,)).fetchone()
    if not exam:
        db.close(); return jsonify({'error': 'Exam not found'}), 404
    if not exam['results_released']:
        db.close(); return jsonify({'error': 'Results have not been released yet. Please check back later.', 'pending': True}), 403
    row = db.execute(
        "SELECT score, submitted_at, review_status, passed FROM exam_submissions WHERE exam_id=? AND user_id=?",
        (eid, uid)
    ).fetchone()
    db.close()
    if not row: return jsonify({'error': 'Not submitted'}), 404
    try:
        passing_mark = float(exam['passing_score'] if exam['passing_score'] is not None else 60)
    except (TypeError, ValueError):
        passing_mark = 60.0
    out = _serialize_row(row)
    out['passing_score'] = passing_mark
    pv = out.get('passed')
    out['passed'] = bool(pv) if pv is not None else (float(out.get('score') or 0) >= passing_mark)
    return jsonify(out)
