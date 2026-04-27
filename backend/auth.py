"""EPSA Auth Routes"""

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
)
from werkzeug.security import check_password_hash as wz_check_password_hash
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename

try:
    from .config import get_settings
    from .face_verification import (
        DEFAULT_THRESHOLD,
        FaceVerificationError,
        analyze_face,
        compare_embeddings,
        deserialize_embedding,
        deserialize_embedding_set,
        extract_embedding,
        extract_embedding_set,
        hash_image,
        serialize_embedding,
        serialize_embedding_set,
        verify_live_capture_against_set,
    )
    from .models import get_db
    from .email_service import send_email
    from .security import consume_one_time_token, enforce_rate_limit, issue_one_time_token, plus_interval, rate_limit, utcnow, verify_totp_code
    from .storage import read_upload_bytes, save_bytes
    from .tasks import run_biometric_task
except ImportError:
    from config import get_settings
    from face_verification import (
        DEFAULT_THRESHOLD,
        FaceVerificationError,
        analyze_face,
        compare_embeddings,
        deserialize_embedding,
        deserialize_embedding_set,
        extract_embedding,
        extract_embedding_set,
        hash_image,
        serialize_embedding,
        serialize_embedding_set,
        verify_live_capture_against_set,
    )
    from models import get_db
    from email_service import send_email
    from security import consume_one_time_token, enforce_rate_limit, issue_one_time_token, plus_interval, rate_limit, utcnow, verify_totp_code
    from storage import read_upload_bytes, save_bytes
    from tasks import run_biometric_task

auth_bp = Blueprint("auth", __name__)
logger = logging.getLogger("epsa.auth")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ETHIOPIAN_PHONE_RE = re.compile(r"^(?:\+251|251|0)?9\d{8}$")
PASSWORD_UPPER_RE = re.compile(r"[A-Z]")
PASSWORD_LOWER_RE = re.compile(r"[a-z]")
PASSWORD_DIGIT_RE = re.compile(r"\d")
PASSWORD_SPECIAL_RE = re.compile(r"[^A-Za-z0-9]")
LOGIN_FAILURE_LIMIT = 5
LOGIN_BLOCK_MINUTES = 10
LOGIN_WINDOW_MINUTES = 15
FACE_LOGIN_FAILURE_LIMIT = 8
FACE_LOGIN_BLOCK_MINUTES = 3


def hash_password(password):
    return generate_password_hash(password)


def check_password(password, hashed):
    if not hashed:
        return False
    try:
        if wz_check_password_hash(hashed, password):
            return True
    except Exception:
        pass
    if hashlib.sha256(password.encode()).hexdigest() == hashed:
        return True
    if hashed.startswith("$2"):
        try:
            import bcrypt

            return bcrypt.checkpw(password.encode(), hashed.encode())
        except Exception:
            return False
    return False


def allowed_file(filename, exts={"png", "jpg", "jpeg", "webp", "pdf"}):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in exts


def normalize_email(value):
    return (value or "").strip().lower()


def _mask_email(email):
    local, _, domain = (email or "").partition("@")
    if not local or not domain:
        return "redacted"
    return f"{local[:2]}***@{domain}"


def _hash_otp(email, code):
    return hashlib.sha256(f"{normalize_email(email)}:{code}".encode("utf-8")).hexdigest()


def _is_verified_user(row):
    return bool(row and int(row["is_verified"] or 0))


def _is_active_user(row):
    return bool(row and int(row["is_active"] or 0))


def _duplicate_email_response(row, *, intended_role="student"):
    role = (row["role"] or "account") if row else "account"
    status = (row["status"] or "unknown") if row else "unknown"
    if role != intended_role:
        role_label = "admin" if role in {"admin", "super_admin"} else role
        return (
            jsonify(
                {
                    "error": f"This email is already linked to an existing {role_label} account and cannot be used for {intended_role} registration.",
                    "existing_role": role,
                    "existing_status": status,
                }
            ),
            409,
        )
    return (
        jsonify(
            {
                "error": "This email already belongs to an existing EPSA account. Please sign in instead.",
                "existing_role": role,
                "existing_status": status,
            }
        ),
        409,
    )


def normalize_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    if digits.startswith("251") and len(digits) == 12:
        digits = "0" + digits[3:]
    if digits.startswith("9") and len(digits) == 9:
        digits = "0" + digits
    if not ETHIOPIAN_PHONE_RE.match(digits):
        raise ValueError("Enter a valid Ethiopian phone number.")
    return digits


