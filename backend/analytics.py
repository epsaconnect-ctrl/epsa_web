"""
EPSA Intelligent Analytics Engine — Backend
Provides advanced insights on student performance, question quality,
Bloom's taxonomy coverage, and cohort-level metrics.
"""
import json
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from models import get_db

analytics_bp = Blueprint("analytics", __name__)


def _require_admin(db, uid):
    row = db.execute(
        "SELECT role FROM users WHERE id=?", (uid,)
    ).fetchone()
    if not row or row["role"] not in ("admin", "super_admin"):
        raise ValueError("Admin access required.")


def _now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── SERVER TIME (used by client exam timer sync) ──────────────────────────────
@analytics_bp.route("/server-time", methods=["GET"])
def server_time():
    now = _now_utc()
    return jsonify({"utc": now.isoformat(), "ts": now.timestamp()})


# ── COHORT SUMMARY ────────────────────────────────────────────────────────────
@analytics_bp.route("/cohort-summary", methods=["GET"])
@jwt_required()
def cohort_summary():
    uid = get_jwt_identity()
    db = get_db()
    try:
        _require_admin(db, uid)
        exam_id = request.args.get("exam_id")

        if exam_id:
            subs = db.execute("""
                SELECT ms.*, u.first_name||' '||u.father_name as name, u.university
                FROM mock_exam_submissions ms
                JOIN users u ON u.id = ms.user_id
                WHERE ms.exam_id = ? AND ms.status IN ('submitted','auto_submitted')
            """, (exam_id,)).fetchall()
        else:
            subs = db.execute("""
                SELECT ms.*, u.first_name||' '||u.father_name as name, u.university
                FROM mock_exam_submissions ms
                JOIN users u ON u.id = ms.user_id
                WHERE ms.status IN ('submitted','auto_submitted')
            """).fetchall()

        scores = [s["score"] for s in subs if s["score"] is not None]
        distribution = {
            "90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0,
            "50-59": 0, "40-49": 0, "below_40": 0
        }
        for s in scores:
            if   s >= 90: distribution["90-100"]  += 1
            elif s >= 80: distribution["80-89"]   += 1
            elif s >= 70: distribution["70-79"]   += 1
            elif s >= 60: distribution["60-69"]   += 1
            elif s >= 50: distribution["50-59"]   += 1
            elif s >= 40: distribution["40-49"]   += 1
            else:         distribution["below_40"] += 1

        # Category performance from question_analytics
        try:
            if exam_id:
                cat_rows = db.execute("""
                    SELECT qb.subject_category,
                           SUM(qa.times_presented) as total,
                           SUM(qa.times_correct) as correct
                    FROM question_analytics qa
                    JOIN question_bank qb ON qb.id = qa.question_id
                    WHERE qa.mock_exam_id = ?
                    GROUP BY qb.subject_category
                    ORDER BY (SUM(qa.times_correct)*1.0/MAX(SUM(qa.times_presented),1)) ASC
                """, (exam_id,)).fetchall()
            else:
                cat_rows = db.execute("""
                    SELECT qb.subject_category,
                           SUM(qa.times_presented) as total,
                           SUM(qa.times_correct) as correct
                    FROM question_analytics qa
                    JOIN question_bank qb ON qb.id = qa.question_id
                    GROUP BY qb.subject_category
                    ORDER BY (SUM(qa.times_correct)*1.0/MAX(SUM(qa.times_presented),1)) ASC
                """).fetchall()
            category_perf = []
            for r in cat_rows:
                total   = r["total"]   or 0
                correct = r["correct"] or 0
                rate    = correct / total if total > 0 else 0
                category_perf.append({
                    "category": r["subject_category"] or "Uncategorized",
                    "total_attempts": total,
                    "total_correct":  correct,
                    "correctness_rate": round(rate, 4),
                    "status": "strength" if rate >= 0.65 else ("weakness" if rate < 0.45 else "moderate"),
                })
        except Exception:
            category_perf = []

        # University breakdown
        uni_scores = {}
        for s in subs:
            uni = s["university"] or "Unknown"
            if uni not in uni_scores:
                uni_scores[uni] = []
            if s["score"] is not None:
                uni_scores[uni].append(s["score"])
        uni_breakdown = []
        for uni, uni_s in uni_scores.items():
            avg = sum(uni_s) / len(uni_s) if uni_s else 0
            uni_breakdown.append({
                "university": uni,
                "count": len(uni_s),
                "avg_score": round(avg, 2)
            })
        uni_breakdown.sort(key=lambda x: x["avg_score"], reverse=True)

    finally:
        db.close()

    return jsonify({
        "total_students":      len(subs),
        "avg_score":           round(sum(scores) / len(scores), 2) if scores else 0,
        "pass_count":          sum(1 for s in scores if s >= 50),
        "fail_count":          sum(1 for s in scores if s < 50),
        "score_distribution":  distribution,
        "category_performance": category_perf,
        "university_breakdown": uni_breakdown,
    })


