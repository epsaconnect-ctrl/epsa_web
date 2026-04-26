"""
EPSA Platform â€” Database Models & Schema
"""
from config import get_settings
from db import connect
from werkzeug.security import generate_password_hash

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE,
    password_hash   TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    father_name     TEXT NOT NULL,
    grandfather_name TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    phone           TEXT,
    university      TEXT,
    program_type    TEXT,
    academic_year   TEXT,
    field_of_study  TEXT,
    graduation_year INTEGER,
    profile_photo   TEXT,
    reg_slip        TEXT,
    role            TEXT DEFAULT 'student',
    status          TEXT DEFAULT 'pending',
    student_id      TEXT UNIQUE,
    bio             TEXT,
    linkedin        TEXT,
    admin_totp_secret TEXT,
    graduation_status TEXT DEFAULT 'active_student',
    graduation_verified_at DATETIME,
    rejection_reason TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at     DATETIME
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier      TEXT NOT NULL,
    ip_address      TEXT,
    failed_count    INTEGER DEFAULT 0,
    last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    blocked_until   DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(identifier, ip_address)
);

CREATE TABLE IF NOT EXISTS face_embeddings (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL REFERENCES users(id),
    embedding               TEXT NOT NULL,
    angle_embeddings        TEXT,
    engine                  TEXT DEFAULT 'privacy_signature_v1',
    reference_image_hash    TEXT,
    match_threshold         REAL DEFAULT 0.50,
    registration_verified   INTEGER DEFAULT 0,
    registration_score      REAL,
    registration_verified_at DATETIME,
    last_exam_score         REAL,
    last_exam_verified_at   DATETIME,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS trainings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    format      TEXT DEFAULT 'online',
    price       REAL DEFAULT 0,
    is_free     INTEGER DEFAULT 1,
    icon        TEXT DEFAULT 'ðŸŽ“',
    cert_title  TEXT,
    cert_desc   TEXT,
    content_url TEXT,
    graphic_design TEXT,
    graphic_caption TEXT,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    training_id INTEGER NOT NULL REFERENCES trainings(id),
    status      TEXT DEFAULT 'applied',
    receipt_path TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at  DATETIME,
    verified_by  INTEGER REFERENCES users(id),
    UNIQUE(user_id, training_id)
);

CREATE TABLE IF NOT EXISTS voting_phases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phase_number INTEGER DEFAULT 1,
    title       TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER DEFAULT 0,
    starts_at   DATETIME,
    ends_at     DATETIME,
    status      TEXT DEFAULT 'not_started'
);

CREATE TABLE IF NOT EXISTS nominations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    phase_id    INTEGER NOT NULL REFERENCES voting_phases(id),
    position    TEXT,
    bio         TEXT,
    statement   TEXT,
    vision      TEXT,
    manifesto_path TEXT,
    video_url   TEXT,
    video_path  TEXT,
    is_approved INTEGER DEFAULT 0,
    nominated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, phase_id)
);

CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id    INTEGER NOT NULL REFERENCES users(id),
    candidate_id INTEGER NOT NULL REFERENCES users(id),
    phase_id    INTEGER NOT NULL REFERENCES voting_phases(id),
    voted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(voter_id, phase_id)
);

CREATE TABLE IF NOT EXISTS election_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    position    TEXT NOT NULL,
    position_rank INTEGER DEFAULT 99,
    is_active   INTEGER DEFAULT 1,
    elected_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executive_committee_members (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    source_nomination_id INTEGER REFERENCES nominations(id),
    source_phase_id     INTEGER REFERENCES voting_phases(id),
    governance_origin   TEXT DEFAULT 'national_election',
    vote_count          INTEGER DEFAULT 0,
    vote_rank           INTEGER DEFAULT 999,
    assigned_role       TEXT,
    status              TEXT DEFAULT 'active',
    is_top_three        INTEGER DEFAULT 0,
    is_role_locked      INTEGER DEFAULT 0,
    term_start          DATETIME DEFAULT CURRENT_TIMESTAMP,
    term_end            DATETIME,
    decision_reference  TEXT,
    decision_document_path TEXT,
    engagement_status   TEXT DEFAULT 'active',
    engagement_notes    TEXT,
    performance_flag    TEXT,
    eligibility_status  TEXT DEFAULT 'eligible',
    midterm_status      TEXT DEFAULT 'pending',
    midterm_notified_at DATETIME,
    handover_status     TEXT DEFAULT 'not_required',
    removed_reason      TEXT,
    removed_at          DATETIME,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nrc_members (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    university          TEXT NOT NULL,
    source_result_id    INTEGER REFERENCES election_results(id),
    status              TEXT DEFAULT 'active',
    eligibility_status  TEXT DEFAULT 'eligible',
    is_primary          INTEGER DEFAULT 1,
    term_start          DATETIME DEFAULT CURRENT_TIMESTAMP,
    term_end            DATETIME,
    midterm_status      TEXT DEFAULT 'pending',
    midterm_notified_at DATETIME,
    last_activity_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    inactivity_flag     TEXT,
    activation_reference TEXT,
    removal_reason      TEXT,
    removed_at          DATETIME,
    handover_status     TEXT DEFAULT 'not_required',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, university)
);

