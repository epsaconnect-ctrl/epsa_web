"""EPSA Training Routes — student enrollment, hub (Khan-style modules), certificates."""
import json
import secrets
import hashlib
from datetime import datetime, date
from urllib.parse import quote

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename

try:
    from .models import get_db
    from .storage import save_upload, upload_url
except ImportError:
    from models import get_db
    from storage import save_upload, upload_url

training_bp = Blueprint("trainings", __name__)


def _serialize_row(row):
    if not row:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    return d


def _uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _registered_count(db, training_id):
    r = db.execute(
        "SELECT COUNT(*) AS c FROM training_applications WHERE training_id=? AND status='registered'",
        (training_id,),
    ).fetchone()
    return int(r["c"] or 0) if r else 0


def _get_application(db, user_id, training_id):
    return db.execute(
        "SELECT * FROM training_applications WHERE user_id=? AND training_id=?",
        (user_id, training_id),
    ).fetchone()


def _training_row(db, tid):
    return db.execute("SELECT * FROM trainings WHERE id=? AND is_active=1", (tid,)).fetchone()


def _parse_json(s, default=None):
    if not s:
        return default if default is not None else {}
    try:
        return json.loads(s) if isinstance(s, str) else s
    except Exception:
        return default if default is not None else {}


def _cert_code(training_id, user_id):
    raw = f"EPSA-{training_id}-{user_id}-{secrets.token_hex(6)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20].upper()