# ── QUESTION PERFORMANCE ──────────────────────────────────────────────────────
@analytics_bp.route("/question-performance", methods=["GET"])
@jwt_required()
def question_performance():
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        exam_id = request.args.get("exam_id")
        limit   = int(request.args.get("limit", 100))

        if exam_id:
            rows = db.execute("""
                SELECT qa.question_id, qa.times_presented, qa.times_correct,
                       qa.correctness_rate, qa.avg_time_seconds,
                       qb.question_text, qb.subject_category, qb.bloom_level,
                       qb.difficulty, qb.difficulty_auto
                FROM question_analytics qa
                JOIN question_bank qb ON qb.id = qa.question_id
                WHERE qa.mock_exam_id = ?
                ORDER BY qa.correctness_rate ASC
                LIMIT ?
            """, (exam_id, limit)).fetchall()
        else:
            rows = db.execute("""
                SELECT qa.question_id,
                       SUM(qa.times_presented) as times_presented,
                       SUM(qa.times_correct)   as times_correct,
                       AVG(qa.correctness_rate) as correctness_rate,
                       AVG(qa.avg_time_seconds) as avg_time_seconds,
                       qb.question_text, qb.subject_category, qb.bloom_level,
                       qb.difficulty, qb.difficulty_auto
                FROM question_analytics qa
                JOIN question_bank qb ON qb.id = qa.question_id
                GROUP BY qa.question_id
                ORDER BY AVG(qa.correctness_rate) ASC
                LIMIT ?
            """, (limit,)).fetchall()

        result = []
        for r in rows:
            rate      = r["correctness_rate"] or 0
            presented = r["times_presented"]  or 0
            disc      = None
            if presented >= 5:
                disc = round(1.0 - abs(rate - 0.5) * 2, 3)
            flags = []
            if presented >= 10:
                if rate > 0.90: flags.append("too_easy")
                if rate < 0.10: flags.append("too_hard")
                if disc is not None and disc < 0.2: flags.append("low_discrimination")
            result.append({
                "question_id":         r["question_id"],
                "question_text":       (r["question_text"] or "")[:120],
                "category":            r["subject_category"],
                "bloom_level":         r["bloom_level"],
                "difficulty_original": r["difficulty"],
                "difficulty_auto":     r["difficulty_auto"],
                "times_presented":     presented,
                "times_correct":       r["times_correct"] or 0,
                "correctness_rate":    round(rate, 4),
                "avg_time_secs":       round(r["avg_time_seconds"] or 0, 1),
                "discrimination_index": disc,
                "quality_flags":       flags,
            })
    finally:
        db.close()
    return jsonify({"questions": result, "count": len(result)})


# ── BLOOM'S TAXONOMY ANALYSIS ─────────────────────────────────────────────────
@analytics_bp.route("/bloom-analysis", methods=["GET"])
@jwt_required()
def bloom_analysis():
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        exam_id = request.args.get("exam_id")
        BLOOM_ORDER = [
            "Remembering", "Understanding", "Applying",
            "Analyzing", "Evaluating", "Creating"
        ]
        if exam_id:
            rows = db.execute("""
                SELECT qb.bloom_level,
                       SUM(qa.times_presented) as total,
                       SUM(qa.times_correct)   as correct
                FROM question_analytics qa
                JOIN question_bank qb ON qb.id = qa.question_id
                WHERE qa.mock_exam_id = ?
                GROUP BY qb.bloom_level
            """, (exam_id,)).fetchall()
        else:
            rows = db.execute("""
                SELECT qb.bloom_level,
                       SUM(qa.times_presented) as total,
                       SUM(qa.times_correct)   as correct
                FROM question_analytics qa
                JOIN question_bank qb ON qb.id = qa.question_id
                GROUP BY qb.bloom_level
            """).fetchall()
        result = {}
        for r in rows:
            lvl   = r["bloom_level"] or "Unknown"
            total = r["total"] or 0
            corr  = r["correct"] or 0
            result[lvl] = {
                "level":            lvl,
                "total_presented":  total,
                "total_correct":    corr,
                "correctness_rate": round(corr / total, 4) if total > 0 else 0,
                "order": BLOOM_ORDER.index(lvl) if lvl in BLOOM_ORDER else 99,
            }
        bloom_list = sorted(result.values(), key=lambda x: x["order"])
        high_order = sum(x["total_presented"] for x in bloom_list if x["order"] >= 3)
        low_order  = sum(x["total_presented"] for x in bloom_list if x["order"] < 3)
        total_all  = high_order + low_order
        if total_all == 0:
            cognitive_balance = "no_data"
        elif high_order / total_all < 0.20:
            cognitive_balance = "too_shallow"
        elif high_order / total_all > 0.80:
            cognitive_balance = "too_demanding"
        else:
            cognitive_balance = "balanced"
    finally:
        db.close()
    return jsonify({
        "bloom_levels":       bloom_list,
        "cognitive_balance":  cognitive_balance,
        "levels_covered":     len([x for x in bloom_list if x["total_presented"] > 0]),
        "high_order_pct":     round(high_order / total_all * 100, 1) if total_all > 0 else 0,
    })


