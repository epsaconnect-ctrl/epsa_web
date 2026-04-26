"""EPSA Mock Exam System — Adaptive Question Bank Exams"""
import json
import math
import random
import secrets
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

try:
    from .models import get_db
except ImportError:
    from models import get_db

mock_exams_bp = Blueprint("mock_exams", __name__)

PSYCHOLOGY_CATEGORIES = [
    "Social Psychology", "Developmental Psychology", "Clinical Psychology",
    "Counseling Psychology", "Cognitive Psychology", "Biological Psychology",
    "Personality Psychology", "Health Psychology", "Educational Psychology",
    "Industrial/Organizational Psychology", "Sport Psychology", "Forensic Psychology",
    "Neuropsychology", "Positive Psychology", "Cross-Cultural Psychology",
    "Research Methods & Statistics", "History & Systems of Psychology",
    "Abnormal Psychology", "Community Psychology", "General Psychology",
]


def _require_admin(db, uid):
    row = db.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
    if not row or row["role"] not in ("admin", "super_admin"):
        raise ValueError("Admin access required.")


def _now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_blueprint(blueprint_json, total_count):
    """Parse blueprint JSON into a list of {category, count} dicts."""
    if not blueprint_json:
        return [{"category": None, "count": total_count}]
    try:
        bp = json.loads(blueprint_json) if isinstance(blueprint_json, str) else blueprint_json
        if isinstance(bp, list):
            return bp
    except Exception:
        pass
    return [{"category": None, "count": total_count}]


def _draw_questions(db, blueprint, total_count):
    """Draw questions from approved question_bank according to blueprint."""
    selected_ids = []
    used_categories = {}

    for slot in blueprint:
        category = slot.get("category")
        count = int(slot.get("count", 0))
        bloom_levels = slot.get("bloom_levels", [])

        clauses = ["status='approved'"]
        params = []

        if category:
            clauses.append("subject_category=?")
            params.append(category)

        if bloom_levels:
            placeholders = ",".join("?" * len(bloom_levels))
            clauses.append(f"bloom_level IN ({placeholders})")
            params.extend(bloom_levels)

        if selected_ids:
            placeholders = ",".join("?" * len(selected_ids))
            clauses.append(f"id NOT IN ({placeholders})")
            params.extend(selected_ids)

        where = " AND ".join(clauses)
        rows = db.execute(
            f"SELECT id FROM question_bank WHERE {where} ORDER BY RANDOM() LIMIT ?",
            params + [count]
        ).fetchall()
        selected_ids.extend([r["id"] for r in rows])

    # If still short of total_count, fill with any remaining approved questions
    if len(selected_ids) < total_count:
        existing = ",".join("?" * len(selected_ids)) if selected_ids else "0"
        extras = db.execute(
            f"SELECT id FROM question_bank WHERE status='approved' AND id NOT IN ({existing}) ORDER BY RANDOM() LIMIT ?",
            (selected_ids or []) + [total_count - len(selected_ids)]
        ).fetchall()
        selected_ids.extend([r["id"] for r in extras])

    random.shuffle(selected_ids)
    return selected_ids[:total_count]


def _randomize_options(question_ids, db):
    """Return per-student shuffled option orders for each question."""
    option_order = {}
    for qid in question_ids:
        perm = [0, 1, 2, 3]
        random.shuffle(perm)
        option_order[str(qid)] = perm
    return option_order


# ── Public / Student Endpoints ────────────────────────────────────────────────

