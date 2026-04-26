"""EPSA Teacher Blueprint — Question Bank & Teacher Portal"""
import csv
import io
import json
import re
import secrets
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.security import generate_password_hash

try:
    from .models import get_db
except ImportError:
    from models import get_db

teacher_bp = Blueprint("teacher", __name__)

PSYCHOLOGY_CATEGORIES = [
    "Social Psychology",
    "Developmental Psychology",
    "Clinical Psychology",
    "Counseling Psychology",
    "Cognitive Psychology",
    "Biological Psychology",
    "Personality Psychology",
    "Health Psychology",
    "Educational Psychology",
    "Industrial/Organizational Psychology",
    "Sport Psychology",
    "Forensic Psychology",
    "Neuropsychology",
    "Positive Psychology",
    "Cross-Cultural Psychology",
    "Research Methods & Statistics",
    "History & Systems of Psychology",
    "Abnormal Psychology",
    "Community Psychology",
    "General Psychology",
]

BLOOM_LEVELS = [
    "Remembering",
    "Understanding",
    "Applying",
    "Analyzing",
    "Evaluating",
    "Creating",
]

DIFFICULTY_LEVELS = ["easy", "medium", "hard"]


def _require_teacher(db, uid):
    """Return teacher row or raise ValueError."""
    row = db.execute(
        "SELECT * FROM users WHERE id=? AND role='teacher'", (uid,)
    ).fetchone()
    if not row:
        raise ValueError("Teacher account required.")
    if row["status"] != "approved":
        if row["status"] == "pending":
            raise ValueError("Teacher application is still pending admin approval.")
        if row["status"] == "rejected":
            raise ValueError("Teacher application was rejected.")
        raise ValueError("Teacher account is not active.")
    return row


def _require_admin(db, uid):
    row = db.execute(
        "SELECT role FROM users WHERE id=?", (uid,)
    ).fetchone()
    if not row or row["role"] not in ("admin", "super_admin"):
        raise ValueError("Admin access required.")


def _send_teacher_status_email(teacher_row, status, rejection_reason=""):
    if not teacher_row or not teacher_row.get("email"):
        return
    from email_service import send_email

    teacher_name = (
        f"{teacher_row.get('first_name', '')} {teacher_row.get('father_name', '')}".strip()
        or teacher_row.get("email", "Teacher")
    )
    if status == "approved":
        send_email(
            teacher_row["email"],
            "EPSA Teacher Application Approved",
            f"""
            <html><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.7;background:#f6fbf8;padding:20px;">
              <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #d1fae5;border-radius:18px;overflow:hidden;">
                <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#0f3d23,#1a6b3c);color:#f0fdf4;">
                  <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.72;">EPSA Teacher Portal</div>
                  <h2 style="margin:10px 0 0;font-size:28px;line-height:1.2;">Application Approved</h2>
                </div>
                <div style="padding:28px;">
                  <p>Hello <strong>{teacher_name}</strong>,</p>
                  <p>Your EPSA teacher application has been <strong style="color:#15803d;">approved</strong>. You can now sign in to the teacher portal using the same email and password you used during registration.</p>
                  <div style="margin:22px 0;padding:18px;border-radius:14px;background:#f0fdf4;border:1px solid #bbf7d0;">
                    <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin-bottom:10px;">Login Details</div>
                    <div style="margin-bottom:8px;"><strong>Email:</strong> {teacher_row["email"]}</div>
                    <div><strong>Password:</strong> The password you created during teacher registration</div>
                  </div>
                  <p>Once you log in, you can submit questions, manage your question drafts, and track review status from the portal.</p>
                  <p style="margin-top:24px;color:#4b5563;">Thank you for contributing to EPSA's national psychology question bank.</p>
                </div>
              </div>
            </body></html>
            """,
        )
        return

    send_email(
        teacher_row["email"],
        "EPSA Teacher Application Update",
        f"""
        <html><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.7;background:#fff7f7;padding:20px;">
          <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #fecaca;border-radius:18px;overflow:hidden;">
            <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:#fef2f2;">
              <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.72;">EPSA Teacher Portal</div>
              <h2 style="margin:10px 0 0;font-size:28px;line-height:1.2;">Application Update</h2>
            </div>
            <div style="padding:28px;">
              <p>Hello <strong>{teacher_name}</strong>,</p>
              <p>Your EPSA teacher application was not approved at this time.</p>
              <div style="margin:22px 0;padding:18px;border-radius:14px;background:#fef2f2;border:1px solid #fecaca;">
                <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#991b1b;margin-bottom:10px;">Review Note</div>
                <div>{rejection_reason or "Please contact the EPSA admin team for more details about the decision."}</div>
              </div>
              <p>You can contact the EPSA administration team if you need clarification or want to reapply with updated information.</p>
            </div>
          </div>
        </body></html>
        """,
    )