# ── AT-RISK STUDENTS ──────────────────────────────────────────────────────────
@analytics_bp.route("/at-risk-students", methods=["GET"])
@jwt_required()
def at_risk_students():
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        threshold = float(request.args.get("threshold", 50))
        min_exams = int(request.args.get("min_exams", 1))
        rows = db.execute("""
            SELECT ms.user_id,
                   u.first_name||' '||u.father_name as name,
                   u.university, u.email,
                   COUNT(ms.id)       as exam_count,
                   AVG(ms.score)      as avg_score,
                   MIN(ms.score)      as min_score,
                   MAX(ms.score)      as max_score,
                   MAX(ms.submitted_at) as last_exam
            FROM mock_exam_submissions ms
            JOIN users u ON u.id = ms.user_id
            WHERE ms.status IN ('submitted','auto_submitted')
              AND ms.score IS NOT NULL
            GROUP BY ms.user_id
            HAVING AVG(ms.score) < ? AND COUNT(ms.id) >= ?
            ORDER BY AVG(ms.score) ASC
        """, (threshold, min_exams)).fetchall()
    finally:
        db.close()
    return jsonify({
        "at_risk_students": [
            {
                "student_id":  r["user_id"],
                "name":        r["name"],
                "university":  r["university"],
                "email":       r["email"],
                "exam_count":  r["exam_count"],
                "avg_score":   round(r["avg_score"] or 0, 2),
                "min_score":   round(r["min_score"]  or 0, 2),
                "max_score":   round(r["max_score"]  or 0, 2),
                "last_exam":   r["last_exam"],
                "risk_level":  "high" if (r["avg_score"] or 0) < 35 else "moderate",
            }
            for r in rows
        ],
        "count":     len(rows),
        "threshold": threshold,
    })