@mock_exams_bp.route("/", methods=["GET"])
@jwt_required()
def list_mock_exams():
    uid = get_jwt_identity()
    db = get_db()
    try:
        now = _now_utc()
        exams = db.execute(
            """
            SELECT me.*,
                   ms.status as my_status,
                   ms.score as my_score,
                   ms.submitted_at as my_submitted_at,
                   ms.started_at as my_started_at
            FROM mock_exams me
            LEFT JOIN mock_exam_submissions ms ON ms.exam_id=me.id AND ms.user_id=?
            WHERE me.is_active=1 OR me.scheduled_at > DATETIME('now')
            ORDER BY me.scheduled_at ASC
            """,
            (uid,)
        ).fetchall()
    finally:
        db.close()

    result = []
    for e in exams:
        row = dict(e)
        scheduled = None
        ends = None
        try:
            if row["scheduled_at"]:
                scheduled = datetime.fromisoformat(str(row["scheduled_at"]))
            if row["ends_at"]:
                ends = datetime.fromisoformat(str(row["ends_at"]))
        except Exception:
            pass

        now_naive = _now_utc()
        is_open = (row["is_active"] == 1 and
                   (scheduled is None or scheduled <= now_naive) and
                   (ends is None or ends > now_naive))
        row["is_open"] = is_open
        row["can_start"] = is_open and not row["my_status"]
        row["can_continue"] = is_open and row["my_status"] == "in_progress"
        row["is_submitted"] = row["my_status"] in ("submitted", "auto_submitted")
        row["results_viewable"] = row["is_submitted"] and row["results_released"] == 1
        result.append(row)

    return jsonify({"exams": result})


