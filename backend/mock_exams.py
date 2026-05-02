"""EPSA Mock Exam System — Adaptive Question Bank Exams"""
import json
import math
import random
import secrets
from datetime import datetime, timezone, date

def _serialize_row(row):
    if not row: return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d


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


def _parse_dt(value):
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    candidates = [text, text.replace("Z", "+00:00"), text.replace(" ", "T")]
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is not None:
                return parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except Exception:
            continue
    return None


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

@mock_exams_bp.route("", methods=["GET"])
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
        row = _serialize_row(e)
        scheduled = _parse_dt(row.get("scheduled_at"))
        ends = _parse_dt(row.get("ends_at"))

        now_naive = _now_utc()
        is_open = bool(row["is_active"] == 1 and (ends is None or ends > now_naive))
        if is_open and scheduled is not None and scheduled > now_naive:
            is_open = False
        row["is_open"] = is_open
        row["can_start"] = is_open and not row["my_status"]
        row["can_continue"] = is_open and row["my_status"] == "in_progress"
        row["is_submitted"] = row["my_status"] in ("submitted", "auto_submitted")
        # Student performance insights should remain available immediately after
        # submission without exposing item-level answer content.
        row["results_viewable"] = bool(row["is_submitted"])
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
            
            # 1. Seconds from the actual moment they first clicked "Start"
            started_at = datetime.fromisoformat(str(existing["started_at"]))
            elapsed_secs = (now - started_at).total_seconds()
            
            # 2. Maximum allowed duration based on exam settings
            max_duration_secs = (exam["duration_mins"] or 120) * 60
            
            # 3. Calculate remaining based on duration vs absolute deadline
            remaining_from_start = max_duration_secs - elapsed_secs
            
            remaining_secs = remaining_from_start
            if exam["ends_at"]:
                deadline = datetime.fromisoformat(str(exam["ends_at"]))
                secs_until_deadline = (deadline - now).total_seconds()
                remaining_secs = min(remaining_from_start, secs_until_deadline)

            return jsonify({
                "submission_id": existing["id"],
                "questions": questions,
                "total": len(qids),
                "duration_mins": exam["duration_mins"],
                "elapsed_secs": int(max(0, elapsed_secs)),
                "remaining_secs": int(max(0, remaining_secs)),
                "answers": json.loads(existing["answers"] or "{}"),
                "time_per_question": json.loads(existing["time_per_question"] or "{}"),
                "answer_changes": json.loads(existing["answer_changes"] or "{}"),
                "confidence_levels": json.loads(existing["confidence_levels"] or "{}"),
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

    # Calculate remaining time for new attempt (Hard Stop)
    max_duration_secs = (exam["duration_mins"] or 120) * 60
    remaining_secs = max_duration_secs
    if exam["ends_at"]:
        deadline = datetime.fromisoformat(str(exam["ends_at"]))
        secs_until_deadline = (deadline - now).total_seconds()
        remaining_secs = min(max_duration_secs, secs_until_deadline)

    return jsonify({
        "submission_id": sub_id,
        "questions": questions,
        "total": len(question_ids),
        "duration_mins": exam["duration_mins"],
        "elapsed_secs": 0,
        "remaining_secs": int(max(0, remaining_secs)),
        "answers": {},
        "time_per_question": {},
        "answer_changes": {},
        "confidence_levels": {},
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
        current_changes = json.loads(sub["answer_changes"] if sub["answer_changes"] else "{}")
        current_conf = json.loads(sub["confidence_levels"] if getattr(sub, "confidence_levels", None) or "confidence_levels" in sub.keys() and sub["confidence_levels"] else "{}")

        new_answers = data.get("answers", {})
        new_times = data.get("time_per_question", {})
        new_changes = data.get("answer_changes", {})
        new_conf = data.get("confidence_levels", {})

        current_answers.update({str(k): v for k, v in new_answers.items()})
        current_times.update({str(k): v for k, v in new_times.items()})
        current_conf.update({str(k): v for k, v in new_conf.items()})
        # Merge answer change counts — take the max to avoid reset on resume
        for k, v in new_changes.items():
            current_changes[str(k)] = max(current_changes.get(str(k), 0), int(v))

        db.execute(
            "UPDATE mock_exam_submissions SET answers=?, time_per_question=?, answer_changes=?, confidence_levels=? WHERE id=?",
            (json.dumps(current_answers), json.dumps(current_times), json.dumps(current_changes), json.dumps(current_conf), sub["id"])
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

        # Merge final answer_changes
        current_changes = json.loads(sub["answer_changes"] if sub["answer_changes"] else "{}")
        new_changes = data.get("answer_changes", {})
        for k, v in new_changes.items():
            current_changes[str(k)] = max(current_changes.get(str(k), 0), int(v))
            
        current_conf = json.loads(sub["confidence_levels"] if getattr(sub, "confidence_levels", None) or "confidence_levels" in sub.keys() and sub["confidence_levels"] else "{}")
        new_conf = data.get("confidence_levels", {})
        current_conf.update({str(k): v for k, v in new_conf.items()})

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
            SET answers=?, time_per_question=?, answer_changes=?, confidence_levels=?, score=?, status=?, submitted_at=DATETIME('now')
            WHERE id=?
            """,
            (json.dumps(current_answers), json.dumps(current_times), json.dumps(current_changes), json.dumps(current_conf), score, status, sub["id"])
        )
        db.commit()

        # Update pre-aggregated analytics tables immediately on completion so
        # dashboards do not have to scan raw submission logs.
        _update_question_analytics(db, exam_id, qids, current_answers, current_times, current_changes, opt_order, score)
        _update_university_stats_fallback(db, sub["user_id"], exam_id, qids, current_answers, current_times, opt_order)
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


# Difficulty formula weights
_W1 = 0.6  # accuracy component weight
_W2 = 0.4  # normalized time component weight
_MIN_SAMPLE = 5  # minimum submissions before auto-calibration kicks in


def _compute_difficulty_score(accuracy_rate, avg_time_secs, max_time_secs):
    """Compute weighted difficulty score. Higher = harder."""
    normalized_time = min(1.0, avg_time_secs / max_time_secs) if max_time_secs > 0 else 0.0
    return round((_W1 * (1.0 - accuracy_rate)) + (_W2 * normalized_time), 4)


def _auto_classify(difficulty_score):
    """Map difficulty score to Easy/Medium/Hard label."""
    if difficulty_score < 0.35:
        return "easy"
    elif difficulty_score < 0.65:
        return "medium"
    return "hard"


def _empty_option_counts():
    return {"a": 0, "b": 0, "c": 0, "d": 0}


def _count_selected_option(original_idx):
    counts = _empty_option_counts()
    mapping = {0: "a", 1: "b", 2: "c", 3: "d"}
    key = mapping.get(original_idx)
    if key:
        counts[key] = 1
    return counts


def _safe_rate(numerator, denominator):
    return round(numerator / denominator, 4) if denominator else 0.0


def _refresh_question_stats(db, question_id):
    rows = db.execute(
        """
        SELECT times_presented, times_correct, avg_time_seconds, avg_time_correct, avg_time_incorrect,
               doubt_count, difficulty_score, high_variance_flag, top_group_correct, bottom_group_correct,
               option_a_selections, option_b_selections, option_c_selections, option_d_selections
        FROM question_analytics
        WHERE question_id=?
        """,
        (question_id,)
    ).fetchall()
    if not rows:
        return

    total_presented = 0
    total_correct = 0
    total_doubt = 0
    total_time = 0.0
    total_time_correct = 0.0
    total_time_incorrect = 0.0
    total_correct_weight = 0
    total_incorrect_weight = 0
    diff_weight = 0
    diff_total = 0.0
    top_total = 0.0
    bottom_total = 0.0
    top_count = 0
    bottom_count = 0
    high_variance = 0
    option_counts = _empty_option_counts()

    for row in rows:
        presented = int(row["times_presented"] or 0)
        correct = int(row["times_correct"] or 0)
        incorrect = max(0, presented - correct)
        total_presented += presented
        total_correct += correct
        total_doubt += int(row["doubt_count"] or 0)
        total_time += float(row["avg_time_seconds"] or 0) * presented
        total_time_correct += float(row["avg_time_correct"] or 0) * correct
        total_time_incorrect += float(row["avg_time_incorrect"] or 0) * incorrect
        total_correct_weight += correct
        total_incorrect_weight += incorrect
        if row["difficulty_score"] is not None:
            diff_total += float(row["difficulty_score"]) * max(presented, 1)
            diff_weight += max(presented, 1)
        if row["top_group_correct"] is not None:
            top_total += float(row["top_group_correct"] or 0)
            top_count += 1
        if row["bottom_group_correct"] is not None:
            bottom_total += float(row["bottom_group_correct"] or 0)
            bottom_count += 1
        high_variance = max(high_variance, int(row["high_variance_flag"] or 0))
        option_counts["a"] += int(row["option_a_selections"] or 0)
        option_counts["b"] += int(row["option_b_selections"] or 0)
        option_counts["c"] += int(row["option_c_selections"] or 0)
        option_counts["d"] += int(row["option_d_selections"] or 0)

    payload = {
        "times_presented": total_presented,
        "times_correct": total_correct,
        "correctness_rate": _safe_rate(total_correct, total_presented),
        "avg_time_seconds": round(total_time / total_presented, 2) if total_presented else 0.0,
        "avg_time_correct": round(total_time_correct / total_correct_weight, 2) if total_correct_weight else 0.0,
        "avg_time_incorrect": round(total_time_incorrect / total_incorrect_weight, 2) if total_incorrect_weight else 0.0,
        "doubt_count": total_doubt,
        "difficulty_score": round(diff_total / diff_weight, 4) if diff_weight else None,
        "high_variance_flag": high_variance,
        "top_group_correct": round(top_total / top_count, 4) if top_count else 0.0,
        "bottom_group_correct": round(bottom_total / bottom_count, 4) if bottom_count else 0.0,
        "option_a_selections": option_counts["a"],
        "option_b_selections": option_counts["b"],
        "option_c_selections": option_counts["c"],
        "option_d_selections": option_counts["d"],
    }

    db.execute(
        """
        INSERT INTO question_stats (
            question_id, times_presented, times_correct, correctness_rate,
            avg_time_seconds, avg_time_correct, avg_time_incorrect,
            doubt_count, difficulty_score, high_variance_flag,
            top_group_correct, bottom_group_correct,
            option_a_selections, option_b_selections, option_c_selections, option_d_selections,
            updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATETIME('now'))
        ON CONFLICT(question_id) DO UPDATE SET
            times_presented=excluded.times_presented,
            times_correct=excluded.times_correct,
            correctness_rate=excluded.correctness_rate,
            avg_time_seconds=excluded.avg_time_seconds,
            avg_time_correct=excluded.avg_time_correct,
            avg_time_incorrect=excluded.avg_time_incorrect,
            doubt_count=excluded.doubt_count,
            difficulty_score=excluded.difficulty_score,
            high_variance_flag=excluded.high_variance_flag,
            top_group_correct=excluded.top_group_correct,
            bottom_group_correct=excluded.bottom_group_correct,
            option_a_selections=excluded.option_a_selections,
            option_b_selections=excluded.option_b_selections,
            option_c_selections=excluded.option_c_selections,
            option_d_selections=excluded.option_d_selections,
            updated_at=DATETIME('now')
        """,
        (
            question_id,
            payload["times_presented"],
            payload["times_correct"],
            payload["correctness_rate"],
            payload["avg_time_seconds"],
            payload["avg_time_correct"],
            payload["avg_time_incorrect"],
            payload["doubt_count"],
            payload["difficulty_score"],
            payload["high_variance_flag"],
            payload["top_group_correct"],
            payload["bottom_group_correct"],
            payload["option_a_selections"],
            payload["option_b_selections"],
            payload["option_c_selections"],
            payload["option_d_selections"],
        )
    )


def _update_question_analytics(db, exam_id, qids, answers, time_per_question, answer_changes, opt_order, submission_score):
    """Update per-question analytics after a submission is scored.
    
    Computes:
    - Correctness rate, avg time (correct vs incorrect)
    - Doubt count (answer changed >= 3 times = high doubt)
    - Difficulty score using weighted formula
    - Auto-reclassification of difficulty
    - High variance flag for Item Discrimination Index
    """
    if not qids:
        return

    placeholders = ",".join("?" * len(qids))
    questions = db.execute(
        f"SELECT id, correct_idx, difficulty FROM question_bank WHERE id IN ({placeholders})",
        qids
    ).fetchall()

    # Get global max avg time to normalize (across all analytics for this exam)
    try:
        max_time_row = db.execute(
            "SELECT MAX(avg_time_seconds) as mt FROM question_analytics WHERE mock_exam_id=?",
            (exam_id,)
        ).fetchone()
        max_global_time = float(max_time_row["mt"] or 120.0)
    except Exception:
        max_global_time = 120.0

    for q in questions:
        qid = q["id"]
        qid_str = str(qid)
        student_answer = answers.get(qid_str)
        time_spent = float(time_per_question.get(qid_str, 0) or 0)
        change_count = int(answer_changes.get(qid_str, 0) or 0)
        is_high_doubt = 1 if change_count >= 3 else 0

        was_correct = 0
        selected_original_idx = None
        if student_answer is not None:
            perm = opt_order.get(qid_str, [0, 1, 2, 3])
            try:
                selected_original_idx = perm[int(student_answer)]
                was_correct = 1 if selected_original_idx == q["correct_idx"] else 0
            except (IndexError, ValueError, TypeError):
                pass
        option_bump = _count_selected_option(selected_original_idx)

        existing = db.execute(
            "SELECT * FROM question_analytics WHERE question_id=? AND mock_exam_id=?",
            (qid, exam_id)
        ).fetchone()

        if existing:
            new_presented = existing["times_presented"] + 1
            new_correct = existing["times_correct"] + was_correct
            new_rate = round(new_correct / new_presented, 4)

            # Update rolling avg time for correct / incorrect
            prev_avg_t_correct = float(existing["avg_time_correct"] or 0)
            prev_avg_t_incorrect = float(existing["avg_time_incorrect"] or 0)
            prev_correct_cnt = existing["times_correct"]
            prev_incorrect_cnt = existing["times_presented"] - existing["times_correct"]

            if was_correct:
                new_cnt_c = prev_correct_cnt + 1
                new_avg_correct = round((prev_avg_t_correct * prev_correct_cnt + time_spent) / new_cnt_c, 2)
                new_avg_incorrect = prev_avg_t_incorrect
            else:
                new_cnt_i = prev_incorrect_cnt + 1
                new_avg_incorrect = round((prev_avg_t_incorrect * prev_incorrect_cnt + time_spent) / new_cnt_i, 2)
                new_avg_correct = prev_avg_t_correct

            # Update rolling avg_time_seconds (overall)
            prev_avg = float(existing["avg_time_seconds"] or 0)
            new_avg_time = round((prev_avg * (new_presented - 1) + time_spent) / new_presented, 2)

            # Doubt count
            new_doubt = (existing["doubt_count"] or 0) + is_high_doubt
            new_option_a = int(existing["option_a_selections"] or 0) + option_bump["a"]
            new_option_b = int(existing["option_b_selections"] or 0) + option_bump["b"]
            new_option_c = int(existing["option_c_selections"] or 0) + option_bump["c"]
            new_option_d = int(existing["option_d_selections"] or 0) + option_bump["d"]

            # Difficulty score
            effective_max = max(max_global_time, new_avg_time, 1.0)
            diff_score = _compute_difficulty_score(new_rate, new_avg_time, effective_max)

            db.execute(
                """
                UPDATE question_analytics
                SET times_presented=?, times_correct=?, correctness_rate=?,
                    avg_time_seconds=?, avg_time_correct=?, avg_time_incorrect=?,
                    doubt_count=?, difficulty_score=?,
                    option_a_selections=?, option_b_selections=?, option_c_selections=?, option_d_selections=?,
                    updated_at=DATETIME('now')
                WHERE question_id=? AND mock_exam_id=?
                """,
                (new_presented, new_correct, new_rate,
                 new_avg_time, new_avg_correct, new_avg_incorrect,
                 new_doubt, diff_score,
                 new_option_a, new_option_b, new_option_c, new_option_d,
                 qid, exam_id)
            )

            # Auto-reclassify difficulty after enough samples
            if new_presented >= _MIN_SAMPLE:
                auto_diff = _auto_classify(diff_score)
                db.execute(
                    "UPDATE question_bank SET difficulty_auto=? WHERE id=?",
                    (auto_diff, qid)
                )

            # Item Discrimination Index: update high_variance_flag
            # Recompute based on stored top/bottom group correctness
            _update_item_discrimination(db, exam_id, qid, new_presented)
            _refresh_question_stats(db, qid)

        else:
            # First time this question appears in this exam
            avg_t_c = time_spent if was_correct else 0.0
            avg_t_i = time_spent if not was_correct else 0.0
            diff_score = _compute_difficulty_score(
                float(was_correct), time_spent, max(time_spent, 1.0)
            )
            db.execute(
                """
                INSERT INTO question_analytics
                    (question_id, mock_exam_id, times_presented, times_correct, correctness_rate,
                     avg_time_seconds, avg_time_correct, avg_time_incorrect,
                     doubt_count, difficulty_score,
                     option_a_selections, option_b_selections, option_c_selections, option_d_selections,
                     updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATETIME('now'))
                """,
                (qid, exam_id, 1, was_correct, float(was_correct),
                 time_spent, avg_t_c, avg_t_i,
                 is_high_doubt, diff_score,
                 option_bump["a"], option_bump["b"], option_bump["c"], option_bump["d"])
            )
            _refresh_question_stats(db, qid)


def _update_item_discrimination(db, exam_id, question_id, total_submissions):
    """Compute Item Discrimination Index (IDI) for a question.
    
    Compares top 10% vs bottom 10% of students by total score.
    D = P_top - P_bottom. D < 0.2 => High Variance flag.
    Requires at least 15 submissions to be meaningful.
    """
    if total_submissions < 15:
        return

    try:
        # Get all submissions for this exam, ordered by score
        all_subs = db.execute(
            """
            SELECT ms.user_id, ms.score, ms.answers, ms.option_order
            FROM mock_exam_submissions ms
            WHERE ms.exam_id=? AND ms.status IN ('submitted','auto_submitted') AND ms.score IS NOT NULL
            ORDER BY ms.score DESC
            """,
            (exam_id,)
        ).fetchall()

        n = len(all_subs)
        if n < 6:
            return

        cut = max(1, int(n * 0.10))
        top_subs = all_subs[:cut]
        bottom_subs = all_subs[n - cut:]

        qid_str = str(question_id)

        # Get correct_idx for this question
        q_row = db.execute(
            "SELECT correct_idx FROM question_bank WHERE id=?", (question_id,)
        ).fetchone()
        if not q_row:
            return
        correct_idx = q_row["correct_idx"]

        def group_correctness(group):
            correct = 0
            for sub in group:
                try:
                    answers = json.loads(sub["answers"] or "{}")
                    opt_order = json.loads(sub["option_order"] or "{}")
                    ans = answers.get(qid_str)
                    if ans is None:
                        continue
                    perm = opt_order.get(qid_str, [0, 1, 2, 3])
                    if perm[int(ans)] == correct_idx:
                        correct += 1
                except Exception:
                    pass
            return correct / len(group) if group else 0

        p_top = group_correctness(top_subs)
        p_bottom = group_correctness(bottom_subs)
        d = round(p_top - p_bottom, 4)
        high_variance = 1 if d < 0.2 else 0

        db.execute(
            """
            UPDATE question_analytics
            SET top_group_correct=?, bottom_group_correct=?, high_variance_flag=?
            WHERE question_id=? AND mock_exam_id=?
            """,
            (round(p_top, 4), round(p_bottom, 4), high_variance, question_id, exam_id)
        )
    except Exception:
        pass  # IDI is best-effort; never crash the submission flow

def _update_university_stats_fallback(db, user_id, exam_id, qids, answers, time_per_question, opt_order):
    """Python fallback to aggregate university performance across psychological domains."""
    if not qids: return
    # Get user's university
    u_row = db.execute("SELECT university FROM users WHERE id=?", (user_id,)).fetchone()
    if not u_row or not u_row["university"]: return
    uni = u_row["university"]

    placeholders = ",".join("?" * len(qids))
    questions = db.execute(
        f"SELECT id, subject_category, correct_idx FROM question_bank WHERE id IN ({placeholders})",
        qids
    ).fetchall()

    for q in questions:
        qid_str = str(q["id"])
        cat = q["subject_category"] or "General"
        ans = answers.get(qid_str)
        if ans is None: continue

        time_spent = float(time_per_question.get(qid_str, 0.0))
        perm = opt_order.get(qid_str, [0, 1, 2, 3])
        try:
            is_correct = 1 if perm[int(ans)] == q["correct_idx"] else 0
        except (IndexError, ValueError, TypeError):
            is_correct = 0

        # Upsert
        db.execute("""
            INSERT INTO university_stats (exam_id, university, category, attempts, correct_count, avg_time)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(exam_id, university, category) DO UPDATE SET
                attempts = attempts + 1,
                correct_count = correct_count + excluded.correct_count,
                avg_time = ((avg_time * attempts) + excluded.avg_time) / (attempts + 1)
        """, (exam_id, uni, cat, is_correct, time_spent))


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
        category_stats = {}
        for qid in qids:
            q = q_map.get(qid)
            if not q:
                continue
            qid_str = str(qid)
            student_choice = answers.get(qid_str)
            perm = opt_order.get(qid_str, [0, 1, 2, 3])
            original_correct_idx = q["correct_idx"]

            was_correct = False
            if student_choice is not None:
                try:
                    original_idx = perm[int(student_choice)]
                    was_correct = original_idx == original_correct_idx
                except (IndexError, ValueError, TypeError):
                    pass

            cat = q["subject_category"]
            if cat not in category_stats:
                category_stats[cat] = {"correct": 0, "total": 0, "time_spent": 0}
            
            category_stats[cat]["total"] += 1
            if was_correct:
                category_stats[cat]["correct"] += 1
            category_stats[cat]["time_spent"] += times.get(qid_str, 0)

            # Do NOT expose question text, options, or correct answers to the student
            breakdown.append({
                "id": qid,
                "correct": was_correct,
                "category": cat,
                "bloom_level": q["bloom_level"],
                "time_spent": times.get(qid_str, 0),
            })
            
        category_performance = [{"category": k, **v} for k, v in category_stats.items()]
    finally:
        db.close()

    s_exam = _serialize_row(exam)
    s_sub = _serialize_row(sub)

    return jsonify({
        "exam_title": s_exam["title"],
        "score": s_sub["score"],
        "total": s_sub["total_questions"],
        "correct": sum(1 for b in breakdown if b["correct"]),
        "status": s_sub["status"],
        "submitted_at": s_sub["submitted_at"],
        "breakdown": breakdown,
        "category_performance": category_performance
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
    return jsonify({"exams": [_serialize_row(e) for e in exams]})



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
        "exam": _serialize_row(exam),

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
@mock_exams_bp.route("/admin/<int:exam_id>", methods=["DELETE"])
@jwt_required()
def admin_delete_exam(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        # Delete submissions first to maintain integrity
        db.execute("DELETE FROM mock_exam_submissions WHERE exam_id=?", (exam_id,))
        db.execute("DELETE FROM mock_exams WHERE id=?", (exam_id,))
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Exam deleted successfully"})


@mock_exams_bp.route("/admin/<int:exam_id>/stop", methods=["POST"])
@jwt_required()
def admin_stop_exam(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        db.execute("UPDATE mock_exams SET is_active=0 WHERE id=?", (exam_id,))
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Exam deactivated (stopped suddenly)"})


@mock_exams_bp.route("/admin/live-analytics", methods=["GET"])
@jwt_required()
def admin_live_analytics():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        # Count students who have 'in_progress' submissions in the last hour
        active_counts = db.execute(
            """
            SELECT me.title, COUNT(ms.id) as active_students
            FROM mock_exam_submissions ms
            JOIN mock_exams me ON me.id=ms.exam_id
            WHERE ms.status='in_progress' 
              AND ms.updated_at > DATETIME('now', '-30 minutes')
            GROUP BY ms.exam_id
            """
        ).fetchall()
        
        total_active = db.execute(
            "SELECT COUNT(DISTINCT user_id) FROM mock_exam_submissions WHERE status='in_progress' AND updated_at > DATETIME('now', '-30 minutes')"
        ).fetchone()[0]

    finally:
        db.close()
    return jsonify({
        "total_active": total_active,
        "exams": [_serialize_row(r) for r in active_counts]
    })


@mock_exams_bp.route("/admin/questions/<int:qid>", methods=["DELETE"])
@jwt_required()
def admin_delete_question(qid):
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        # Delete FK children first to avoid FK constraint violations (Postgres)
        try:
            db.execute("DELETE FROM question_analytics WHERE question_id=?", (qid,))
        except Exception:
            pass
        db.execute("DELETE FROM question_bank WHERE id=?", (qid,))
        db.commit()
    except ValueError as e:
        db.close()
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
        return jsonify({"error": "Failed to delete question: " + str(e)}), 500
    finally:
        try:
            db.close()
        except Exception:
            pass
    return jsonify({"message": "Question deleted successfully"})


# ── POST-EXAM INSIGHTS ────────────────────────────────────────────────────────
@mock_exams_bp.route("/<int:exam_id>/insights", methods=["GET"])
@jwt_required()
def get_post_exam_insights(exam_id):
    uid = get_jwt_identity()
    db = get_db()
    try:
        sub = db.execute(
            "SELECT * FROM mock_exam_submissions WHERE exam_id=? AND user_id=? AND status IN ('submitted','auto_submitted')",
            (exam_id, uid)
        ).fetchone()
        if not sub:
            return jsonify({"error": "No completed submission found"}), 404

        qids = json.loads(sub["question_ids"] or "[]")
        answers = json.loads(sub["answers"] or "{}")
        times = json.loads(sub["time_per_question"] or "{}")
        conf_levels = json.loads(sub["confidence_levels"] if getattr(sub, "confidence_levels", None) or "confidence_levels" in sub.keys() and sub["confidence_levels"] else "{}")
        opt_order = json.loads(sub["option_order"] or "{}")

        if not qids:
            return jsonify({"error": "Empty exam submission"}), 400

        # Fetch question details
        ph = ",".join("?" * len(qids))
        questions = db.execute(
            f"SELECT id, subject_category, topic, subtopic, correct_idx FROM question_bank WHERE id IN ({ph})",
            qids
        ).fetchall()
        question_map = {q["id"]: q for q in questions}
        ordered_questions = [question_map[qid] for qid in qids if qid in question_map]

        exam = db.execute("SELECT id, title FROM mock_exams WHERE id=?", (exam_id,)).fetchone()

        # 1. Categorical Performance Profile
        cat_stats = {}
        missed_concepts = {}
        for q in ordered_questions:
            cat = q["subject_category"] or "General"
            topic = q["topic"] or q["subtopic"] or "General Psychology"
            if cat not in cat_stats:
                cat_stats[cat] = {"total": 0, "correct": 0, "missed_topics": {}}
            
            cat_stats[cat]["total"] += 1
            qid_str = str(q["id"])
            ans = answers.get(qid_str)
            is_correct = False
            
            if ans is not None:
                try:
                    perm = opt_order.get(qid_str, [0,1,2,3])
                    if perm[int(ans)] == q["correct_idx"]:
                        cat_stats[cat]["correct"] += 1
                        is_correct = True
                except Exception:
                    pass
            
            if not is_correct:
                missed_concepts[topic] = missed_concepts.get(topic, 0) + 1
                cat_stats[cat]["missed_topics"][topic] = cat_stats[cat]["missed_topics"].get(topic, 0) + 1

        skill_gaps = []
        for cat, data in cat_stats.items():
            rate = int(round(data["correct"] / data["total"] * 100)) if data["total"] else 0
            top_topics = sorted(data["missed_topics"].items(), key=lambda item: (-item[1], item[0]))[:3]
            skill_gaps.append({
                "category": cat,
                "mastery": rate,
                "total": data["total"],
                "top_concepts": [topic_name for topic_name, _ in top_topics],
            })
        skill_gaps.sort(key=lambda item: (item["mastery"], item["category"]))
        
        top_weaknesses = sorted(missed_concepts.items(), key=lambda x: -x[1])[:3]
        weak_concepts = [w[0] for w in top_weaknesses]

        # 2. Relative Performance Benchmarking
        all_scores = db.execute(
            "SELECT score FROM mock_exam_submissions WHERE exam_id=? AND status IN ('submitted','auto_submitted') AND score IS NOT NULL",
            (exam_id,)
        ).fetchall()
        scores_list = [s["score"] for s in all_scores]
        national_avg = sum(scores_list) / len(scores_list) if scores_list else 0
        
        my_score = sub["score"] or 0
        better_than = sum(1 for s in scores_list if s < my_score)
        percentile = int(round((better_than / len(scores_list)) * 100)) if scores_list else 100

        u_row = db.execute("SELECT university FROM users WHERE id=?", (uid,)).fetchone()
        my_uni = u_row["university"] if u_row and u_row["university"] else "Unknown"
        
        uni_scores = db.execute("""
            SELECT ms.score FROM mock_exam_submissions ms
            JOIN users u ON u.id = ms.user_id
            WHERE ms.exam_id=? AND ms.status IN ('submitted','auto_submitted') AND u.university=? AND ms.score IS NOT NULL
        """, (exam_id, my_uni)).fetchall()
        u_scores_list = [s["score"] for s in uni_scores]
        uni_avg = sum(u_scores_list) / len(u_scores_list) if u_scores_list else national_avg

        # 3. Behavioral & Pacing Insights
        rushing = 0
        overthinking = 0
        all_times = [float(v) for v in times.values()]
        avg_time = sum(all_times)/len(all_times) if all_times else 30.0

        fatigue_buckets = {"early": {"correct":0, "total":0}, "late": {"correct":0, "total":0}}
        late_threshold = int(len(qids) * 0.75) # final 25%

        # 4. Metacognitive Reflection Tool
        false_confidence = 0
        lucky_guesses = 0
        total_confident = 0
        total_uncertain = 0

        for i, q in enumerate(ordered_questions):
            qid_str = str(q["id"])
            ans = answers.get(qid_str)
            t = float(times.get(qid_str, 0.0))
            conf = conf_levels.get(qid_str, False)
            
            is_correct = False
            if ans is not None:
                try:
                    perm = opt_order.get(qid_str, [0,1,2,3])
                    if perm[int(ans)] == q["correct_idx"]:
                        is_correct = True
                except Exception:
                    pass

            # Behavior
            if not is_correct and t < 10.0: rushing += 1
            if not is_correct and t > (avg_time * 3): overthinking += 1
            
            # Fatigue (Early vs Late)
            if i < late_threshold:
                fatigue_buckets["early"]["total"] += 1
                if is_correct: fatigue_buckets["early"]["correct"] += 1
            else:
                fatigue_buckets["late"]["total"] += 1
                if is_correct: fatigue_buckets["late"]["correct"] += 1

            # Metacognitive
            if conf:
                total_confident += 1
                if not is_correct: false_confidence += 1
            else:
                total_uncertain += 1
                if is_correct: lucky_guesses += 1

        early_rate = (fatigue_buckets["early"]["correct"] / fatigue_buckets["early"]["total"]) if fatigue_buckets["early"]["total"] else 0
        late_rate = (fatigue_buckets["late"]["correct"] / fatigue_buckets["late"]["total"]) if fatigue_buckets["late"]["total"] else 0
        fatigue_drop = max(0, early_rate - late_rate) * 100

        # 5. Automated Study Path
        weakest_cats = sorted(skill_gaps, key=lambda x: x["mastery"])[:2]
        content_links = {
            "Clinical Psychology": {"title": "Clinical case formulation review", "url": "/ecosystem.html"},
            "Developmental Psychology": {"title": "Developmental milestones primer", "url": "/history.html"},
            "Research Methods & Statistics": {"title": "Research methods refresher", "url": "/ecosystem.html"},
            "Ethics": {"title": "Ethical decision-making workshop", "url": "/get-involved.html"},
            "General Psychology": {"title": "General psychology foundations", "url": "/index.html"},
        }
        study_path = []
        for item in weakest_cats:
            resource = content_links.get(item["category"], {"title": f"{item['category']} study guide", "url": "/ecosystem.html"})
            study_path.append({
                "category": item["category"],
                "mastery": item["mastery"],
                "content_title": resource["title"],
                "content_url": resource["url"],
                "forum_prompt": f"Peer-review discussion: clarify core ideas in {item['category']}",
            })

        return jsonify({
            "exam_title": exam["title"] if exam else "Mock Exam",
            "score": my_score,
            "passed": bool(my_score >= 50),
            "pass_mark": 50,
            "categorical": {
                "skill_gaps": skill_gaps,
                "weak_concepts": weak_concepts
            },
            "benchmarking": {
                "percentile": percentile,
                "national_avg": round(national_avg, 1),
                "university_avg": round(uni_avg, 1),
                "university": my_uni
            },
            "behavioral": {
                "rushing_errors": rushing,
                "overthinking_errors": overthinking,
                "fatigue_drop_pct": round(fatigue_drop, 1)
            },
            "metacognitive": {
                "false_confidence": false_confidence,
                "lucky_guesses": lucky_guesses,
                "total_confident": total_confident,
                "total_uncertain": total_uncertain,
                "false_confidence_rate": round((false_confidence / total_confident) * 100, 1) if total_confident else 0,
                "lucky_guess_rate": round((lucky_guesses / total_uncertain) * 100, 1) if total_uncertain else 0,
            },
            "study_path": study_path
        })
    finally:
        db.close()