def password_is_strong(password):
    return (
        len(password or "") >= 8
        and bool(PASSWORD_UPPER_RE.search(password))
        and bool(PASSWORD_LOWER_RE.search(password))
        and bool(PASSWORD_DIGIT_RE.search(password))
        and bool(PASSWORD_SPECIAL_RE.search(password))
    )


def make_student_id(university, year):
    prefix = "".join(word[0] for word in (university or "EPSA").split()[:3]).upper() or "EPSA"
    return f"EPSA-{prefix}-{year}-{secrets.token_hex(3).upper()}"


def _client_ip():
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    return forwarded or request.remote_addr or "unknown"


def _request_json():
    return request.get_json(silent=True) or {}


def _read_storage_bytes(file_storage):
    if not file_storage:
        return b""
    file_storage.stream.seek(0)
    payload = file_storage.read()
    file_storage.stream.seek(0)
    return payload


def _save_uploaded_bytes(folder_name, original_filename, payload):
    if not payload:
        return None
    return save_bytes(folder_name, payload, original_filename=original_filename)


def _generate_unique_student_id(db, university):
    while True:
        student_id = make_student_id(university, datetime.now().year)
        exists = db.execute("SELECT id FROM users WHERE student_id=?", (student_id,)).fetchone()
        if not exists:
            return student_id


def _generate_unique_username(db, first_name, father_name):
    first = re.sub(r"[^a-z0-9]", "", (first_name or "").lower()) or "student"
    father = re.sub(r"[^a-z0-9]", "", (father_name or "").lower())
    base = f"{first}.{father[:1]}" if father else first
    for _ in range(20):
        candidate = f"{base}{secrets.randbelow(900) + 100}"
        exists = db.execute("SELECT id FROM users WHERE LOWER(username)=LOWER(?)", (candidate,)).fetchone()
        if not exists:
            return candidate
    return f"{base}_{secrets.token_hex(3)}"


def _login_identifier_key(identifier):
    identifier = (identifier or "").strip()
    try:
        return normalize_phone(identifier)
    except ValueError:
        return identifier.lower()


def _get_login_attempt(db, identifier_key, ip_address):
    return db.execute(
        """
        SELECT *
        FROM login_attempts
        WHERE identifier=? AND COALESCE(ip_address, '') = COALESCE(?, '')
        """,
        (identifier_key, ip_address),
    ).fetchone()


def _is_login_blocked(attempt_row):
    if not attempt_row or not attempt_row["blocked_until"]:
        return False
    try:
        blocked_until = datetime.fromisoformat(str(attempt_row["blocked_until"]).replace("Z", ""))
    except Exception:
        return False
    return blocked_until > datetime.utcnow()


def _record_failed_login(db, identifier_key, ip_address, failure_limit=LOGIN_FAILURE_LIMIT, block_minutes=LOGIN_BLOCK_MINUTES):
    row = _get_login_attempt(db, identifier_key, ip_address)
    now = datetime.utcnow()
    blocked_until = None
    failed_count = 1
    if row:
        try:
            last_attempt = datetime.fromisoformat(str(row["last_attempt_at"]).replace("Z", ""))
        except Exception:
            last_attempt = now
        if now - last_attempt <= timedelta(minutes=LOGIN_WINDOW_MINUTES):
            failed_count = int(row["failed_count"] or 0) + 1
        if failed_count >= failure_limit:
            blocked_until = now + timedelta(minutes=block_minutes)
        db.execute(
            """
            UPDATE login_attempts
            SET failed_count=?, last_attempt_at=?, blocked_until=?, updated_at=?
            WHERE id=?
            """,
            (failed_count, now, blocked_until, now, row["id"]),
        )
    else:
        if failed_count >= failure_limit:
            blocked_until = now + timedelta(minutes=block_minutes)
        db.execute(
            """
            INSERT INTO login_attempts (identifier, ip_address, failed_count, last_attempt_at, blocked_until, updated_at)
            VALUES (?,?,?,?,?,?)
            """,
            (identifier_key, ip_address, failed_count, now, blocked_until, now),
        )


def _clear_login_attempt(db, identifier_key, ip_address):
    db.execute(
        """
        DELETE FROM login_attempts
        WHERE identifier=? AND COALESCE(ip_address, '') = COALESCE(?, '')
        """,
        (identifier_key, ip_address),
    )


def _resolve_login_identifier(db, identifier):
    """Resolve any user (student, teacher, or admin) by identifier for standard login."""
    raw_identifier = (identifier or "").strip()
    if not raw_identifier:
        return None
    lowered = raw_identifier.lower()
    phone_value = None
    try:
        phone_value = normalize_phone(raw_identifier)
    except ValueError:
        phone_value = None
    return db.execute(
        """
        SELECT *
        FROM users
        WHERE (
            LOWER(username)=?
            OR LOWER(email)=?
            OR LOWER(student_id)=?
            OR phone=?
        )
        LIMIT 1
        """,
        (lowered, lowered, lowered, phone_value),
    ).fetchone()