@mock_exams_bp.route("/<int:exam_id>/start", methods=["POST"])
@jwt_required()
def start_mock_exam(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        exam = db.execute("SELECT * FROM mock_exams WHERE id=?", (exam_id,)).fetchone()
        if not exam:
            return jsonify({"error": "Exam not found"}), 404
        if not exam["is_active"]:
            return jsonify({"error": "This exam is not currently open"}), 403

        # Check time window
        now = _now_utc()
        if exam["ends_at"]:
            try:
                ends = datetime.fromisoformat(str(exam["ends_at"]))
                if now > ends:
                    return jsonify({"error": "Exam window has closed"}), 403
            except Exception:
                pass

        # Check if already started
        existing = db.execute(
            "SELECT * FROM mock_exam_submissions WHERE exam_id=? AND user_id=?",
            (exam_id, uid)
        ).fetchone()

        if existing and existing["status"] in ("submitted", "auto_submitted"):
            return jsonify({"error": "You have already submitted this exam"}), 409

        if existing:
            # Resume: return existing question set
            qids = json.loads(existing["question_ids"])
            opt_order = json.loads(existing["option_order"] or "{}")
            questions = _load_questions_for_student(db, qids, opt_order)
            elapsed_secs = (now - datetime.fromisoformat(str(existing["started_at"]))).total_seconds()
            return jsonify({
                "submission_id": existing["id"],
                "questions": questions,
                "total": len(qids),
                "duration_mins": exam["duration_mins"],
                "elapsed_secs": int(elapsed_secs),
                "answers": json.loads(existing["answers"] or "{}"),
                "resuming": True,
            })

        # Draw questions
        blueprint = _parse_blueprint(exam["blueprint"], exam["question_count"])
        question_ids = _draw_questions(db, blueprint, exam["question_count"])

        if not question_ids:
            return jsonify({"error": "Not enough approved questions in the bank to generate this exam"}), 500

        option_order = _randomize_options(question_ids, db)

        cur = db.execute(
            """
            INSERT INTO mock_exam_submissions
                (exam_id, user_id, question_ids, option_order, answers, time_per_question, total_questions, status, started_at)
            VALUES (?,?,?,?,?,?,?,?,DATETIME('now'))
            """,
            (
                exam_id, uid,
                json.dumps(question_ids),
                json.dumps(option_order),
                "{}",
                "{}",
                len(question_ids),
                "in_progress",
            )
        )
        db.commit()
        sub_id = cur.lastrowid
        questions = _load_questions_for_student(db, question_ids, option_order)
    finally:
        db.close()

    return jsonify({
        "submission_id": sub_id,
        "questions": questions,
        "total": len(question_ids),
        "duration_mins": exam["duration_mins"],
        "elapsed_secs": 0,
        "answers": {},
        "resuming": False,
    })


def _load_questions_for_student(db, qids, opt_order):
    """Load questions and shuffle options per student's permutation."""
    if not qids:
        return []
    placeholders = ",".join("?" * len(qids))
    rows = db.execute(
        f"SELECT id, question_text, option_a, option_b, option_c, option_d FROM question_bank WHERE id IN ({placeholders})",
        qids
    ).fetchall()
    row_map = {r["id"]: r for r in rows}

    result = []
    for qid in qids:
        r = row_map.get(qid)
        if not r:
            continue
        options_raw = [r["option_a"], r["option_b"], r["option_c"], r["option_d"]]
        perm = opt_order.get(str(qid), [0, 1, 2, 3])
        shuffled_options = [options_raw[i] for i in perm]
        result.append({
            "id": qid,
            "question_text": r["question_text"],
            "options": shuffled_options,
            "option_order": perm,
        })
    return result


@mock_exams_bp.route("/<int:exam_id>/progress", methods=["POST"])
@jwt_required()
def save_progress(exam_id):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        sub = db.execute(
            "SELECT * FROM mock_exam_submissions WHERE exam_id=? AND user_id=?",
            (exam_id, uid)
        ).fetchone()
        if not sub or sub["status"] in ("submitted", "auto_submitted"):
            return jsonify({"error": "No active submission found"}), 404

        # Merge answers
        current_answers = json.loads(sub["answers"] or "{}")
        current_times = json.loads(sub["time_per_question"] or "{}")

        new_answers = data.get("answers", {})
        new_times = data.get("time_per_question", {})

        current_answers.update({str(k): v for k, v in new_answers.items()})
        current_times.update({str(k): v for k, v in new_times.items()})

        db.execute(
            "UPDATE mock_exam_submissions SET answers=?, time_per_question=? WHERE id=?",
            (json.dumps(current_answers), json.dumps(current_times), sub["id"])
        )
        db.commit()
    finally:
        db.close()

    return jsonify({"saved": True})


@mock_exams_bp.route("/<int:exam_id>/submit", methods=["POST"])
@jwt_required()
def submit_mock_exam(exam_id):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        sub = db.execute(
            "SELECT * FROM mock_exam_submissions WHERE exam_id=? AND user_id=?",
            (exam_id, uid)
        ).fetchone()
        if not sub:
            return jsonify({"error": "Submission not found"}), 404
        if sub["status"] in ("submitted", "auto_submitted"):
            return jsonify({"message": "Already submitted", "score": sub["score"]}), 200

        # Merge final answers
        current_answers = json.loads(sub["answers"] or "{}")
        new_answers = data.get("answers", {})
        current_answers.update({str(k): v for k, v in new_answers.items()})

        current_times = json.loads(sub["time_per_question"] or "{}")
        new_times = data.get("time_per_question", {})
        current_times.update({str(k): v for k, v in new_times.items()})

        # Score the submission
        qids = json.loads(sub["question_ids"])
        opt_order = json.loads(sub["option_order"] or "{}")

        placeholders = ",".join("?" * len(qids))
        questions = db.execute(
            f"SELECT id, correct_idx FROM question_bank WHERE id IN ({placeholders})",
            qids
        ).fetchall()

        correct = 0
        for q in questions:
            qid_str = str(q["id"])
            student_answer = current_answers.get(qid_str)
            if student_answer is None:
                continue
            # Remap student answer through option permutation to get original index
            perm = opt_order.get(qid_str, [0, 1, 2, 3])
            try:
                original_idx = perm[int(student_answer)]
            except (IndexError, ValueError, TypeError):
                continue
            if original_idx == q["correct_idx"]:
                correct += 1

        score = round((correct / len(qids)) * 100, 2) if qids else 0
        auto = data.get("auto_submit", False)
        status = "auto_submitted" if auto else "submitted"

        db.execute(
            """
            UPDATE mock_exam_submissions
            SET answers=?, time_per_question=?, score=?, status=?, submitted_at=DATETIME('now')
            WHERE id=?
            """,
            (json.dumps(current_answers), json.dumps(current_times), score, status, sub["id"])
        )
        db.commit()

        # Trigger async analytics update (lightweight; runs inline)
        _update_question_analytics(db, exam_id, qids, current_answers, opt_order, sub["id"])
        db.commit()
    finally:
        db.close()

    return jsonify({
        "score": score,
        "correct": correct,
        "total": len(qids),
        "status": status,
        "message": "Exam submitted successfully",
    })


def _update_question_analytics(db, exam_id, qids, answers, opt_order, sub_id):
    """Update per-question analytics after a submission is scored."""
    placeholders = ",".join("?" * len(qids))
    questions = db.execute(
        f"SELECT id, correct_idx, difficulty FROM question_bank WHERE id IN ({placeholders})",
        qids
    ).fetchall()

    for q in questions:
        qid = q["id"]
        qid_str = str(qid)
        student_answer = answers.get(qid_str)

        was_correct = 0
        if student_answer is not None:
            perm = opt_order.get(qid_str, [0, 1, 2, 3])
            try:
                original_idx = perm[int(student_answer)]
                was_correct = 1 if original_idx == q["correct_idx"] else 0
            except (IndexError, ValueError, TypeError):
                pass

        existing = db.execute(
            "SELECT * FROM question_analytics WHERE question_id=? AND mock_exam_id=?",
            (qid, exam_id)
        ).fetchone()

        if existing:
            new_presented = existing["times_presented"] + 1
            new_correct = existing["times_correct"] + was_correct
            new_rate = round(new_correct / new_presented, 4)
            db.execute(
                """
                UPDATE question_analytics
                SET times_presented=?, times_correct=?, correctness_rate=?, updated_at=DATETIME('now')
                WHERE question_id=? AND mock_exam_id=?
                """,
                (new_presented, new_correct, new_rate, qid, exam_id)
            )
            # Auto-reclassify difficulty
            if new_presented >= 10:
                auto_diff = "easy" if new_rate >= 0.70 else ("hard" if new_rate <= 0.40 else "medium")
                db.execute(
                    "UPDATE question_bank SET difficulty_auto=? WHERE id=?",
                    (auto_diff, qid)
                )
        else:
            db.execute(
                """
                INSERT INTO question_analytics (question_id, mock_exam_id, times_presented, times_correct, correctness_rate, updated_at)
                VALUES (?,?,?,?,?,DATETIME('now'))
                """,
                (qid, exam_id, 1, was_correct, float(was_correct))
            )


@mock_exams_bp.route("/<int:exam_id>/results", methods=["GET"])
@jwt_required()
def get_my_results(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        exam = db.execute("SELECT * FROM mock_exams WHERE id=?", (exam_id,)).fetchone()
        if not exam:
            return jsonify({"error": "Exam not found"}), 404

        sub = db.execute(
            "SELECT * FROM mock_exam_submissions WHERE exam_id=? AND user_id=?",
            (exam_id, uid)
        ).fetchone()
        if not sub:
            return jsonify({"error": "No submission found"}), 404

        if not exam["results_released"] and sub["status"] not in ("submitted", "auto_submitted"):
            return jsonify({"error": "Results not yet released"}), 403

        qids = json.loads(sub["question_ids"])
        opt_order = json.loads(sub["option_order"] or "{}")
        answers = json.loads(sub["answers"] or "{}")
        times = json.loads(sub["time_per_question"] or "{}")

        placeholders = ",".join("?" * len(qids))
        questions = db.execute(
            f"SELECT id, question_text, option_a, option_b, option_c, option_d, correct_idx, subject_category, bloom_level, explanation FROM question_bank WHERE id IN ({placeholders})",
            qids
        ).fetchall()
        q_map = {q["id"]: q for q in questions}

        breakdown = []
        for qid in qids:
            q = q_map.get(qid)
            if not q:
                continue
            qid_str = str(qid)
            student_choice = answers.get(qid_str)
            perm = opt_order.get(qid_str, [0, 1, 2, 3])
            original_correct_idx = q["correct_idx"]
            # Map correct_idx back to shuffled position for display
            try:
                display_correct_idx = perm.index(original_correct_idx)
            except ValueError:
                display_correct_idx = original_correct_idx

            was_correct = False
            if student_choice is not None:
                try:
                    original_idx = perm[int(student_choice)]
                    was_correct = original_idx == original_correct_idx
                except (IndexError, ValueError, TypeError):
                    pass

            opts_raw = [q["option_a"], q["option_b"], q["option_c"], q["option_d"]]
            shuffled_opts = [opts_raw[i] for i in perm]

            breakdown.append({
                "id": qid,
                "question_text": q["question_text"],
                "options": shuffled_opts,
                "student_answer": int(student_choice) if student_choice is not None else None,
                "correct_answer": display_correct_idx,
                "correct": was_correct,
                "explanation": q["explanation"],
                "category": q["subject_category"],
                "bloom_level": q["bloom_level"],
                "time_spent": times.get(qid_str, 0),
            })
    finally:
        db.close()

    return jsonify({
        "exam_title": exam["title"],
        "score": sub["score"],
        "total": sub["total_questions"],
        "correct": sum(1 for b in breakdown if b["correct"]),
        "status": sub["status"],
        "submitted_at": sub["submitted_at"],
        "breakdown": breakdown,
    })


# ── Admin Endpoints ───────────────────────────────────────────────────────────

@mock_exams_bp.route("/admin", methods=["POST"])
@jwt_required()
def admin_create_exam():
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        _require_admin(db, uid)
        if not data.get("title"):
            return jsonify({"error": "Title is required"}), 400
        cur = db.execute(
            """
            INSERT INTO mock_exams (title, description, question_count, duration_mins,
                                    blueprint, scheduled_at, ends_at, is_active, created_by)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                data["title"],
                data.get("description", ""),
                int(data.get("question_count", 100)),
                int(data.get("duration_mins", 120)),
                json.dumps(data.get("blueprint", [])),
                data.get("scheduled_at"),
                data.get("ends_at"),
                int(data.get("is_active", 0)),
                uid,
            )
        )
        db.commit()
        eid = cur.lastrowid
    finally:
        db.close()
    return jsonify({"message": "Mock exam created", "id": eid}), 201


@mock_exams_bp.route("/admin/<int:exam_id>", methods=["PUT"])
@jwt_required()
def admin_update_exam(exam_id):
    uid = get_jwt_identity()
    data = request.json or {}
    db = get_db()
    try:
        _require_admin(db, uid)
        fields = ["title", "description", "question_count", "duration_mins",
                  "scheduled_at", "ends_at", "is_active", "results_released"]
        updates = {}
        for f in fields:
            if f in data:
                updates[f] = data[f]
        if "blueprint" in data:
            updates["blueprint"] = json.dumps(data["blueprint"])
        if not updates:
            return jsonify({"error": "Nothing to update"}), 400
        set_clause = ", ".join(f"{k}=?" for k in updates)
        db.execute(f"UPDATE mock_exams SET {set_clause} WHERE id=?", list(updates.values()) + [exam_id])
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Updated"})


@mock_exams_bp.route("/admin/<int:exam_id>/activate", methods=["POST"])
@jwt_required()
def admin_activate_exam(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        db.execute("UPDATE mock_exams SET is_active=1 WHERE id=?", (exam_id,))
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Exam activated"})


@mock_exams_bp.route("/admin/<int:exam_id>/release-results", methods=["POST"])
@jwt_required()
def admin_release_results(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        db.execute("UPDATE mock_exams SET results_released=1, is_active=0 WHERE id=?", (exam_id,))
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Results released"})


@mock_exams_bp.route("/admin", methods=["GET"])
@jwt_required()
def admin_list_exams():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        exams = db.execute(
            """
            SELECT me.*,
                   COUNT(ms.id) as submission_count,
                   AVG(ms.score) as avg_score
            FROM mock_exams me
            LEFT JOIN mock_exam_submissions ms ON ms.exam_id=me.id AND ms.status IN ('submitted','auto_submitted')
            GROUP BY me.id
            ORDER BY me.created_at DESC
            """
        ).fetchall()
    finally:
        db.close()
    return jsonify({"exams": [dict(e) for e in exams]})


@mock_exams_bp.route("/admin/<int:exam_id>/report", methods=["GET"])
@jwt_required()
def admin_exam_report(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        exam = db.execute("SELECT * FROM mock_exams WHERE id=?", (exam_id,)).fetchone()
        if not exam:
            return jsonify({"error": "Not found"}), 404

        submissions = db.execute(
            """
            SELECT ms.*, u.first_name||' '||u.father_name as student_name, u.university
            FROM mock_exam_submissions ms
            JOIN users u ON u.id=ms.user_id
            WHERE ms.exam_id=? AND ms.status IN ('submitted','auto_submitted')
            ORDER BY ms.score DESC
            """,
            (exam_id,)
        ).fetchall()

        analytics = db.execute(
            """
            SELECT qa.*, qb.question_text, qb.subject_category, qb.bloom_level, qb.difficulty, qb.difficulty_auto
            FROM question_analytics qa
            JOIN question_bank qb ON qb.id=qa.question_id
            WHERE qa.mock_exam_id=?
            ORDER BY qa.correctness_rate ASC
            """,
            (exam_id,)
        ).fetchall()

        scores = [s["score"] for s in submissions if s["score"] is not None]
        total_subs = len(submissions)

        # Category breakdown
        cat_stats = {}
        for sub in submissions:
            answers = json.loads(sub["answers"] or "{}")
            opt_order_raw = sub["option_order"] if hasattr(sub, "__getitem__") else "{}"
            # simplified: track by reading question_bank for each q
        cat_breakdown = db.execute(
            """
            SELECT qb.subject_category, qa.times_presented, qa.times_correct, qa.correctness_rate
            FROM question_analytics qa
            JOIN question_bank qb ON qb.id=qa.question_id
            WHERE qa.mock_exam_id=?
            """,
            (exam_id,)
        ).fetchall()

        cat_agg = {}
        for row in cat_breakdown:
            cat = row["subject_category"]
            if cat not in cat_agg:
                cat_agg[cat] = {"presented": 0, "correct": 0}
            cat_agg[cat]["presented"] += row["times_presented"] or 0
            cat_agg[cat]["correct"] += row["times_correct"] or 0

        category_performance = []
        for cat, vals in cat_agg.items():
            rate = round(vals["correct"] / vals["presented"], 4) if vals["presented"] else 0
            category_performance.append({"category": cat, "correctness_rate": rate, "presented": vals["presented"]})
        category_performance.sort(key=lambda x: x["correctness_rate"])

        # Bloom's distribution
        bloom_agg = {}
        for row in analytics:
            bl = row["bloom_level"] or "Unknown"
            if bl not in bloom_agg:
                bloom_agg[bl] = {"presented": 0, "correct": 0}
            bloom_agg[bl]["presented"] += row["times_presented"] or 0
            bloom_agg[bl]["correct"] += row["times_correct"] or 0
        bloom_distribution = [
            {"level": bl, "count": v["presented"], "correctness_rate": round(v["correct"] / v["presented"], 4) if v["presented"] else 0}
            for bl, v in bloom_agg.items()
        ]

    finally:
        db.close()

    return jsonify({
        "exam": dict(exam),
        "overview": {
            "total_submissions": total_subs,
            "avg_score": round(sum(scores) / len(scores), 2) if scores else 0,
            "max_score": max(scores) if scores else 0,
            "min_score": min(scores) if scores else 0,
            "pass_rate": round(sum(1 for s in scores if s >= 50) / len(scores) * 100, 1) if scores else 0,
        },
        "question_analytics": [
            {
                "question_id": a["question_id"],
                "question_text": a["question_text"][:80] + "..." if len(a["question_text"]) > 80 else a["question_text"],
                "category": a["subject_category"],
                "bloom_level": a["bloom_level"],
                "difficulty": a["difficulty"],
                "difficulty_auto": a["difficulty_auto"],
                "correctness_rate": a["correctness_rate"],
                "times_presented": a["times_presented"],
            }
            for a in analytics
        ],
        "category_performance": category_performance,
        "bloom_distribution": bloom_distribution,
        "top_students": [
            {
                "name": s["student_name"],
                "university": s["university"],
                "score": s["score"],
                "status": s["status"],
            }
            for s in submissions[:10]
        ],
    })