# ── STUDENT BEHAVIOR PROFILE ──────────────────────────────────────────────────
@analytics_bp.route("/student-behavior/<int:student_id>", methods=["GET"])
@jwt_required()
def student_behavior(student_id):
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        user = db.execute(
            "SELECT first_name, father_name, university, email FROM users WHERE id=?",
            (student_id,)
        ).fetchone()
        if not user:
            return jsonify({"error": "Student not found"}), 404

        subs = db.execute("""
            SELECT ms.*, me.title as exam_title
            FROM mock_exam_submissions ms
            JOIN mock_exams me ON me.id = ms.exam_id
            WHERE ms.user_id = ? AND ms.status IN ('submitted','auto_submitted')
            ORDER BY ms.submitted_at DESC
        """, (student_id,)).fetchall()

        exam_history     = []
        weak_categories  = {}

        for sub in subs:
            times       = json.loads(sub["time_per_question"] or "{}")
            answers     = json.loads(sub["answers"]           or "{}")
            qids        = json.loads(sub["question_ids"]      or "[]")
            opt_order   = json.loads(sub["option_order"]      or "{}")
            time_vals   = [float(t) for t in times.values()] if times else []
            avg_time    = sum(time_vals) / len(time_vals) if time_vals else 0
            rapid       = sum(1 for t in time_vals if t < 5)

            if qids:
                placeholders = ",".join("?" * len(qids))
                questions = db.execute(
                    f"SELECT id, subject_category, correct_idx FROM question_bank WHERE id IN ({placeholders})",
                    qids
                ).fetchall()
                for q in questions:
                    qid_str  = str(q["id"])
                    perm     = opt_order.get(qid_str, [0, 1, 2, 3])
                    cat      = q["subject_category"] or "Uncategorized"
                    was_corr = False
                    if qid_str in answers:
                        try:
                            original_idx = perm[int(answers[qid_str])]
                            was_corr     = original_idx == q["correct_idx"]
                        except (IndexError, ValueError, TypeError):
                            pass
                    if cat not in weak_categories:
                        weak_categories[cat] = {"total": 0, "correct": 0}
                    weak_categories[cat]["total"]   += 1
                    if was_corr:
                        weak_categories[cat]["correct"] += 1

            exam_history.append({
                "exam_title":             sub["exam_title"],
                "score":                  sub["score"],
                "total_questions":        sub["total_questions"],
                "submitted_at":           sub["submitted_at"],
                "status":                 sub["status"],
                "avg_time_per_question":  round(avg_time, 1),
                "rapid_responses":        rapid,
            })

        category_analysis = []
        for cat, data in weak_categories.items():
            rate = data["correct"] / data["total"] if data["total"] > 0 else 0
            category_analysis.append({
                "category": cat,
                "total":    data["total"],
                "correct":  data["correct"],
                "rate":     round(rate, 4),
                "status":   "strong" if rate >= 0.7 else ("weak" if rate < 0.45 else "moderate"),
            })
        category_analysis.sort(key=lambda x: x["rate"])

        scores    = [e["score"] for e in exam_history if e["score"] is not None]
        avg_score = sum(scores) / len(scores) if scores else 0

    finally:
        db.close()

    return jsonify({
        "student": {
            "id":         student_id,
            "name":       f"{user['first_name']} {user['father_name']}",
            "university": user["university"],
            "email":      user["email"],
        },
        "summary": {
            "total_exams":  len(subs),
            "avg_score":    round(avg_score, 2),
            "is_at_risk":   avg_score < 50 and len(scores) >= 2,
        },
        "exam_history":      exam_history,
        "category_analysis": category_analysis,
    })


# ── LIVE EXAM MONITOR ─────────────────────────────────────────────────────────
@analytics_bp.route("/live-monitor/<int:exam_id>", methods=["GET"])
@jwt_required()
def live_monitor(exam_id):
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        subs = db.execute("""
            SELECT ms.user_id, ms.status, ms.score, ms.started_at, ms.submitted_at,
                   u.first_name||' '||u.father_name as name, u.university
            FROM mock_exam_submissions ms
            JOIN users u ON u.id = ms.user_id
            WHERE ms.exam_id = ?
        """, (exam_id,)).fetchall()

        active    = [s for s in subs if s["status"] == "in_progress"]
        submitted = [s for s in subs if s["status"] in ("submitted", "auto_submitted")]

    finally:
        db.close()

    return jsonify({
        "active_count":    len(active),
        "submitted_count": len(submitted),
        "active_students": [
            {
                "name":       s["name"],
                "university": s["university"],
                "started_at": s["started_at"],
            }
            for s in active
        ],
    })


# ── EXAM OVERVIEW (all mock exams summary) ────────────────────────────────────
@analytics_bp.route("/exams-overview", methods=["GET"])
@jwt_required()
def exams_overview():
    uid = get_jwt_identity()
    db  = get_db()
    try:
        _require_admin(db, uid)
        exams = db.execute("""
            SELECT me.id, me.title, me.scheduled_at, me.is_active, me.results_released,
                   COUNT(ms.id) as submission_count,
                   AVG(ms.score) as avg_score,
                   SUM(CASE WHEN ms.score >= 50 THEN 1 ELSE 0 END) as pass_count
            FROM mock_exams me
            LEFT JOIN mock_exam_submissions ms
                ON ms.exam_id = me.id AND ms.status IN ('submitted','auto_submitted')
            GROUP BY me.id
            ORDER BY me.created_at DESC
        """).fetchall()
    finally:
        db.close()

    return jsonify({
        "exams": [
            {
                "id":               e["id"],
                "title":            e["title"],
                "scheduled_at":     e["scheduled_at"],
                "is_active":        e["is_active"],
                "results_released": e["results_released"],
                "submissions":      e["submission_count"],
                "avg_score":        round(e["avg_score"] or 0, 1),
                "pass_count":       e["pass_count"] or 0,
            }
            for e in exams
        ]
    })