# ── Public categories ──────────────────────────────────────────────────────────

@teacher_bp.route("/categories", methods=["GET"])
def get_categories():
    return jsonify({
        "categories": PSYCHOLOGY_CATEGORIES,
        "bloom_levels": BLOOM_LEVELS,
        "difficulty_levels": DIFFICULTY_LEVELS,
    })


# ── Teacher registration ───────────────────────────────────────────────────────

@teacher_bp.route("/register", methods=["POST"])
def teacher_register():
    data = request.json or {}
    required = ["full_name", "email", "password", "specialization", "institution"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    email = data["email"].strip().lower()
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return jsonify({"error": "Enter a valid email address"}), 400

    password = data["password"]
    if len(password) < 8 or not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"\d", password):
        return jsonify({"error": "Password must be 8+ chars with uppercase, lowercase, and a number"}), 400

    full_name_parts = data["full_name"].strip().split()
    first_name = full_name_parts[0] if full_name_parts else data["full_name"]
    father_name = " ".join(full_name_parts[1:]) if len(full_name_parts) > 1 else "."

    db = get_db()
    try:
        if db.execute("SELECT id FROM users WHERE LOWER(email)=?", (email,)).fetchone():
            return jsonify({"error": "Email already registered"}), 409

        # Generate unique username
        base = re.sub(r"[^a-z0-9]", "", first_name.lower()) or "teacher"
        for _ in range(20):
            username = f"{base}{secrets.randbelow(9000) + 1000}"
            if not db.execute("SELECT id FROM users WHERE LOWER(username)=?", (username,)).fetchone():
                break

        db.execute(
            """
            INSERT INTO users (
                username, password_hash, first_name, father_name, grandfather_name,
                email, role, status, specialization, institution,
                years_of_experience, credentials
            ) VALUES (?,?,?,?,?,?, 'teacher', 'pending',?,?,?,?)
            """,
            (
                username,
                generate_password_hash(password),
                first_name, father_name, ".",
                email,
                data["specialization"],
                data["institution"],
                int(data.get("years_of_experience", 0) or 0),
                data.get("credentials", ""),
            ),
        )
        db.commit()
    finally:
        db.close()

    return jsonify({
        "message": "Teacher application submitted. Admin will review and approve within 24–48 hours.",
        "status": "pending",
    }), 201


# ── Teacher: my stats dashboard ────────────────────────────────────────────────

@teacher_bp.route("/stats", methods=["GET"])
@jwt_required()
def teacher_stats():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_teacher(db, uid)
        row = db.execute(
            """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
            FROM question_bank WHERE submitted_by=?
            """, (uid,)
        ).fetchone()
        cats = db.execute(
            "SELECT subject_category, COUNT(*) as cnt FROM question_bank WHERE submitted_by=? AND status='approved' GROUP BY subject_category ORDER BY cnt DESC LIMIT 8",
            (uid,)
        ).fetchall()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403
    finally:
        db.close()

    return jsonify({
        "total": row["total"] or 0,
        "pending": row["pending"] or 0,
        "approved": row["approved"] or 0,
        "rejected": row["rejected"] or 0,
        "top_categories": [{"category": c["subject_category"], "count": c["cnt"]} for c in cats],
    })


# ── Teacher: list my questions ─────────────────────────────────────────────────