# Keep old name as alias for any internal callers
def _resolve_student_identifier(db, identifier):
    return _resolve_login_identifier(db, identifier)



def _parse_angle_samples(raw_value):
    if not raw_value:
        return []
    try:
        payload = json.loads(raw_value) if isinstance(raw_value, str) else list(raw_value)
    except Exception:
        return []
    result = []
    for item in payload[:6]:
        if isinstance(item, str) and item.startswith("data:image/"):
            result.append(item)
    return result


def _build_reference_embedding_set(reference_bytes):
    reference_set = extract_embedding_set(reference_bytes, limit=4)
    return reference_set[0], reference_set


def _build_live_embedding_set(live_capture, angle_samples=None):
    live_set = []
    seen = set()
    for sample in [live_capture, *(angle_samples or [])]:
        try:
            for embedding in extract_embedding_set(sample, limit=4):
                payload = tuple(round(float(value), 6) for value in embedding)
                if payload in seen:
                    continue
                seen.add(payload)
                live_set.append(embedding)
        except FaceVerificationError:
            continue
    if not live_set:
        raise FaceVerificationError("Unable to build a valid live face map from the captured frames.")
    return live_set[:10]


def _verify_registration_faces(reference_bytes, live_capture, angle_samples=None):
    reference_embedding, reference_set = _build_reference_embedding_set(reference_bytes)
    live_set = _build_live_embedding_set(live_capture, angle_samples)
    best_result = None
    best_reference = reference_embedding
    for live_embedding in live_set:
        for reference_candidate in reference_set:
            result = compare_embeddings(reference_candidate, live_embedding, threshold=DEFAULT_THRESHOLD)
            if best_result is None or result.score > best_result.score:
                best_reference = reference_candidate
                best_result = result
    if best_result is None:
        raise FaceVerificationError("Unable to compare the captured live scan against the uploaded profile photo.")
    return best_reference, live_set, best_result


def _build_login_payload(row):
    token = create_access_token(identity=str(row["id"]))
    user = dict(row)
    user.pop("password_hash", None)
    # Postgres returns datetime objects; jsonify needs strings
    for key, value in user.items():
        if isinstance(value, datetime):
            user[key] = value.isoformat()
    payload = {"user": user}
    settings = get_settings()
    if settings.expose_jwt_to_client:
        payload["token"] = token
    return payload, token


def _auth_response(row, extra=None):
    payload, token = _build_login_payload(row)
    if extra:
        payload.update(extra)
    response = jsonify(payload)
    if get_settings().use_cookie_auth:
        set_access_cookies(response, token)
    return response


def _best_face_match_score(reference_set, live_set):
    best = None
    for live_embedding in live_set:
        for reference_embedding in reference_set:
            result = compare_embeddings(reference_embedding, live_embedding, threshold=DEFAULT_THRESHOLD)
            if best is None or result.score > best.score:
                best = result
    return best


# Face sign-in: same *decision basis* as registration — live scan vs enrolled profile photo first,
# then a consistency check against stored embeddings. Stricter than "best match across all users".
FACE_LOGIN_MIN_PHOTO_SCORE = 0.76  # stricter than registration gate (0.72) but allows normal lighting variance
FACE_LOGIN_PHOTO_MARGIN = 0.04  # if two accounts both pass, reject ambiguity
FACE_LOGIN_EMBED_AGREE = 0.62  # stored face map must still agree with live capture