CREATE TABLE IF NOT EXISTS nrc_documents (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nrc_member_id       INTEGER NOT NULL REFERENCES nrc_members(id),
    title               TEXT NOT NULL,
    document_type       TEXT DEFAULT 'report',
    summary             TEXT,
    file_path           TEXT,
    submitted_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nrc_audit_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id       INTEGER REFERENCES users(id),
    nrc_member_id       INTEGER REFERENCES nrc_members(id),
    action_type         TEXT NOT NULL,
    details             TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS governance_election_cycles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    body_type           TEXT NOT NULL,
    cycle_type          TEXT DEFAULT 'mid_term',
    scope_type          TEXT DEFAULT 'all',
    scope_value         TEXT,
    related_member_id   INTEGER,
    related_role        TEXT,
    status              TEXT DEFAULT 'scheduled',
    triggered_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    opens_at            DATETIME,
    closes_at           DATETIME,
    result_reference    TEXT,
    notes               TEXT
);

CREATE TABLE IF NOT EXISTS executive_decisions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_type       TEXT NOT NULL,
    member_id           INTEGER REFERENCES executive_committee_members(id),
    target_user_id      INTEGER REFERENCES users(id),
    vacancy_id          INTEGER,
    reference_code      TEXT NOT NULL,
    notes               TEXT,
    decision_document_path TEXT,
    issued_by           INTEGER REFERENCES users(id),
    issued_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executive_role_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id           INTEGER NOT NULL REFERENCES executive_committee_members(id),
    old_role            TEXT,
    new_role            TEXT,
    change_type         TEXT DEFAULT 'assignment',
    decision_id         INTEGER REFERENCES executive_decisions(id),
    changed_by          INTEGER REFERENCES users(id),
    changed_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executive_vacancies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    previous_member_id  INTEGER REFERENCES executive_committee_members(id),
    role_name           TEXT NOT NULL,
    reason              TEXT,
    decision_reference  TEXT NOT NULL,
    decision_document_path TEXT,
    resolution_path     TEXT DEFAULT 'pending',
    status              TEXT DEFAULT 'open',
    replacement_member_id INTEGER REFERENCES executive_committee_members(id),
    created_by          INTEGER REFERENCES users(id),
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at         DATETIME
);

CREATE TABLE IF NOT EXISTS executive_role_interest (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    vacancy_id          INTEGER NOT NULL REFERENCES executive_vacancies(id),
    member_id           INTEGER NOT NULL REFERENCES executive_committee_members(id),
    statement           TEXT,
    expressed_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vacancy_id, member_id)
);

CREATE TABLE IF NOT EXISTS executive_vacancy_elections (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    vacancy_id          INTEGER NOT NULL REFERENCES executive_vacancies(id),
    position_name       TEXT NOT NULL,
    status              TEXT DEFAULT 'draft',
    eligible_group      TEXT DEFAULT 'nrc',
    result_reference    TEXT,
    winner_user_id      INTEGER REFERENCES users(id),
    winner_vote_count   INTEGER DEFAULT 0,
    started_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at            DATETIME
);