@teacher_bp.route("/questions", methods=["GET"])
@jwt_required()
def get_my_questions():
    uid = get_jwt_identity()
    status_filter = request.args.get("status", "all")
    category_filter = request.args.get("category", "")
    page = max(1, int(request.args.get("page", 1)))
    per_page = 20
    offset = (page - 1) * per_page

    db = get_db()
    try:
        _require_teacher(db, uid)
        clauses = ["submitted_by=?"]
        params = [uid]
        if status_filter != "all":
            clauses.append("status=?")
            params.append(status_filter)
        if category_filter:
            clauses.append("subject_category=?")
            params.append(category_filter)
        where = " AND ".join(clauses)
        total = db.execute(f"SELECT COUNT(*) FROM question_bank WHERE {where}", params).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM question_bank WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [per_page, offset]
        ).fetchall()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403
    finally:
        db.close()

    return jsonify({
        "questions": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


# ── Teacher: submit a single question ─────────────────────────────────────────

@teacher_bp.route("/questions", methods=["POST"])
@jwt_required()
def submit_question():
    uid = get_jwt_identity()
    data = request.json or {}
    required = ["subject_category", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_idx"]
    for field in required:
        if data.get(field) in (None, ""):
            return jsonify({"error": f"{field} is required"}), 400

    if data["subject_category"] not in PSYCHOLOGY_CATEGORIES:
        return jsonify({"error": "Invalid subject category"}), 400
    if data.get("bloom_level") and data["bloom_level"] not in BLOOM_LEVELS:
        return jsonify({"error": "Invalid Bloom's level"}), 400
    if data.get("difficulty") and data["difficulty"] not in DIFFICULTY_LEVELS:
        return jsonify({"error": "Invalid difficulty level"}), 400
    try:
        correct_idx = int(data["correct_idx"])
        if correct_idx not in (0, 1, 2, 3):
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "correct_idx must be 0, 1, 2, or 3"}), 400

    db = get_db()
    try:
        _require_teacher(db, uid)
        # Duplicate detection: same question text from same teacher
        existing = db.execute(
            "SELECT id FROM question_bank WHERE submitted_by=? AND LOWER(question_text)=LOWER(?)",
            (uid, data["question_text"].strip())
        ).fetchone()
        if existing:
            return jsonify({"error": "A question with identical text already exists in your submissions"}), 409

        cur = db.execute(
            """
            INSERT INTO question_bank (
                submitted_by, subject_category, topic, subtopic, bloom_level, difficulty,
                question_text, option_a, option_b, option_c, option_d, correct_idx, explanation
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                uid,
                data["subject_category"],
                data.get("topic", ""),
                data.get("subtopic", ""),
                data.get("bloom_level", "Remembering"),
                data.get("difficulty", "medium"),
                data["question_text"].strip(),
                data["option_a"].strip(),
                data["option_b"].strip(),
                data["option_c"].strip(),
                data["option_d"].strip(),
                correct_idx,
                data.get("explanation", "").strip(),
            ),
        )
        db.commit()
        qid = cur.lastrowid
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403
    finally:
        db.close()

    return jsonify({"message": "Question submitted for review", "id": qid}), 201


# ── Teacher: bulk CSV upload ───────────────────────────────────────────────────

@teacher_bp.route("/questions/bulk", methods=["POST"])
@jwt_required()
def bulk_submit_questions():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_teacher(db, uid)
    except ValueError as e:
        db.close()
        return jsonify({"error": str(e)}), 403

    data = request.json or {}
    questions = data.get("questions", [])
    if not questions or not isinstance(questions, list):
        db.close()
        return jsonify({"error": "Expected a list of questions"}), 400

    inserted = 0
    skipped = 0
    errors = []

    try:
        for i, q in enumerate(questions[:500]):   # max 500 per batch
            row_num = i + 1
            try:
                required = ["subject_category", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_idx"]
                for field in required:
                    if not q.get(field):
                        raise ValueError(f"Missing {field}")
                if q["subject_category"] not in PSYCHOLOGY_CATEGORIES:
                    raise ValueError(f"Invalid category: {q['subject_category']}")
                correct_idx = int(q["correct_idx"])
                if correct_idx not in (0, 1, 2, 3):
                    raise ValueError("correct_idx must be 0–3")
                existing = db.execute(
                    "SELECT id FROM question_bank WHERE submitted_by=? AND LOWER(question_text)=LOWER(?)",
                    (uid, q["question_text"].strip())
                ).fetchone()
                if existing:
                    skipped += 1
                    continue
                db.execute(
                    """
                    INSERT INTO question_bank (
                        submitted_by, subject_category, topic, subtopic, bloom_level, difficulty,
                        question_text, option_a, option_b, option_c, option_d, correct_idx, explanation
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        uid,
                        q["subject_category"],
                        q.get("topic", ""),
                        q.get("subtopic", ""),
                        q.get("bloom_level", "Remembering"),
                        q.get("difficulty", "medium"),
                        q["question_text"].strip(),
                        q["option_a"].strip(),
                        q["option_b"].strip(),
                        q["option_c"].strip(),
                        q["option_d"].strip(),
                        correct_idx,
                        q.get("explanation", "").strip(),
                    ),
                )
                inserted += 1
            except Exception as exc:
                errors.append(f"Row {row_num}: {exc}")

        db.commit()
    finally:
        db.close()

    return jsonify({
        "message": f"Bulk upload complete: {inserted} inserted, {skipped} duplicates skipped, {len(errors)} errors.",
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20],
    })


# ── Admin: list all questions ──────────────────────────────────────────────────