def _build_certificate_html(db, training, user_row, cert_row, verify_base_url):
    tr = dict(training) if training is not None else {}
    tpl = _parse_json(tr.get("cert_template_json"), {})
    accent = tpl.get("accent") or "#1a6b3c"
    subtitle = tpl.get("subtitle") or "Certificate of Completion"
    line1 = tpl.get("body_line1") or "This certifies that"
    sign1 = tpl.get("sign1_label") or "Program Director"
    sign2 = tpl.get("sign2_label") or "Lead Instructor"
    title = tr.get("title") or ""
    inst = tr.get("instructor_display_name") or tpl.get("instructor_name") or ""
    partner = tr.get("partner_logo_path") or tpl.get("partner_logo_url")
    logo_eps = tpl.get("epsa_logo_url") or "/static/epsa-logo.png"
    ur = dict(user_row) if user_row is not None else {}
    student_name = f"{ur.get('first_name','')} {ur.get('father_name','')}".strip()
    cr = dict(cert_row) if cert_row is not None else {}
    issued = cr.get("issued_at")
    if isinstance(issued, (datetime, date)):
        issued = issued.isoformat()[:10]
    qr_url = (
        "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data="
        + quote(verify_base_url + cr.get("cert_code", ""), safe="")
    )
    partner_block = ""
    if partner:
        purl = upload_url("training_partner_logos", partner) if not str(partner).startswith("http") else partner
        partner_block = f'<img src="{purl}" alt="Partner" style="max-height:48px;margin-left:16px"/>'
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Certificate</title>
<style>
body{{font-family:'Georgia',serif;background:#f4f6f8;margin:0;padding:40px;color:#111}}
.card{{max-width:900px;margin:0 auto;background:#fff;border:12px double {accent};padding:48px 56px;box-shadow:0 24px 60px rgba(0,0,0,.12);position:relative}}
h1{{color:{accent};font-size:2.1rem;margin:0 0 8px;letter-spacing:.04em}}
.sub{{font-size:1rem;color:#555;margin-bottom:28px}}
.name{{font-size:2.4rem;font-weight:700;margin:18px 0;color:#0f172a}}
.course{{font-size:1.35rem;color:#334155;margin:12px 0 28px}}
.meta{{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;border-top:1px solid #e2e8f0;padding-top:24px;font-size:.9rem;color:#475569}}
.sign{{margin-top:40px;display:flex;gap:48px}}
.sigline{{border-top:1px solid #94a3b8;padding-top:8px;min-width:200px;text-align:center;font-size:.85rem;color:#64748b}}
.badge{{position:absolute;top:24px;right:24px}}
</style></head><body><div class="card">
<div style="display:flex;align-items:center;gap:20px;margin-bottom:20px">
  <img src="{logo_eps}" alt="EPSA" style="height:56px" onerror="this.style.display='none'"/>
  {partner_block}
</div>
<h1>{subtitle}</h1>
<div class="sub">{line1}</div>
<div class="name">{student_name}</div>
<div class="course">has successfully completed<br/><strong>{title}</strong></div>
<div class="meta">
  <div>Issued: <strong>{issued}</strong><br/>Certificate ID: <strong>{cr.get("cert_code")}</strong><br/>Instructor: <strong>{inst or "—"}</strong></div>
  <div class="badge"><img src="{qr_url}" width="120" height="120" alt="Verify"/></div>
</div>
<div class="sign">
  <div class="sigline">{sign1}</div>
  <div class="sigline">{sign2}</div>
</div>
</div></body></html>"""


@training_bp.route("/certificates/verify/<code>", methods=["GET"])
def verify_certificate(code):
    db = get_db()
    try:
        row = db.execute(
            """
            SELECT c.*, t.title as training_title,
                   u.first_name, u.father_name
            FROM training_certificates c
            JOIN trainings t ON t.id = c.training_id
            JOIN users u ON u.id = c.user_id
            WHERE c.cert_code=?
            """,
            (code.upper().strip(),),
        ).fetchone()
        if not row:
            return jsonify({"valid": False, "message": "Certificate not found"}), 404
        return jsonify(
            {
                "valid": True,
                "cert_code": row["cert_code"],
                "training_title": row["training_title"],
                "recipient": f"{row['first_name']} {row['father_name']}",
                "issued_at": row["issued_at"].isoformat() if row["issued_at"] else None,
            }
        )
    finally:
        db.close()


@training_bp.route("", methods=["GET"])
@training_bp.route("/", methods=["GET"])
@jwt_required()
def list_trainings():
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM trainings WHERE is_active=1 ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            t = _serialize_row(r)
            app = db.execute(
                "SELECT status, id FROM training_applications WHERE user_id=? AND training_id=?",
                (uid, r["id"]),
            ).fetchone()
            t["status"] = app["status"] if app else "open"
            t["application_id"] = app["id"] if app else None
            mod_n = db.execute(
                "SELECT COUNT(*) FROM training_modules WHERE training_id=?", (r["id"],)
            ).fetchone()[0]
            t["module_count"] = mod_n
            result.append(t)
    finally:
        db.close()
    return jsonify(result)


@training_bp.route("/<int:tid>", methods=["GET"])
@jwt_required()
def get_training(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        row = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        t = _serialize_row(row)
        app = _get_application(db, uid, tid)
        t["status"] = app["status"] if app else "open"
        t["application_id"] = app["id"] if app else None
    finally:
        db.close()
    return jsonify(t)


@training_bp.route("/<int:tid>/apply", methods=["POST"])
@jwt_required()
def apply_training(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        training = db.execute("SELECT * FROM trainings WHERE id=? AND is_active=1", (tid,)).fetchone()
        if not training:
            return jsonify({"error": "Training not found"}), 404
        existing = _get_application(db, uid, tid)
        if existing:
            return jsonify({"error": "Already applied", "status": existing["status"]}), 409

        max_p = training["max_participants"] if "max_participants" in training.keys() else None
        reg = _registered_count(db, tid)
        waitlist = False
        if max_p is not None and int(max_p) > 0 and reg >= int(max_p):
            we = training["waitlist_enabled"] if "waitlist_enabled" in training.keys() else 1
            if int(we or 0):
                pos = db.execute(
                    "SELECT COALESCE(MAX(waitlist_position),0)+1 AS p FROM training_applications WHERE training_id=? AND status='waitlisted'",
                    (tid,),
                ).fetchone()
                wpos = int(pos["p"] or 1)
                db.execute(
                    """
                    INSERT INTO training_applications (user_id, training_id, status, waitlist_position)
                    VALUES (?,?, 'waitlisted', ?)
                    """,
                    (uid, tid, wpos),
                )
                db.commit()
                return jsonify({"message": "Added to waitlist", "status": "waitlisted", "waitlist_position": wpos})
            return jsonify({"error": "This training is full"}), 409

        db.execute(
            "INSERT INTO training_applications (user_id, training_id, status) VALUES (?,?, 'pending')",
            (uid, tid),
        )
        db.commit()
        return jsonify(
            {
                "message": "Application submitted. An administrator will review your enrollment.",
                "status": "pending",
            }
        )
    finally:
        db.close()


@training_bp.route("/<int:tid>/receipt", methods=["POST"])
@jwt_required()
def upload_receipt(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    file = request.files.get("receipt")
    if not file:
        return jsonify({"error": "Receipt file required"}), 400
    fname = secure_filename(f"{secrets.token_hex(8)}_{file.filename}")
    save_upload(file, "receipts", filename=fname)
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] not in ("applied", "approved"):
            return jsonify({"error": "You are not approved to upload a receipt for this training"}), 403
        db.execute(
            "UPDATE training_applications SET status='receipt', receipt_path=? WHERE user_id=? AND training_id=?",
            (fname, uid, tid),
        )
        db.commit()
    finally:
        db.close()
    return jsonify({"message": "Receipt submitted", "status": "receipt"})


@training_bp.route("/mine", methods=["GET"])
@jwt_required()
def my_trainings():
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        rows = db.execute(
            """
            SELECT t.*, ta.status as app_status, ta.submitted_at, ta.id as application_id
            FROM trainings t
            JOIN training_applications ta ON t.id = ta.training_id
            WHERE ta.user_id=?
            ORDER BY ta.submitted_at DESC
            """,
            (uid,),
        ).fetchall()
        out = []
        for r in rows:
            d = _serialize_row(r)
            d["status"] = d.pop("app_status", d.get("status"))
            out.append(d)
    finally:
        db.close()
    return jsonify(out)


def _exam_submission_summary(db, exam_id, user_id):
    if not exam_id:
        return None
    sub = db.execute(
        """
        SELECT es.*, e.results_released, e.passing_score, e.title
        FROM exam_submissions es
        JOIN exams e ON e.id = es.exam_id
        WHERE es.exam_id=? AND es.user_id=?
        """,
        (exam_id, user_id),
    ).fetchone()
    if not sub:
        return {"linked": True, "exam_id": exam_id, "status": "not_started"}
    released = bool(int(sub["results_released"] or 0))
    score = float(sub["score"]) if released and sub["score"] is not None else None
    passed = None
    if released and score is not None:
        ps = float(sub["passing_score"] or 60)
        passed = score >= ps
    return {
        "linked": True,
        "exam_id": exam_id,
        "title": sub["title"],
        "submission_status": sub["status"],
        "submitted_at": sub["submitted_at"],
        "score": score,
        "passed": passed,
        "results_released": released,
    }


@training_bp.route("/<int:tid>/learn", methods=["GET"])
@jwt_required()
def training_learn(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        if not training:
            return jsonify({"error": "Not found"}), 404
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Enrollment required", "status": app["status"] if app else "open"}), 403

        modules = db.execute(
            "SELECT * FROM training_modules WHERE training_id=? ORDER BY order_num ASC, id ASC",
            (tid,),
        ).fetchall()
        progress = {
            r["module_id"]: _serialize_row(r)
            for r in db.execute(
                "SELECT * FROM training_module_progress WHERE user_id=? AND module_id IN (SELECT id FROM training_modules WHERE training_id=?)",
                (uid, tid),
            ).fetchall()
        }
        quizzes = {}
        for m in modules:
            qz = db.execute(
                "SELECT id, title, pass_percent FROM training_pop_quizzes WHERE module_id=? LIMIT 1",
                (m["id"],),
            ).fetchone()
            if qz:
                att = db.execute(
                    "SELECT quiz_score, quiz_passed FROM training_module_progress WHERE user_id=? AND module_id=?",
                    (uid, m["id"]),
                ).fetchone()
                quizzes[m["id"]] = {
                    "quiz_id": qz["id"],
                    "title": qz["title"],
                    "pass_percent": qz["pass_percent"],
                    "attempt": _serialize_row(att) if att else None,
                }

        mod_out = []
        for m in modules:
            mr = _serialize_row(m)
            mr["progress"] = progress.get(m["id"])
            mr["quiz_meta"] = quizzes.get(m["id"])
            mr.pop("content_html", None)  # send full in module fetch
            mod_out.append(mr)

        sessions = [
            _serialize_row(s)
            for s in db.execute(
                "SELECT * FROM training_sessions WHERE training_id=? ORDER BY order_num, starts_at",
                (tid,),
            ).fetchall()
        ]
        announcements = [
            _serialize_row(a)
            for a in db.execute(
                "SELECT * FROM training_announcements WHERE training_id=? ORDER BY pinned DESC, created_at DESC LIMIT 50",
                (tid,),
            ).fetchall()
        ]
        gallery = []
        for g in db.execute(
            "SELECT * FROM training_gallery WHERE training_id=? ORDER BY sort_order, id",
            (tid,),
        ).fetchall():
            gr = _serialize_row(g)
            gr["url"] = upload_url("training_gallery", gr["path"]) if gr.get("path") else None
            gallery.append(gr)

        pre_ex = training["pre_exam_id"] if "pre_exam_id" in training.keys() else None
        post_ex = training["post_exam_id"] if "post_exam_id" in training.keys() else None

        cert = db.execute(
            "SELECT * FROM training_certificates WHERE training_id=? AND user_id=?",
            (tid, uid),
        ).fetchone()

        completion = _completion_state(db, training, uid, len(modules))

        return jsonify(
            {
                "training": _serialize_row(training),
                "modules": mod_out,
                "sessions": sessions,
                "announcements": announcements,
                "gallery": gallery,
                "pre_exam": _exam_submission_summary(db, pre_ex, uid),
                "post_exam": _exam_submission_summary(db, post_ex, uid),
                "certificate": _serialize_row(cert) if cert else None,
                "completion": completion,
            }
        )
    finally:
        db.close()


def _completion_state(db, training, user_id, module_count):
    mods_done = db.execute(
        """
        SELECT COUNT(*) FROM training_module_progress mp
        JOIN training_modules m ON m.id = mp.module_id
        WHERE m.training_id=? AND mp.user_id=? AND mp.completed_at IS NOT NULL
        """,
        (training["id"], user_id),
    ).fetchone()[0]
    pre_id = training["pre_exam_id"] if "pre_exam_id" in training.keys() else None
    post_id = training["post_exam_id"] if "post_exam_id" in training.keys() else None
    pre_ok = True
    post_ok = True
    if pre_id:
        pre_ok = _exam_passed(db, pre_id, user_id)
    if post_id:
        post_ok = _exam_passed(db, post_id, user_id)
    modules_ok = module_count == 0 or int(mods_done or 0) >= module_count
    eligible = modules_ok and pre_ok and post_ok
    return {
        "modules_completed": int(mods_done or 0),
        "module_total": module_count,
        "pre_exam_met": pre_ok,
        "post_exam_met": post_ok,
        "certificate_eligible": bool(eligible),
    }


def _exam_passed(db, exam_id, user_id):
    row = db.execute(
        """
        SELECT es.score, es.status, e.results_released, e.passing_score, es.submitted_at
        FROM exam_submissions es
        JOIN exams e ON e.id = es.exam_id
        WHERE es.exam_id=? AND es.user_id=?
        """,
        (exam_id, user_id),
    ).fetchone()
    if not row or not row["submitted_at"]:
        return False
    if not int(row["results_released"] or 0):
        return False
    if row["score"] is None:
        return False
    ps = float(row["passing_score"] or 60)
    return float(row["score"]) >= ps


@training_bp.route("/<int:tid>/modules/<int:mid>", methods=["GET"])
@jwt_required()
def training_module_detail(tid, mid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        m = db.execute(
            "SELECT * FROM training_modules WHERE id=? AND training_id=?",
            (mid, tid),
        ).fetchone()
        if not m:
            return jsonify({"error": "Module not found"}), 404
        qz = db.execute(
            "SELECT id, title, pass_percent FROM training_pop_quizzes WHERE module_id=? LIMIT 1",
            (mid,),
        ).fetchone()
        questions = None
        if qz:
            full = db.execute("SELECT questions_json FROM training_pop_quizzes WHERE id=?", (qz["id"],)).fetchone()
            qobj = _parse_json(full["questions_json"], [])
            questions = []
            for q in qobj:
                questions.append(
                    {
                        "question": q.get("question"),
                        "options": q.get("options", []),
                    }
                )
        prog = db.execute(
            "SELECT * FROM training_module_progress WHERE user_id=? AND module_id=?",
            (uid, mid),
        ).fetchone()
        return jsonify(
            {
                "module": _serialize_row(m),
                "quiz": {"id": qz["id"], "title": qz["title"], "pass_percent": qz["pass_percent"], "questions": questions}
                if qz
                else None,
                "progress": _serialize_row(prog) if prog else None,
            }
        )
    finally:
        db.close()


@training_bp.route("/<int:tid>/modules/<int:mid>/quiz", methods=["POST"])
@jwt_required()
def submit_pop_quiz(tid, mid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    data = request.json or {}
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        qz = db.execute(
            "SELECT * FROM training_pop_quizzes WHERE module_id=? LIMIT 1",
            (mid,),
        ).fetchone()
        if not qz:
            return jsonify({"error": "No quiz for this module"}), 404
        questions = _parse_json(qz["questions_json"], [])
        answers = data.get("answers") or []
        correct = 0
        for i, q in enumerate(questions):
            try:
                ai = int(answers[i]) if i < len(answers) else None
                if ai is not None and int(q.get("correct", 0)) == ai:
                    correct += 1
            except Exception:
                continue
        total = len(questions) or 1
        score = round(100.0 * correct / total, 1)
        passed = score >= float(qz["pass_percent"] or 70)
        db.execute(
            """
            INSERT INTO training_module_progress (user_id, module_id, completed_at, quiz_score, quiz_passed)
            VALUES (?,?, CASE WHEN ? THEN DATETIME('now') ELSE NULL END, ?, ?)
            ON CONFLICT(user_id, module_id) DO UPDATE SET
              quiz_score=excluded.quiz_score,
              quiz_passed=excluded.quiz_passed,
              completed_at=CASE WHEN excluded.quiz_passed=1
                THEN COALESCE(training_module_progress.completed_at, DATETIME('now'))
                ELSE training_module_progress.completed_at END
            """,
            (uid, mid, 1 if passed else 0, score, 1 if passed else 0),
        )
        db.commit()
        training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        _maybe_issue_certificate(db, training, uid)
        db.commit()
        return jsonify({"score": score, "passed": passed, "correct": correct, "total": total})
    finally:
        db.close()


@training_bp.route("/<int:tid>/modules/<int:mid>/complete", methods=["POST"])
@jwt_required()
def complete_module(tid, mid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        has_quiz = db.execute("SELECT 1 FROM training_pop_quizzes WHERE module_id=? LIMIT 1", (mid,)).fetchone()
        pr = db.execute(
            "SELECT quiz_passed FROM training_module_progress WHERE user_id=? AND module_id=?",
            (uid, mid),
        ).fetchone()
        if has_quiz:
            if not pr or not int(pr["quiz_passed"] or 0):
                return jsonify({"error": "Pass the module quiz first"}), 400
        qp_val = int(pr["quiz_passed"] or 0) if pr else (0 if has_quiz else 1)
        if not has_quiz:
            qp_val = 1
        db.execute(
            """
            INSERT INTO training_module_progress (user_id, module_id, completed_at, quiz_passed)
            VALUES (?,?, DATETIME('now'), ?)
            ON CONFLICT(user_id, module_id) DO UPDATE SET
              completed_at=DATETIME('now'),
              quiz_passed=MAX(COALESCE(training_module_progress.quiz_passed,0), excluded.quiz_passed)
            """,
            (uid, mid, qp_val),
        )
        db.commit()
        training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        _maybe_issue_certificate(db, training, uid)
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


def _maybe_issue_certificate(db, training, user_id):
    tid = training["id"]
    n_mod = db.execute("SELECT COUNT(*) FROM training_modules WHERE training_id=?", (tid,)).fetchone()[0]
    comp = _completion_state(db, training, user_id, int(n_mod or 0))
    if not comp["certificate_eligible"]:
        return
    exists = db.execute(
        "SELECT id FROM training_certificates WHERE training_id=? AND user_id=?",
        (tid, user_id),
    ).fetchone()
    if exists:
        return
    code = _cert_code(tid, user_id)
    db.execute(
        """
        INSERT INTO training_certificates (training_id, user_id, cert_code, meta_json)
        VALUES (?,?,?,?)
        """,
        (tid, user_id, code, json.dumps({"issued_via": "auto"})),
    )


@training_bp.route("/<int:tid>/discussions", methods=["GET"])
@jwt_required()
def list_discussions(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        rows = db.execute(
            """
            SELECT d.*, u.first_name||' '||u.father_name as author_name
            FROM training_discussions d
            JOIN users u ON u.id = d.user_id
            WHERE d.training_id=? AND d.parent_id IS NULL
            ORDER BY d.created_at DESC
            LIMIT 80
            """,
            (tid,),
        ).fetchall()
        return jsonify({"posts": [_serialize_row(r) for r in rows]})
    finally:
        db.close()


@training_bp.route("/<int:tid>/discussions", methods=["POST"])
@jwt_required()
def post_discussion(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    data = request.json or {}
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Message required"}), 400
    parent_id = data.get("parent_id")
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        db.execute(
            """
            INSERT INTO training_discussions (training_id, user_id, parent_id, body)
            VALUES (?,?,?,?)
            """,
            (tid, uid, parent_id, body),
        )
        db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


@training_bp.route("/<int:tid>/certificate", methods=["GET"])
@jwt_required()
def download_certificate(tid):
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        cert = db.execute(
            "SELECT * FROM training_certificates WHERE training_id=? AND user_id=?",
            (tid, uid),
        ).fetchone()
        if not cert:
            return jsonify({"error": "No certificate yet"}), 404
        training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        user = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        base = (request.host_url or "").rstrip("/") + "/api/trainings/certificates/verify/"
        html = _build_certificate_html(db, training, user, dict(cert), base)
        from flask import Response

        return Response(html, mimetype="text/html")
    finally:
        db.close()


@training_bp.route("/<int:tid>/analytics", methods=["GET"])
@jwt_required()
def training_analytics_student(tid):
    """Lightweight progress for student dashboard widgets."""
    uid = _uid()
    if uid is None:
        return jsonify({"error": "Invalid session"}), 401
    db = get_db()
    try:
        app = _get_application(db, uid, tid)
        if not app or app["status"] != "registered":
            return jsonify({"error": "Forbidden"}), 403
        training = db.execute("SELECT * FROM trainings WHERE id=?", (tid,)).fetchone()
        n_mod = db.execute("SELECT COUNT(*) FROM training_modules WHERE training_id=?", (tid,)).fetchone()[0]
        return jsonify(_completion_state(db, training, uid, int(n_mod or 0)))
    finally:
        db.close()