CREATE TABLE IF NOT EXISTS executive_notifications (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id           INTEGER REFERENCES executive_committee_members(id),
    recipient_user_id   INTEGER REFERENCES users(id),
    audience            TEXT DEFAULT 'member',
    title               TEXT NOT NULL,
    body                TEXT,
    is_read             INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executive_audit_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id       INTEGER REFERENCES users(id),
    action_type         TEXT NOT NULL,
    member_id           INTEGER REFERENCES executive_committee_members(id),
    target_user_id      INTEGER REFERENCES users(id),
    details             TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executive_handover_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id           INTEGER NOT NULL REFERENCES executive_committee_members(id),
    item_title          TEXT NOT NULL,
    item_status         TEXT DEFAULT 'pending',
    notes               TEXT,
    completed_at        DATETIME,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    duration_mins INTEGER DEFAULT 60,
    scheduled_at DATETIME,
    is_active   INTEGER DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_face_verifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id         INTEGER NOT NULL REFERENCES exams(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    status          TEXT DEFAULT 'approved',
    score           REAL,
    threshold       REAL,
    engine          TEXT DEFAULT 'privacy_signature_v1',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id     INTEGER NOT NULL REFERENCES exams(id),
    question    TEXT NOT NULL,
    option_a    TEXT,
    option_b    TEXT,
    option_c    TEXT,
    option_d    TEXT,
    correct_idx INTEGER NOT NULL,
    order_num   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exam_submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id     INTEGER NOT NULL REFERENCES exams(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    answers     TEXT,
    score       REAL,
    status      TEXT DEFAULT 'in_progress',
    started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    progress_count INTEGER DEFAULT 0,
    submitted_at DATETIME,
    review_status TEXT DEFAULT 'pending',
    reviewed_at DATETIME,
    reviewed_by INTEGER REFERENCES users(id),
    UNIQUE(exam_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id   INTEGER NOT NULL REFERENCES users(id),
    text        TEXT NOT NULL,
    is_read     INTEGER DEFAULT 0,
    sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    connected_id INTEGER NOT NULL REFERENCES users(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, connected_id)
);

CREATE TABLE IF NOT EXISTS otp_store (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    code        TEXT NOT NULL,
    expires_at  DATETIME NOT NULL,
    used        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject     TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME,
    metadata    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_key       TEXT NOT NULL UNIQUE,
    request_count    INTEGER DEFAULT 0,
    window_starts_at DATETIME NOT NULL,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS news_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    category    TEXT DEFAULT 'News',
    excerpt     TEXT,
    content     TEXT,
    image_path  TEXT,
    is_featured INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leadership_profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    position    TEXT NOT NULL,
    hierarchy   TEXT DEFAULT 'NEB',
    profile_photo TEXT,
    bio         TEXT,
    role_description TEXT,
    linked_user_id INTEGER,
    term_start  DATETIME,
    term_end    DATETIME,
    is_active   INTEGER DEFAULT 1,
    order_num   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clubs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    university      TEXT NOT NULL,
    year_established INTEGER,
    logo_path       TEXT,
    status          TEXT DEFAULT 'pending',
    description     TEXT,
    member_count    INTEGER DEFAULT 0,
    president_id    INTEGER REFERENCES users(id),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id     INTEGER NOT NULL REFERENCES clubs(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    role        TEXT DEFAULT 'member',
    joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, user_id)
);

CREATE TABLE IF NOT EXISTS club_leadership (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id     INTEGER NOT NULL REFERENCES clubs(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS partners (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT DEFAULT 'NGO',
    logo_path   TEXT,
    description TEXT,
    website     TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_gallery (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id  INTEGER NOT NULL REFERENCES partners(id),
    image_path  TEXT NOT NULL,
    caption     TEXT,
    order_num   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id         INTEGER NOT NULL REFERENCES clubs(id),
    title           TEXT NOT NULL,
    objective       TEXT,
    budget          REAL DEFAULT 0,
    timeline        TEXT,
    status          TEXT DEFAULT 'pending',
    attachment_path TEXT,
    admin_notes     TEXT,
    submitted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at     DATETIME
);

CREATE TABLE IF NOT EXISTS financial_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id     INTEGER NOT NULL REFERENCES proposals(id),
    club_id         INTEGER NOT NULL REFERENCES clubs(id),
    receipt_path    TEXT,
    expense_details TEXT,
    total_spent     REAL DEFAULT 0,
    status          TEXT DEFAULT 'pending',
    submitted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at     DATETIME,
    verified_by     INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS grant_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    sponsor_name    TEXT NOT NULL,
    sponsor_type    TEXT DEFAULT 'individual',
    partner_id      INTEGER REFERENCES partners(id),
    amount_committed REAL DEFAULT 0,
    amount_received REAL DEFAULT 0,
    status          TEXT DEFAULT 'active',
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    received_at     DATETIME
);

CREATE TABLE IF NOT EXISTS network_posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    club_id     INTEGER REFERENCES clubs(id),
    content     TEXT NOT NULL,
    image_path  TEXT,
    post_type   TEXT DEFAULT 'student',
    likes       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS network_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES network_posts(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_likes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES network_posts(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_lookup_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_lookup_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_lookup_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_lookup_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_voting_phases_state ON voting_phases(phase_number, status, is_active);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(identifier, ip_address);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_user ON face_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_face_verifications_lookup ON exam_face_verifications(exam_id, user_id, created_at);
"""

SEED_DATA = """
"""

def get_db():
    return connect()

def init_db():
    settings = get_settings()
    db = get_db()
    db.executescript(SCHEMA)
    try:
        count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0 and settings.enable_dev_seed:
            db.executescript(SEED_DATA)
            print('[DB] Initial seed data inserted')
    except Exception as e:
        print('[DB seed warning]', e)
    db.commit()
    db.close()
    print('[DB] EPSA database initialized at', settings.database_url)


def ensure_bootstrap_admin():
    settings = get_settings()
    username = settings.bootstrap_admin_username
    password = settings.bootstrap_admin_password
    if not username or not password:
        return

    db = get_db()
    try:
        lookup_email = settings.bootstrap_admin_email or f"{username}@local.epsa"
        existing = db.execute(
            "SELECT id, role FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)",
            (username, lookup_email),
        ).fetchone()
        if existing:
            if existing["role"] in {"admin", "super_admin"}:
                db.execute(
                    """
                    UPDATE users
                    SET password_hash=?, email=?, status='approved', admin_totp_secret=COALESCE(?, admin_totp_secret)
                    WHERE id=?
                    """,
                    (
                        generate_password_hash(password),
                        lookup_email,
                        settings.bootstrap_admin_totp_secret,
                        existing["id"],
                    ),
                )
                db.commit()
                print(f"[Bootstrap] Refreshed bootstrap admin credentials for '{username}'.")
            return

        db.execute(
            """
            INSERT INTO users (
                username, password_hash, first_name, father_name, grandfather_name,
                email, role, status, admin_totp_secret
            )
            VALUES (?, ?, ?, ?, ?, ?, 'super_admin', 'approved', ?)
            """,
            (
                username,
                generate_password_hash(password),
                settings.bootstrap_admin_first_name,
                settings.bootstrap_admin_father_name,
                ".",
                lookup_email,
                settings.bootstrap_admin_totp_secret,
            ),
        )
        db.commit()
        print(f"[Bootstrap] Created bootstrap super admin '{username}'.")
    finally:
        db.close()

def migrate_db():
    """Run safe migrations to evolve the schema without losing data."""
    db = get_db()
    migrations = [
        "ALTER TABLE exams ADD COLUMN results_released INTEGER DEFAULT 0",
        "ALTER TABLE exam_questions ADD COLUMN option_d TEXT",
        "ALTER TABLE exam_questions ADD COLUMN order_num INTEGER DEFAULT 0",
        "ALTER TABLE exam_submissions ADD COLUMN status TEXT DEFAULT 'in_progress'",
        "ALTER TABLE exam_submissions ADD COLUMN last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE exam_submissions ADD COLUMN progress_count INTEGER DEFAULT 0",
        "ALTER TABLE exam_submissions ADD COLUMN review_status TEXT DEFAULT 'pending'",
        "ALTER TABLE exam_submissions ADD COLUMN reviewed_at DATETIME",
        "ALTER TABLE exam_submissions ADD COLUMN reviewed_by INTEGER REFERENCES users(id)",
        "ALTER TABLE voting_phases ADD COLUMN status TEXT DEFAULT 'not_started'",
        """CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identifier TEXT NOT NULL,
            ip_address TEXT,
            failed_count INTEGER DEFAULT 0,
            last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            blocked_until DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(identifier, ip_address)
        )""",
        """CREATE TABLE IF NOT EXISTS face_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            embedding TEXT NOT NULL,
            angle_embeddings TEXT,
            engine TEXT DEFAULT 'privacy_signature_v1',
            reference_image_hash TEXT,
            match_threshold REAL DEFAULT 0.50,
            registration_verified INTEGER DEFAULT 0,
            registration_score REAL,
            registration_verified_at DATETIME,
            last_exam_score REAL,
            last_exam_verified_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id)
        )""",
        """CREATE TABLE IF NOT EXISTS exam_face_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT DEFAULT 'approved',
            score REAL,
            threshold REAL,
            engine TEXT DEFAULT 'privacy_signature_v1',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE INDEX IF NOT EXISTS idx_users_lookup_username ON users(username)""",
        """CREATE INDEX IF NOT EXISTS idx_users_lookup_email ON users(email)""",
        """CREATE INDEX IF NOT EXISTS idx_users_lookup_phone ON users(phone)""",
        """CREATE INDEX IF NOT EXISTS idx_users_lookup_student_id ON users(student_id)""",
        """CREATE INDEX IF NOT EXISTS idx_voting_phases_state ON voting_phases(phase_number, status, is_active)""",
        """CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(identifier, ip_address)""",
        """CREATE INDEX IF NOT EXISTS idx_face_embeddings_user ON face_embeddings(user_id)""",
        """CREATE INDEX IF NOT EXISTS idx_exam_face_verifications_lookup ON exam_face_verifications(exam_id, user_id, created_at)""",
        "ALTER TABLE users ADD COLUMN admin_totp_secret TEXT",
        "ALTER TABLE nominations ADD COLUMN statement TEXT",
        "ALTER TABLE nominations ADD COLUMN vision TEXT",
        "ALTER TABLE nominations ADD COLUMN manifesto_path TEXT",
        "ALTER TABLE nominations ADD COLUMN video_url TEXT",
        "ALTER TABLE nominations ADD COLUMN video_path TEXT",
        "ALTER TABLE face_embeddings ADD COLUMN angle_embeddings TEXT",
        """CREATE TABLE IF NOT EXISTS auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            purpose TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            used_at DATETIME,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS rate_limit_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bucket_key TEXT NOT NULL UNIQUE,
            request_count INTEGER DEFAULT 0,
            window_starts_at DATETIME NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS news_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            category    TEXT DEFAULT 'News',
            excerpt     TEXT,
            content     TEXT,
            image_path  TEXT,
            is_featured INTEGER DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS leadership_profiles (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            position    TEXT NOT NULL,
            hierarchy   TEXT DEFAULT 'NEB',
            profile_photo TEXT,
            bio         TEXT,
            is_active   INTEGER DEFAULT 1,
            order_num   INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS clubs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, university TEXT NOT NULL,
            year_established INTEGER, logo_path TEXT, status TEXT DEFAULT 'pending',
            description TEXT, member_count INTEGER DEFAULT 0, president_id INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS club_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL REFERENCES clubs(id),
            user_id INTEGER NOT NULL REFERENCES users(id), role TEXT DEFAULT 'member',
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(club_id, user_id)
        )""",
        """CREATE TABLE IF NOT EXISTS partners (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT DEFAULT 'NGO',
            logo_path TEXT, description TEXT, website TEXT,
            is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS partner_gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER NOT NULL REFERENCES partners(id),
            image_path TEXT NOT NULL, caption TEXT, order_num INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL REFERENCES clubs(id),
            title TEXT NOT NULL, objective TEXT, budget REAL DEFAULT 0, timeline TEXT,
            status TEXT DEFAULT 'pending', attachment_path TEXT, admin_notes TEXT,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS financial_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id INTEGER NOT NULL REFERENCES proposals(id),
            club_id INTEGER NOT NULL REFERENCES clubs(id), receipt_path TEXT, expense_details TEXT,
            total_spent REAL DEFAULT 0, status TEXT DEFAULT 'pending',
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, verified_at DATETIME, verified_by INTEGER REFERENCES users(id)
        )""",
        """CREATE TABLE IF NOT EXISTS network_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
            club_id INTEGER REFERENCES clubs(id), content TEXT NOT NULL, image_path TEXT,
            post_type TEXT DEFAULT 'student', likes INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS network_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES network_posts(id),
            user_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS post_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES network_posts(id),
            user_id INTEGER NOT NULL REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id)
        )""",
        # â”€â”€ PHASE 2 ADDITIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        """CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            connected_id INTEGER NOT NULL REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, connected_id)
        )""",
        """CREATE TABLE IF NOT EXISTS club_leadership (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            role TEXT NOT NULL,
            appointed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(club_id, user_id)
        )""",
        """CREATE TABLE IF NOT EXISTS club_follows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            followed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, club_id)
        )""",
        """CREATE TABLE IF NOT EXISTS club_activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            posted_by INTEGER NOT NULL REFERENCES users(id),
            activity_type TEXT DEFAULT 'announcement',
            title TEXT NOT NULL,
            content TEXT,
            image_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS epsa_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """INSERT OR IGNORE INTO epsa_settings (key, value) VALUES ('grant_pool_total', '500000')""",
        """INSERT OR IGNORE INTO epsa_settings (key, value) VALUES ('grant_pool_description', 'EPSA National Grant Pool 2026')""",
        """ALTER TABLE clubs ADD COLUMN vp_id INTEGER REFERENCES users(id)""",
        """ALTER TABLE clubs ADD COLUMN secretary_id INTEGER REFERENCES users(id)""",
        """ALTER TABLE clubs ADD COLUMN impact TEXT""",
        """ALTER TABLE proposals ADD COLUMN impact TEXT""",
        """ALTER TABLE network_posts ADD COLUMN shares INTEGER DEFAULT 0""",
        # â”€â”€ PHASE 3 ADDITIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        """CREATE TABLE IF NOT EXISTS club_join_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT DEFAULT 'pending',
            requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reviewed_at DATETIME,
            UNIQUE(club_id, user_id)
        )""",
        """CREATE TABLE IF NOT EXISTS support_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            request_type TEXT DEFAULT 'funding',
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            admin_response TEXT,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reviewed_at DATETIME
        )""",
        """ALTER TABLE partners ADD COLUMN partnership_type TEXT DEFAULT 'Strategic'""",
        """ALTER TABLE partners ADD COLUMN what_they_do TEXT""",
        """ALTER TABLE clubs ADD COLUMN is_active INTEGER DEFAULT 1""",
        """ALTER TABLE proposals ADD COLUMN funded_amount REAL DEFAULT 0""",
        """ALTER TABLE financial_reports ADD COLUMN admin_notes TEXT""",
        """ALTER TABLE users ADD COLUMN graduation_status TEXT DEFAULT 'active_student'""",
        """ALTER TABLE users ADD COLUMN graduation_verified_at DATETIME""",
        """ALTER TABLE executive_committee_members ADD COLUMN eligibility_status TEXT DEFAULT 'eligible'""",
        """ALTER TABLE executive_committee_members ADD COLUMN midterm_status TEXT DEFAULT 'pending'""",
        """ALTER TABLE executive_committee_members ADD COLUMN midterm_notified_at DATETIME""",
        """ALTER TABLE leadership_profiles ADD COLUMN role_description TEXT""",
        """ALTER TABLE leadership_profiles ADD COLUMN linked_user_id INTEGER""",
        """ALTER TABLE leadership_profiles ADD COLUMN term_start DATETIME""",
        """ALTER TABLE leadership_profiles ADD COLUMN term_end DATETIME""",
        """CREATE TABLE IF NOT EXISTS grant_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sponsor_name TEXT NOT NULL,
            sponsor_type TEXT DEFAULT 'individual',
            partner_id INTEGER REFERENCES partners(id),
            amount_committed REAL DEFAULT 0,
            amount_received REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            received_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS executive_committee_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            source_nomination_id INTEGER REFERENCES nominations(id),
            source_phase_id INTEGER REFERENCES voting_phases(id),
            governance_origin TEXT DEFAULT 'national_election',
            vote_count INTEGER DEFAULT 0,
            vote_rank INTEGER DEFAULT 999,
            assigned_role TEXT,
            status TEXT DEFAULT 'active',
            is_top_three INTEGER DEFAULT 0,
            is_role_locked INTEGER DEFAULT 0,
            term_start DATETIME DEFAULT CURRENT_TIMESTAMP,
            term_end DATETIME,
            decision_reference TEXT,
            decision_document_path TEXT,
            engagement_status TEXT DEFAULT 'active',
            engagement_notes TEXT,
            performance_flag TEXT,
            eligibility_status TEXT DEFAULT 'eligible',
            midterm_status TEXT DEFAULT 'pending',
            midterm_notified_at DATETIME,
            handover_status TEXT DEFAULT 'not_required',
            removed_reason TEXT,
            removed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS executive_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_type TEXT NOT NULL,
            member_id INTEGER REFERENCES executive_committee_members(id),
            target_user_id INTEGER REFERENCES users(id),
            vacancy_id INTEGER,
            reference_code TEXT NOT NULL,
            notes TEXT,
            decision_document_path TEXT,
            issued_by INTEGER REFERENCES users(id),
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS executive_role_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES executive_committee_members(id),
            old_role TEXT,
            new_role TEXT,
            change_type TEXT DEFAULT 'assignment',
            decision_id INTEGER REFERENCES executive_decisions(id),
            changed_by INTEGER REFERENCES users(id),
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS executive_vacancies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            previous_member_id INTEGER REFERENCES executive_committee_members(id),
            role_name TEXT NOT NULL,
            reason TEXT,
            decision_reference TEXT NOT NULL,
            decision_document_path TEXT,
            resolution_path TEXT DEFAULT 'pending',
            status TEXT DEFAULT 'open',
            replacement_member_id INTEGER REFERENCES executive_committee_members(id),
            created_by INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS executive_role_interest (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_id INTEGER NOT NULL REFERENCES executive_vacancies(id),
            member_id INTEGER NOT NULL REFERENCES executive_committee_members(id),
            statement TEXT,
            expressed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(vacancy_id, member_id)
        )""",
        """CREATE TABLE IF NOT EXISTS executive_vacancy_elections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_id INTEGER NOT NULL REFERENCES executive_vacancies(id),
            position_name TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            eligible_group TEXT DEFAULT 'nrc',
            result_reference TEXT,
            winner_user_id INTEGER REFERENCES users(id),
            winner_vote_count INTEGER DEFAULT 0,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS executive_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES executive_committee_members(id),
            recipient_user_id INTEGER REFERENCES users(id),
            audience TEXT DEFAULT 'member',
            title TEXT NOT NULL,
            body TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS executive_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER REFERENCES users(id),
            action_type TEXT NOT NULL,
            member_id INTEGER REFERENCES executive_committee_members(id),
            target_user_id INTEGER REFERENCES users(id),
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS executive_handover_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES executive_committee_members(id),
            item_title TEXT NOT NULL,
            item_status TEXT DEFAULT 'pending',
            notes TEXT,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS nrc_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            university TEXT NOT NULL,
            source_result_id INTEGER REFERENCES election_results(id),
            status TEXT DEFAULT 'active',
            eligibility_status TEXT DEFAULT 'eligible',
            is_primary INTEGER DEFAULT 1,
            term_start DATETIME DEFAULT CURRENT_TIMESTAMP,
            term_end DATETIME,
            midterm_status TEXT DEFAULT 'pending',
            midterm_notified_at DATETIME,
            last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            inactivity_flag TEXT,
            activation_reference TEXT,
            removal_reason TEXT,
            removed_at DATETIME,
            handover_status TEXT DEFAULT 'not_required',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, university)
        )""",
        """CREATE TABLE IF NOT EXISTS nrc_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nrc_member_id INTEGER NOT NULL REFERENCES nrc_members(id),
            title TEXT NOT NULL,
            document_type TEXT DEFAULT 'report',
            summary TEXT,
            file_path TEXT,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS nrc_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER REFERENCES users(id),
            nrc_member_id INTEGER REFERENCES nrc_members(id),
            action_type TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS governance_election_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            body_type TEXT NOT NULL,
            cycle_type TEXT DEFAULT 'mid_term',
            scope_type TEXT DEFAULT 'all',
            scope_value TEXT,
            related_member_id INTEGER,
            related_role TEXT,
            status TEXT DEFAULT 'scheduled',
            triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            opens_at DATETIME,
            closes_at DATETIME,
            result_reference TEXT,
            notes TEXT
        )""",
        "ALTER TABLE exams ADD COLUMN passing_score REAL DEFAULT 60",
        "ALTER TABLE exam_submissions ADD COLUMN passed INTEGER DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS network_follows (
            follower_id INTEGER NOT NULL REFERENCES users(id),
            followee_id INTEGER NOT NULL REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (follower_id, followee_id)
        )""",
        # â”€â”€ TEACHER & QUESTION BANK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        """ALTER TABLE users ADD COLUMN specialization TEXT""",
        """ALTER TABLE users ADD COLUMN institution TEXT""",
        """ALTER TABLE users ADD COLUMN years_of_experience INTEGER DEFAULT 0""",
        """ALTER TABLE users ADD COLUMN credentials TEXT""",
        """CREATE TABLE IF NOT EXISTS question_bank (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            submitted_by        INTEGER NOT NULL REFERENCES users(id),
            subject_category    TEXT NOT NULL,
            topic               TEXT,
            subtopic            TEXT,
            bloom_level         TEXT DEFAULT 'Remembering',
            difficulty          TEXT DEFAULT 'medium',
            difficulty_auto     TEXT,
            question_text       TEXT NOT NULL,
            option_a            TEXT NOT NULL,
            option_b            TEXT NOT NULL,
            option_c            TEXT NOT NULL,
            option_d            TEXT NOT NULL,
            correct_idx         INTEGER NOT NULL,
            explanation         TEXT,
            status              TEXT DEFAULT 'pending',
            admin_notes         TEXT,
            reviewed_by         INTEGER REFERENCES users(id),
            reviewed_at         DATETIME,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS question_analytics (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id         INTEGER NOT NULL REFERENCES question_bank(id),
            mock_exam_id        INTEGER NOT NULL,
            times_presented     INTEGER DEFAULT 0,
            times_correct       INTEGER DEFAULT 0,
            avg_time_seconds    REAL DEFAULT 0,
            discrimination_index REAL,
            correctness_rate    REAL,
            updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(question_id, mock_exam_id)
        )""",
        # â”€â”€ MOCK EXAM SYSTEM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        """CREATE TABLE IF NOT EXISTS mock_exams (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            title               TEXT NOT NULL,
            description         TEXT,
            question_count      INTEGER DEFAULT 100,
            duration_mins       INTEGER DEFAULT 120,
            blueprint           TEXT,
            scheduled_at        DATETIME,
            ends_at             DATETIME,
            is_active           INTEGER DEFAULT 0,
            results_released    INTEGER DEFAULT 0,
            created_by          INTEGER REFERENCES users(id),
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS mock_exam_submissions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id             INTEGER NOT NULL REFERENCES mock_exams(id),
            user_id             INTEGER NOT NULL REFERENCES users(id),
            question_ids        TEXT NOT NULL,
            option_order        TEXT,
            answers             TEXT DEFAULT '{}',
            time_per_question   TEXT DEFAULT '{}',
            score               REAL,
            total_questions     INTEGER DEFAULT 0,
            status              TEXT DEFAULT 'in_progress',
            started_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            submitted_at        DATETIME,
            UNIQUE(exam_id, user_id)
        )""",
        """CREATE INDEX IF NOT EXISTS idx_question_bank_status ON question_bank(status, subject_category)""",
        """CREATE INDEX IF NOT EXISTS idx_question_bank_submitter ON question_bank(submitted_by)""",
        """CREATE INDEX IF NOT EXISTS idx_mock_exam_submissions ON mock_exam_submissions(exam_id, user_id)""",
    ]
    for sql in migrations:
        try:
            db.execute(sql)
            db.commit()
            print(f'[DB Migration] Applied: {sql[:60]}...')
        except Exception:
            pass  # already exists
    try:
        db.execute("""
            UPDATE exam_submissions
            SET status = CASE WHEN submitted_at IS NOT NULL THEN 'submitted' ELSE COALESCE(status, 'in_progress') END,
                last_activity_at = COALESCE(last_activity_at, submitted_at, started_at, CURRENT_TIMESTAMP),
                progress_count = COALESCE(progress_count, 0),
                review_status = CASE
                    WHEN submitted_at IS NOT NULL AND (review_status IS NULL OR review_status = '') THEN 'pending'
                    ELSE COALESCE(review_status, 'pending')
                END
        """)
        db.commit()
    except Exception:
        pass
    try:
        db.execute("""
            UPDATE voting_phases
            SET status = CASE
                WHEN status IN ('closed', 'finalized') THEN 'finalized'
                WHEN is_active = 1 THEN 'active'
                ELSE 'not_started'
            END
            WHERE status IS NULL OR status = '' OR status IN ('pending', 'closed', 'finalized', 'active')
        """)
        db.execute("UPDATE voting_phases SET is_active=0 WHERE status != 'active'")
        db.commit()
    except Exception:
        pass
    try:
        db.execute("""
            UPDATE face_embeddings
            SET match_threshold = CASE
                WHEN match_threshold IS NULL OR match_threshold = 0 OR match_threshold > 0.50 THEN 0.50
                ELSE match_threshold
            END
        """)
        db.commit()
    except Exception:
        pass
    db.close()