@teacher_bp.route("/admin/questions", methods=["GET"])
@jwt_required()
def admin_list_questions():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        status_filter = request.args.get("status", "pending")
        category_filter = request.args.get("category", "")
        page = max(1, int(request.args.get("page", 1)))
        per_page = 25
        offset = (page - 1) * per_page

        clauses = []
        params = []
        if status_filter != "all":
            clauses.append("q.status=?")
            params.append(status_filter)
        if category_filter:
            clauses.append("q.subject_category=?")
            params.append(category_filter)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        total = db.execute(f"SELECT COUNT(*) FROM question_bank q {where}", params).fetchone()[0]
        rows = db.execute(
            f"""
            SELECT q.*, u.first_name||' '||u.father_name as teacher_name, u.specialization
            FROM question_bank q
            JOIN users u ON u.id = q.submitted_by
            {where}
            ORDER BY q.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [per_page, offset]
        ).fetchall()

        stats = db.execute(
            """SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
               FROM question_bank"""
        ).fetchone()
    finally:
        db.close()

    return jsonify({
        "questions": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
        "stats": {
            "total": stats["total"] or 0,
            "pending": stats["pending"] or 0,
            "approved": stats["approved"] or 0,
            "rejected": stats["rejected"] or 0,
        },
    })


@teacher_bp.route("/admin/questions/<int:qid>/approve", methods=["POST"])
@jwt_required()
def admin_approve_question(qid):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        db.execute(
            "UPDATE question_bank SET status='approved', reviewed_by=?, reviewed_at=DATETIME('now'), updated_at=DATETIME('now') WHERE id=?",
            (uid, qid)
        )
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Question approved"})


@teacher_bp.route("/admin/questions/<int:qid>/reject", methods=["POST"])
@jwt_required()
def admin_reject_question(qid):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        _require_admin(db, uid)
        db.execute(
            "UPDATE question_bank SET status='rejected', admin_notes=?, reviewed_by=?, reviewed_at=DATETIME('now'), updated_at=DATETIME('now') WHERE id=?",
            (data.get("notes", ""), uid, qid)
        )
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Question rejected"})


@teacher_bp.route("/admin/questions/<int:qid>", methods=["PUT"])
@jwt_required()
def admin_edit_question(qid):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        _require_admin(db, uid)
        fields = ["subject_category", "topic", "subtopic", "bloom_level", "difficulty",
                  "question_text", "option_a", "option_b", "option_c", "option_d", "correct_idx", "explanation"]
        updates = {k: data[k] for k in fields if k in data}
        if not updates:
            return jsonify({"error": "No fields to update"}), 400
        set_clause = ", ".join(f"{k}=?" for k in updates)
        db.execute(
            f"UPDATE question_bank SET {set_clause}, updated_at=DATETIME('now') WHERE id=?",
            list(updates.values()) + [qid]
        )
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Question updated"})


@teacher_bp.route("/admin/teachers", methods=["GET"])
@jwt_required()
def admin_list_teachers():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        status_filter = request.args.get("status", "all")
        clause = "WHERE u.role='teacher'"
        params = []
        if status_filter != "all":
            clause += " AND u.status=?"
            params.append(status_filter)
        rows = db.execute(
            f"""
            SELECT u.id, u.username, u.first_name||' '||u.father_name as name,
                   u.email, u.specialization, u.institution, u.years_of_experience,
                   u.credentials, u.status, u.rejection_reason, u.created_at,
                   COUNT(q.id) as question_count,
                   SUM(CASE WHEN q.status='approved' THEN 1 ELSE 0 END) as approved_count
            FROM users u
            LEFT JOIN question_bank q ON q.submitted_by = u.id
            {clause}
            GROUP BY u.id
            ORDER BY u.created_at DESC
            """,
            params
        ).fetchall()
    finally:
        db.close()
    return jsonify({"teachers": [dict(r) for r in rows]})


@teacher_bp.route("/admin/teachers/<int:tid>/approve", methods=["POST"])
@jwt_required()
def admin_approve_teacher(tid):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        teacher_row = db.execute(
            """
            SELECT id, first_name, father_name, email
            FROM users
            WHERE id=? AND role='teacher'
            """,
            (tid,),
        ).fetchone()
        if not teacher_row:
            return jsonify({"error": "Teacher not found"}), 404
        db.execute(
            """
            UPDATE users
            SET status='approved', approved_at=DATETIME('now'), rejection_reason=NULL
            WHERE id=? AND role='teacher'
            """,
            (tid,),
        )
        db.commit()
    finally:
        db.close()
    _send_teacher_status_email(dict(teacher_row), "approved")
    return jsonify({"message": "Teacher approved"})


@teacher_bp.route("/admin/teachers/<int:tid>/reject", methods=["POST"])
@jwt_required()
def admin_reject_teacher(tid):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        _require_admin(db, uid)
        teacher_row = db.execute(
            """
            SELECT id, first_name, father_name, email
            FROM users
            WHERE id=? AND role='teacher'
            """,
            (tid,),
        ).fetchone()
        if not teacher_row:
            return jsonify({"error": "Teacher not found"}), 404
        db.execute(
            "UPDATE users SET status='rejected', approved_at=NULL, rejection_reason=? WHERE id=? AND role='teacher'",
            (data.get("reason", ""), tid)
        )
        db.commit()
    finally:
        db.close()
    _send_teacher_status_email(dict(teacher_row), "rejected", data.get("reason", ""))
    return jsonify({"message": "Teacher rejected"})