def _resolve_face_login_match(db, live_capture, angle_samples=None):
    analysis = analyze_face(live_capture)
    if not analysis.get("has_face"):
        raise FaceVerificationError("EPSA could not locate a clear face in the current camera frame.")
    if int(analysis.get("face_count") or 0) != 1:
        raise FaceVerificationError("Exactly one face must be visible to use face login.")

    candidates = db.execute(
        """
        SELECT u.*, fe.embedding, fe.angle_embeddings, fe.match_threshold, fe.engine
        FROM users u
        JOIN face_embeddings fe ON fe.user_id = u.id
        WHERE u.role = 'student'
          AND u.status = 'approved'
          AND fe.registration_verified = 1
          AND u.profile_photo IS NOT NULL
          AND TRIM(u.profile_photo) != ''
        """
    ).fetchall()
    if not candidates:
        raise FaceVerificationError(
            "No approved members with an enrolled profile photo are available for face sign-in yet."
        )

    photo_hits = []
    for row in candidates:
        try:
            ref_bytes = read_upload_bytes("profiles", row["profile_photo"])
        except Exception:
            continue
        try:
            _, _, face_result = _verify_registration_faces(ref_bytes, live_capture, angle_samples=angle_samples)
        except FaceVerificationError:
            continue
        sc = float(face_result.score)
        if not face_result.verified or sc < FACE_LOGIN_MIN_PHOTO_SCORE:
            continue
        photo_hits.append((row, sc))

    if not photo_hits:
        raise FaceVerificationError(
            "Your live face does not match any enrolled EPSA profile photo closely enough. "
            "Face sign-in is only for the registered account holder—use password sign-in otherwise."
        )

    photo_hits.sort(key=lambda item: item[1], reverse=True)
    top_row, top_photo_score = photo_hits[0]
    second_photo_score = photo_hits[1][1] if len(photo_hits) > 1 else -1.0
    if second_photo_score >= 0 and (top_photo_score - second_photo_score) < FACE_LOGIN_PHOTO_MARGIN:
        raise FaceVerificationError(
            "EPSA could not pick a single account for this scan. Ensure you are alone in frame, "
            "improve lighting, and try again."
        )

    live_set = _build_live_embedding_set(live_capture, angle_samples)
    try:
        reference_set = [
            deserialize_embedding(top_row["embedding"]),
            *deserialize_embedding_set(top_row["angle_embeddings"]),
        ]
    except FaceVerificationError as exc:
        raise FaceVerificationError("Stored face signature is unavailable. Use password sign-in.") from exc

    emb_best = _best_face_match_score(reference_set, live_set)
    if emb_best is None or float(emb_best.score) < FACE_LOGIN_EMBED_AGREE:
        raise FaceVerificationError(
            "Live face map does not align with the enrolled member's stored EPSA signature. Use password sign-in."
        )

    emb_score = float(emb_best.score)
    threshold_used = max(FACE_LOGIN_EMBED_AGREE, float(top_row["match_threshold"] or DEFAULT_THRESHOLD))
    alternate_embedding = second_photo_score if second_photo_score >= 0 else 0.0
    return top_row, emb_score, threshold_used, alternate_embedding


@auth_bp.route("/verify-registration-face", methods=["POST"])
@rate_limit("verify-registration-face", limit=20, window_seconds=60)
def verify_registration_face():
    payload = _request_json()
    profile_photo = request.files.get("profile_photo")
    live_capture = (request.form or {}).get("live_capture") or payload.get("live_capture")
    angle_samples = _parse_angle_samples((request.form or {}).get("angle_samples") or payload.get("angle_samples"))
    if not profile_photo or not profile_photo.filename:
        return jsonify({"error": "Profile photo is required for face verification."}), 400
    if not live_capture:
        return jsonify({"error": "Live face capture is required."}), 400
    if not allowed_file(profile_photo.filename, {"png", "jpg", "jpeg", "webp"}):
        return jsonify({"error": "Profile photo must be JPG, PNG, or WEBP."}), 400
    try:
        reference_bytes = _read_storage_bytes(profile_photo)
        _, _, result = run_biometric_task(
            _verify_registration_faces,
            reference_bytes,
            live_capture,
            angle_samples,
        )
    except FaceVerificationError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(
        {
            "verified": result.verified,
            "score": result.score,
            "threshold": result.threshold,
            "engine": result.engine,
            "message": "Live face verified successfully." if result.verified else "Live face does not match the uploaded photo closely enough yet. Retake the smart scan and finish the guided prompts.",
        }
    )


@auth_bp.route("/analyze-registration-face", methods=["POST"])
@rate_limit("analyze-registration-face", limit=200, window_seconds=300)
def analyze_registration_face():
    payload = _request_json()
    live_capture = (request.form or {}).get("live_capture") or payload.get("live_capture")
    if not live_capture:
        return jsonify({"error": "Live face capture is required."}), 400
    try:
        analysis = run_biometric_task(analyze_face, live_capture)
    except FaceVerificationError as exc:
        return jsonify({"error": str(exc), "has_face": False, "face_count": 0}), 400
    return jsonify(analysis)


@auth_bp.route("/register", methods=["POST"])
@rate_limit("register", limit=8, window_seconds=3600)
def register():
    data = request.form
    required = [
        "first_name",
        "father_name",
        "grandfather_name",
        "email",
        "phone",
        "password",
        "university",
        "program_type",
        "academic_year",
    ]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    email = normalize_email(data.get("email"))
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Enter a valid email address."}), 400
    otp_verification_token = (data.get("otp_verification_token") or "").strip()
    if not otp_verification_token:
        return jsonify({"error": "Email verification is required before registration."}), 400
    try:
        phone = normalize_phone(data.get("phone"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    password = data.get("password", "")
    if not password_is_strong(password):
        return jsonify(
            {
                "error": "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
            }
        ), 400

    profile_photo = request.files.get("profile_photo")
    reg_slip = request.files.get("reg_slip")
    live_capture = data.get("live_capture", "")
    angle_samples = _parse_angle_samples(data.get("angle_samples", ""))
    if not profile_photo or not profile_photo.filename:
        return jsonify({"error": "Profile photo is required."}), 400
    if not reg_slip or not reg_slip.filename:
        return jsonify({"error": "Registration slip is required."}), 400
    if not live_capture:
        return jsonify({"error": "Live face verification is required before registration."}), 400
    if not allowed_file(profile_photo.filename, {"png", "jpg", "jpeg", "webp"}):
        return jsonify({"error": "Profile photo must be JPG, PNG, or WEBP."}), 400
    if not allowed_file(reg_slip.filename):
        return jsonify({"error": "Registration slip must be PDF or image."}), 400

    try:
        profile_photo_bytes = _read_storage_bytes(profile_photo)
        reference_embedding, live_embedding_set, face_result = run_biometric_task(
            _verify_registration_faces,
            profile_photo_bytes,
            live_capture,
            angle_samples,
        )
    except FaceVerificationError as exc:
        return jsonify({"error": str(exc)}), 400
    if not face_result.verified:
        return jsonify(
            {
                "error": "Live face verification failed. Please retake the smart scan and finish the guided prompts before submitting.",
                "score": face_result.score,
                "threshold": face_result.threshold,
            }
        ), 403

    reg_slip_bytes = _read_storage_bytes(reg_slip)
    db = get_db()
    try:
        verification_row = consume_one_time_token(
            db,
            token=otp_verification_token,
            purpose="registration_otp",
            subject=email,
        )
        if not verification_row:
            return jsonify({"error": "Email verification expired. Request a new OTP and try again."}), 400
        existing_user = db.execute("SELECT * FROM users WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()
        if existing_user and _is_verified_user(existing_user):
            return _duplicate_email_response(existing_user, intended_role="student")

        phone_row = db.execute("SELECT id, email FROM users WHERE phone=?", (phone,)).fetchone()
        if existing_user and (existing_user["role"] or "student") != "student":
            return _duplicate_email_response(existing_user, intended_role="student")

        if phone_row and (not existing_user or phone_row["id"] != existing_user["id"]):
            return jsonify({"error": "Phone number already registered"}), 409

        student_id = _generate_unique_student_id(db, data.get("university"))
        username = _generate_unique_username(db, data.get("first_name"), data.get("father_name"))
        profile_photo_name = _save_uploaded_bytes("profiles", profile_photo.filename, profile_photo_bytes)
        reg_slip_name = _save_uploaded_bytes("slips", reg_slip.filename, reg_slip_bytes)

        graduation_year = data.get("graduation_year")
        graduation_year = int(graduation_year) if str(graduation_year or "").strip().isdigit() else None
        graduation_status = "graduated" if data.get("program_type") == "graduate" else "active_student"

        user_values = (
            username,
            hash_password(password),
            data.get("first_name", "").strip(),
            data.get("father_name", "").strip(),
            data.get("grandfather_name", "").strip(),
            email,
            phone,
            data.get("university", "").strip(),
            data.get("program_type", "").strip(),
            data.get("academic_year", "").strip(),
            data.get("field_of_study", "").strip(),
            graduation_year,
            profile_photo_name,
            reg_slip_name,
            student_id,
            graduation_status,
        )

        if existing_user and not _is_verified_user(existing_user):
            db.execute(
                """
                UPDATE users
                SET username=?, password_hash=?, first_name=?, father_name=?, grandfather_name=?,
                    email=?, phone=?, university=?, program_type=?, academic_year=?, field_of_study=?,
                    graduation_year=?, profile_photo=?, reg_slip=?, role='student', status='pending',
                    student_id=?, graduation_status=?, is_verified=1, is_active=1
                WHERE id=?
                """,
                (*user_values, existing_user["id"]),
            )
            user_id = existing_user["id"]
            face_row = db.execute("SELECT id FROM face_embeddings WHERE user_id=?", (user_id,)).fetchone()
            if face_row:
                db.execute(
                    """
                    UPDATE face_embeddings
                    SET embedding=?, angle_embeddings=?, engine=?, reference_image_hash=?, match_threshold=?,
                        registration_verified=1, registration_score=?, registration_verified_at=DATETIME('now'),
                        updated_at=DATETIME('now')
                    WHERE user_id=?
                    """,
                    (
                        serialize_embedding(reference_embedding),
                        serialize_embedding_set(live_embedding_set),
                        face_result.engine,
                        hash_image(profile_photo_bytes),
                        face_result.threshold,
                        face_result.score,
                        user_id,
                    ),
                )
            else:
                db.execute(
                    """
                    INSERT INTO face_embeddings (
                        user_id, embedding, angle_embeddings, engine, reference_image_hash, match_threshold,
                        registration_verified, registration_score, registration_verified_at, updated_at
                    )
                    VALUES (?,?,?,?,?,?,1,?,DATETIME('now'),DATETIME('now'))
                    """,
                    (
                        user_id,
                        serialize_embedding(reference_embedding),
                        serialize_embedding_set(live_embedding_set),
                        face_result.engine,
                        hash_image(profile_photo_bytes),
                        face_result.threshold,
                        face_result.score,
                    ),
                )
        else:
            cur = db.execute(
                """
                INSERT INTO users (
                    username, password_hash, first_name, father_name, grandfather_name,
                    email, phone, university, program_type, academic_year, field_of_study,
                    graduation_year, profile_photo, reg_slip, role, status, student_id, graduation_status,
                    is_verified, is_active
                )
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'student', 'pending', ?, ?, 1, 1)
                """,
                user_values,
            )
            user_id = cur.lastrowid
            db.execute(
                """
                INSERT INTO face_embeddings (
                    user_id, embedding, angle_embeddings, engine, reference_image_hash, match_threshold,
                    registration_verified, registration_score, registration_verified_at, updated_at
                )
                VALUES (?,?,?,?,?,?,1,?,DATETIME('now'),DATETIME('now'))
                """,
                (
                    user_id,
                    serialize_embedding(reference_embedding),
                    serialize_embedding_set(live_embedding_set),
                    face_result.engine,
                    hash_image(profile_photo_bytes),
                    face_result.threshold,
                    face_result.score,
                ),
            )
        db.commit()
    finally:
        db.close()

    return (
        jsonify(
            {
                "message": "Application submitted. Under review within 24 hours.",
                "status": "pending",
                "face_verified": True,
            }
        ),
        201,
    )


@auth_bp.route("/login", methods=["POST"])
@rate_limit("login", limit=10, window_seconds=900)
def login():
    data = _request_json()
    identifier = (data.get("identifier") or data.get("username") or "").strip()
    password = data.get("password", "")
    if not identifier or not password:
        return jsonify({"error": "Identifier and password are required"}), 400

    db = get_db()
    try:
        identifier_key = _login_identifier_key(identifier)
        ip_address = _client_ip()
        attempt = _get_login_attempt(db, identifier_key, ip_address)
        if _is_login_blocked(attempt):
            return (
                jsonify(
                    {
                        "error": f"Too many failed sign-in attempts. Try again after {LOGIN_BLOCK_MINUTES} minutes."
                    }
                ),
                429,
            )

        row = _resolve_login_identifier(db, identifier)
        if not row or not check_password(password, row["password_hash"]):
            _record_failed_login(db, identifier_key, ip_address)
            db.commit()
            return jsonify({"error": "Invalid credentials"}), 401
        if not _is_verified_user(row):
            return jsonify({"error": "Please verify your account first."}), 403
        if not _is_active_user(row):
            return jsonify({"error": "Account is inactive. Please contact EPSA support."}), 403

        _clear_login_attempt(db, identifier_key, ip_address)
        db.commit()
    finally:
        db.close()

    role = row["status"] if row else "pending"
    if row["status"] == "pending":
        role_label = "Teacher application" if row["role"] == "teacher" else "Account"
        return jsonify({"error": f"{role_label} is under review. Check back in 24 hours.", "status": "pending"}), 403
    if row["status"] == "rejected":
        return jsonify({"error": f"Account rejected. Reason: {row['rejection_reason'] or 'Not specified'}"}), 403

    return _auth_response(row)



@auth_bp.route("/face-login", methods=["POST"])
@rate_limit("face-login", limit=10, window_seconds=300)
def face_login():
    data = _request_json()
    live_capture = data.get("live_capture")
    angle_samples = _parse_angle_samples(data.get("angle_samples"))
    if not live_capture:
        return jsonify({"error": "A live face capture is required for face sign-in."}), 400

    db = get_db()
    ip_address = _client_ip()
    attempt_key = "face_login_v2"
    try:
        attempt = _get_login_attempt(db, attempt_key, ip_address)
        if _is_login_blocked(attempt):
            return (
                jsonify(
                    {
                        "error": f"Too many failed face sign-in attempts. Try again after {FACE_LOGIN_BLOCK_MINUTES} minutes."
                    }
                ),
                429,
            )

        try:
            row, score, threshold, alternate_score = _resolve_face_login_match(
                db,
                live_capture,
                angle_samples=angle_samples,
            )
        except FaceVerificationError as exc:
            _record_failed_login(
                db,
                attempt_key,
                ip_address,
                failure_limit=FACE_LOGIN_FAILURE_LIMIT,
                block_minutes=FACE_LOGIN_BLOCK_MINUTES,
            )
            db.commit()
            return jsonify({"error": str(exc)}), 401

        _clear_login_attempt(db, attempt_key, ip_address)
        db.commit()
    finally:
        db.close()

    return _auth_response(
        row,
        {
            "score": round(float(score), 4),
            "threshold": round(float(threshold), 4),
            "alternate_score": round(float(alternate_score or 0.0), 4),
            "message": "Face verified successfully.",
        },
    )


@auth_bp.route("/admin-login", methods=["POST"])
@rate_limit("admin-login", limit=8, window_seconds=900)
def admin_login():
    data = _request_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    totp_code = (data.get("totp") or "").strip()

    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND role IN ('admin','super_admin')",
        (username,),
    ).fetchone()
    db.close()

    if not row or not check_password(password, row["password_hash"]):
        return jsonify({"error": "Invalid admin credentials"}), 401

    settings = get_settings()
    totp_secret = row["admin_totp_secret"] or settings.admin_totp_secret
    if settings.require_admin_totp and totp_secret:
        # TOTP required AND secret is configured — verify the code
        if not verify_totp_code(totp_secret, totp_code):
            return jsonify({"error": "Invalid two-factor authentication code"}), 401
    elif not settings.allow_local_admin_totp_bypass and totp_secret and totp_code:
        # TOTP not required, but secret exists and a code was provided — verify it
        if not verify_totp_code(totp_secret, totp_code):
            return jsonify({"error": "Invalid two-factor authentication code"}), 401

    return _auth_response(row)


@auth_bp.route("/send-otp", methods=["POST"])
@rate_limit("send-otp", limit=6, window_seconds=900)
def send_otp():
    email = normalize_email(_request_json().get("email"))
    if not email:
        return jsonify({"error": "Email required"}), 400
    limited = enforce_rate_limit("send-otp-email", limit=3, window_seconds=900, key_value=email)
    if limited:
        return limited
    limited = enforce_rate_limit("send-otp-ip", limit=10, window_seconds=900, key_value=_client_ip())
    if limited:
        return limited
    code = str(secrets.randbelow(900000) + 100000)
    settings = get_settings()
    expires = plus_interval(seconds=settings.otp_ttl_seconds)
    code_hash = _hash_otp(email, code)
    db = get_db()
    try:
        existing_user = db.execute("SELECT id, is_verified FROM users WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()
        if existing_user and (_is_verified_user(existing_user) or (existing_user["role"] or "student") != "student"):
            return _duplicate_email_response(existing_user, intended_role="student")
    finally:
        db.close()
    body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e8eaed; border-radius: 8px;">
          <h2 style="color: #1a6b3c; text-align: center;">EPSA Verification Code</h2>
          <p>Hello,</p>
          <p>Thank you for initiating a secure process with the Ethiopian Psychology Students' Association.</p>
          <p>Your email verification code is:</p>
          <div style="background: #1a6b3c; color: white; font-size: 28px; font-weight: bold; text-align: center; padding: 15px; border-radius: 8px; margin: 20px 0; letter-spacing: 6px;">
            {code}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="font-size: 0.8rem; color: #777; margin-top: 30px; text-align: center;">
            Securely generated by the EPSA Digital Platform. DO NOT share this code.
          </p>
        </div>
      </body>
    </html>
    """

    expose_otp = bool(settings.show_otp_in_response)
    if expose_otp:
        logger.warning("[DEV OTP] email=%s otp=%s", _mask_email(email), code)
    else:
        delivered = send_email(email, "EPSA Secure Verification Code", body)
        if not delivered:
            # Temporary production fallback: if email delivery fails, still allow
            # registration flow by returning the OTP directly.
            expose_otp = True
            logger.warning("[OTP FALLBACK] Email send failed, exposing OTP for %s", _mask_email(email))

    db = get_db()
    try:
        db.execute(
            "UPDATE otp_store SET used=1, used_at=? WHERE email=? AND used=0",
            (utcnow(), email),
        )
        db.execute(
            "INSERT INTO otp_store (email,code,code_hash,expires_at) VALUES (?,?,?,?)",
            (email, code_hash, code_hash, expires),
        )
        db.commit()
    finally:
        db.close()

    if expose_otp:
        return jsonify(
            {
                "success": True,
                "message": "OTP generated successfully",
                "otp": code,
                "email_failed": not settings.show_otp_in_response,
            }
        )
    return jsonify({"message": "OTP sent"})


@auth_bp.route("/verify-otp", methods=["POST"])
@rate_limit("verify-otp", limit=10, window_seconds=900)
def verify_otp():
    data = _request_json()
    email = normalize_email(data.get("email"))
    code = data.get("code", "").strip()
    limited = enforce_rate_limit("verify-otp-email", limit=8, window_seconds=900, key_value=email)
    if limited:
        return limited
    limited = enforce_rate_limit("verify-otp-ip", limit=20, window_seconds=900, key_value=_client_ip())
    if limited:
        return limited
    db = get_db()
    row = db.execute(
        """
        SELECT *
        FROM otp_store
        WHERE email=?
          AND (code_hash=? OR code=? OR code=?)
          AND used=0
          AND expires_at > ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (email, _hash_otp(email, code), _hash_otp(email, code), code, utcnow()),
    ).fetchone()
    if not row:
        db.close()
        return jsonify({"error": "Invalid or expired code"}), 400
    db.execute("UPDATE otp_store SET used=1, used_at=? WHERE id=?", (utcnow(), row["id"]))
    verification_token = issue_one_time_token(
        db,
        subject=email,
        purpose="registration_otp",
        ttl_seconds=get_settings().otp_proof_ttl_seconds,
    )
    db.commit()
    db.close()
    return jsonify({"message": "Email verified", "verification_token": verification_token})


@auth_bp.route("/forgot-password", methods=["POST"])
@rate_limit("forgot-password", limit=5, window_seconds=3600)
def forgot_password():
    email = normalize_email(_request_json().get("email"))
    if not email:
        return jsonify({"error": "Email required"}), 400

    db = get_db()
    try:
        user = db.execute("SELECT id, email, first_name FROM users WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()
        if user:
            reset_token = issue_one_time_token(
                db,
                subject=email,
                purpose="password_reset",
                ttl_seconds=get_settings().password_reset_ttl_seconds,
                metadata={"user_id": user["id"]},
            )
            db.commit()

            reset_url_base = get_settings().password_reset_url.rstrip("/")
            joiner = "&" if "?" in reset_url_base else "?"
            reset_url = f"{reset_url_base}{joiner}reset_token={reset_token}"
            body = f"""
            <html>
              <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e8eaed; border-radius: 8px;">
                  <h2 style="color: #1a6b3c; text-align: center;">EPSA Password Reset</h2>
                  <p>Hello {user['first_name'] or 'there'},</p>
                  <p>We received a request to reset your EPSA password.</p>
                  <p><a href="{reset_url}" style="background:#1a6b3c;color:white;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset your password</a></p>
                  <p>This link will expire automatically. If you did not request a reset, you can safely ignore this email.</p>
                </div>
              </body>
            </html>
            """
            delivered = send_email(email, "EPSA Password Reset", body)
            if not delivered:
                print(f"[Password Reset] Email delivery failed for {_mask_email(email)}")
    finally:
        db.close()

    return jsonify({"message": "If that email exists in EPSA, a reset link has been sent."})


@auth_bp.route("/reset-password", methods=["POST"])
@rate_limit("reset-password", limit=8, window_seconds=3600)
def reset_password():
    data = _request_json()
    token = (data.get("token") or "").strip()
    password = data.get("password", "")
    if not token or not password:
        return jsonify({"error": "Reset token and new password are required."}), 400
    if not password_is_strong(password):
        return jsonify(
            {
                "error": "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
            }
        ), 400

    db = get_db()
    try:
        token_row = consume_one_time_token(db, token=token, purpose="password_reset")
        if not token_row:
            return jsonify({"error": "Reset link is invalid or has expired."}), 400
        db.execute(
            "UPDATE users SET password_hash=? WHERE LOWER(email)=LOWER(?)",
            (hash_password(password), token_row["subject"]),
        )
        db.commit()
    finally:
        db.close()

    return jsonify({"message": "Password updated successfully. You can now sign in."})


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    uid = get_jwt_identity()
    db = get_db()
    row = db.execute(
        """
        SELECT u.*,
               CASE WHEN fe.id IS NOT NULL AND fe.registration_verified = 1 THEN 1 ELSE 0 END AS face_registered
        FROM users u
        LEFT JOIN face_embeddings fe ON fe.user_id = u.id
        WHERE u.id=?
        """,
        (uid,),
    ).fetchone()
    db.close()
    if not row:
        return jsonify({"error": "User not found"}), 404
    user = dict(row)
    user.pop("password_hash", None)
    return jsonify(user)
