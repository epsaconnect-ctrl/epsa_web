"""
EPSA Platform — Flask Backend Entry Point
"""
import os
import threading
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

BACKEND_DIR = os.path.dirname(__file__)
try:
    from .config import get_settings
    from .models import ensure_bootstrap_admin, get_db, init_db, migrate_db
    from .storage import (
        ensure_local_storage_folders,
        is_public_folder,
        private_upload_response,
        public_upload_response,
        upload_url,
    )
    from .auth import auth_bp
    from .students import students_bp
    from .training import training_bp
    from .voting import voting_bp
    from .exams import exams_bp
    from .messaging import messaging_bp
    from .admin import admin_bp
    from .clubs import clubs_bp
    from .partners import partners_bp
    from .network import network_bp
    from .teacher import teacher_bp
    from .mock_exams import mock_exams_bp
    from .analytics import analytics_bp
except ImportError:
    from config import get_settings
    from models import ensure_bootstrap_admin, get_db, init_db, migrate_db
    from storage import (
        ensure_local_storage_folders,
        is_public_folder,
        private_upload_response,
        public_upload_response,
        upload_url,
    )
    from auth import auth_bp
    from students import students_bp
    from training import training_bp
    from voting import voting_bp
    from exams import exams_bp
    from messaging import messaging_bp
    from admin import admin_bp
    from clubs import clubs_bp
    from partners import partners_bp
    from network import network_bp
    from teacher import teacher_bp
    from mock_exams import mock_exams_bp
    from analytics import analytics_bp

PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, '..'))
settings = get_settings()
IS_PRODUCTION_RUNTIME = settings.is_production

print("EPSA backend starting...")
print(f"[Startup] env={settings.env} db={settings.db_engine} storage={settings.storage_mode}")
print("ENV RESOLVED:", os.getenv("APP_ENV"), IS_PRODUCTION_RUNTIME)

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
app.config['SECRET_KEY'] = settings.secret_key
app.config['JWT_SECRET_KEY'] = settings.jwt_secret_key
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = settings.jwt_access_expires
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = settings.jwt_refresh_expires
app.config['UPLOAD_FOLDER'] = str(settings.upload_dir)
app.config['MAX_CONTENT_LENGTH'] = settings.max_content_length
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies'] if settings.use_cookie_auth else ['headers']
app.config['JWT_COOKIE_SECURE'] = settings.jwt_cookie_secure
app.config['JWT_COOKIE_SAMESITE'] = settings.jwt_cookie_samesite
app.config['JWT_COOKIE_DOMAIN'] = settings.jwt_cookie_domain
app.config['JWT_COOKIE_CSRF_PROTECT'] = False
app.config['EPSA_ENV'] = settings.env
app.config['EPSA_AUTH_TOKEN_MODE'] = settings.auth_token_mode
app.config['EPSA_API_BASE_URL'] = settings.api_base_url
app.config['EPSA_APP_URL'] = settings.app_public_url

cors_origins = settings.cors_origins if settings.cors_origins else ([] if settings.is_production else "*")
CORS(app, origins=cors_origins, supports_credentials=True)
jwt  = JWTManager(app)
sock = SocketIO(app, cors_allowed_origins=cors_origins, async_mode='threading' if settings.is_production else 'eventlet')
_runtime_lock = threading.Lock()
_runtime_initialized = False
_runtime_init_error = None

# Register blueprints
app.register_blueprint(auth_bp,       url_prefix='/api/auth')
app.register_blueprint(students_bp,   url_prefix='/api/students')
app.register_blueprint(training_bp,   url_prefix='/api/trainings')
app.register_blueprint(voting_bp,     url_prefix='/api/voting')
app.register_blueprint(exams_bp,      url_prefix='/api/exams')
app.register_blueprint(messaging_bp,  url_prefix='/api/messages')
app.register_blueprint(admin_bp,      url_prefix='/api/admin')
app.register_blueprint(clubs_bp,      url_prefix='/api/clubs')
app.register_blueprint(partners_bp,   url_prefix='/api/partners')
app.register_blueprint(network_bp,    url_prefix='/api/network')
app.register_blueprint(teacher_bp,    url_prefix='/api/teacher')
app.register_blueprint(mock_exams_bp, url_prefix='/api/mock-exams')
app.register_blueprint(analytics_bp,  url_prefix='/api/analytics')


def ensure_runtime_ready():
    global _runtime_initialized, _runtime_init_error

    if _runtime_initialized:
        return

    with _runtime_lock:
        if _runtime_initialized:
            return
        try:
            init_db()
            migrate_db()
            ensure_bootstrap_admin()
            if settings.is_local:
                ensure_local_storage_folders()
            _runtime_initialized = True
            _runtime_init_error = None
            print("[Startup] Runtime initialization complete.")
        except Exception as exc:
            _runtime_init_error = exc
            print(f"[Startup] Runtime initialization failed: {exc}")
            raise


@app.before_request
def initialize_runtime():
    if (
        request.method == 'OPTIONS'
        or request.endpoint == 'health'
        or not request.path.startswith(('/api/', '/uploads/'))
    ):
        return None
    try:
        ensure_runtime_ready()
    except Exception as exc:
        return jsonify({
            'status': 'error',
            'message': 'Backend startup initialization failed.',
            'detail': str(exc),
        }), 503

@app.route('/api/health')
def health():
    return {
        'status': 'ok',
        'message': 'EPSA API is running',
        'environment': settings.env,
        'database_mode': settings.db_engine,
        'storage_mode': settings.storage_mode,
        'initialized': _runtime_initialized,
        'startup_error': str(_runtime_init_error) if _runtime_init_error else None,
    }


@app.route('/health')
def platform_health():
    return {'status': 'ok'}, 200

@app.route('/api/leadership/public')
def public_leadership():
    db = get_db()
    executives = db.execute('''
        SELECT e.id, e.vote_rank, e.vote_count, e.assigned_role as position, e.status, e.term_start, e.term_end,
               u.id as user_id, u.first_name||' '||u.father_name as name, u.university, u.profile_photo
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        WHERE e.status IN ('active','reassigned','standby')
          AND e.assigned_role IS NOT NULL
        ORDER BY CASE
            WHEN e.assigned_role='President' THEN 1
            WHEN e.assigned_role='Vice President' THEN 2
            WHEN e.assigned_role='Secretary General' THEN 3
            ELSE 10
        END, e.vote_rank ASC, e.id ASC
    ''').fetchall()
    nrc_rows = db.execute('''
        SELECT n.id, n.status, n.term_start, n.term_end, n.eligibility_status,
               u.id as user_id, u.first_name||' '||u.father_name as name, u.university, u.profile_photo
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        WHERE n.status IN ('active','inactive','suspended') AND n.is_primary=1
        ORDER BY u.university ASC
    ''').fetchall()
    if not nrc_rows:
        nrc_rows = db.execute('''
            SELECT er.id, 'active' as status, NULL as term_start, NULL as term_end, 'eligible' as eligibility_status,
                   u.id as user_id, u.first_name||' '||u.father_name as name, u.university, u.profile_photo
            FROM users u JOIN election_results er ON u.id = er.user_id
            WHERE er.is_active = 1 AND LOWER(er.position) LIKE '%representative%'
            ORDER BY u.university ASC
        ''').fetchall()
    appointed = db.execute('''
        SELECT id, name, position, hierarchy, profile_photo, bio, order_num
        FROM leadership_profiles
        WHERE is_active = 1
        ORDER BY order_num ASC
    ''').fetchall()
    
    db.close()
    
    result = {'nec': [], 'nrc': [], 'neb_appointed': []}
    
    for e in executives:
        result['nec'].append({
            'id': e['id'],
            'name': e['name'],
            'university': e['university'],
            'position': e['position'],
            'photo': upload_url('profiles', e['profile_photo']),
            'rank': e['vote_rank'],
            'vote_count': e['vote_count'],
            'status': e['status'],
            'term_start': e['term_start'],
            'term_end': e['term_end']
        })
    for r in nrc_rows:
        result['nrc'].append({
            'name': r['name'],
            'university': r['university'],
            'position': 'University Representative',
            'photo': upload_url('profiles', r['profile_photo']),
            'status': r['status'],
            'eligibility_status': r['eligibility_status'],
            'term_start': r['term_start'],
            'term_end': r['term_end']
        })
    for a in appointed:
        result['neb_appointed'].append({
            'id': a['id'], 'name': a['name'], 'position': a['position'], 'hierarchy': a['hierarchy'], 'bio': a['bio'],
            'photo': upload_url('appointees', a['profile_photo'])
        })
        
    return jsonify(result)

@app.route('/api/history/public')
def public_history():
    db = get_db()
    founders = [
        {
            'name': 'Dawit Aynalem',
            'title': 'Founding Coordinator',
            'image': 'dawit.jpg',
            'student_status': '4th-year psychology student at the time of establishment',
            'summary': 'Primary initiator and main coordinator of EPSA.',
            'contributions': [
                'Conceptualized EPSA as a national student-led platform for psychology students in Ethiopia.',
                'Prepared and presented the proposal to the Ethiopian Psychologists’ Association (EPA).',
                'Led the coordination and official launch of the initiative.'
            ]
        },
        {
            'name': 'Kidist Debebe',
            'title': 'Co-Coordinator',
            'image': 'kidist.png',
            'student_status': '4th-year psychology student at the time of establishment',
            'summary': 'Strategic contributor and co-coordinator during EPSA’s formation.',
            'contributions': [
                'Coordinated training planning and early capacity-building directions.',
                'Supported communication with relevant stakeholders and institutional partners.',
                'Served as a key advisor throughout the development process.'
            ]
        }
    ]

    neb_rows = db.execute('''
        SELECT id, name, position, hierarchy, profile_photo, bio, role_description, linked_user_id, term_start, term_end, is_active, order_num
        FROM leadership_profiles
        ORDER BY is_active DESC, order_num ASC, id DESC
    ''').fetchall()
    nec_rows = db.execute('''
        SELECT e.id, e.vote_rank, e.vote_count, e.assigned_role, e.status, e.term_start, e.term_end,
               e.governance_origin, e.decision_reference, e.engagement_status, e.performance_flag,
               u.id as user_id, u.first_name||' '||u.father_name as name, u.university, u.profile_photo, u.bio
        FROM executive_committee_members e
        JOIN users u ON u.id = e.user_id
        ORDER BY
            CASE WHEN e.status IN ('active','reassigned','standby') THEN 0 ELSE 1 END,
            CASE
                WHEN e.assigned_role='President' THEN 1
                WHEN e.assigned_role='Vice President' THEN 2
                WHEN e.assigned_role='Secretary General' THEN 3
                ELSE 20
            END,
            e.vote_rank ASC,
            e.id DESC
    ''').fetchall()
    nrc_rows = db.execute('''
        SELECT n.id, n.status, n.eligibility_status, n.term_start, n.term_end, n.midterm_status,
               n.last_activity_at, n.inactivity_flag, n.handover_status, n.university,
               u.id as user_id, u.first_name||' '||u.father_name as name, u.student_id, u.profile_photo, u.bio
        FROM nrc_members n
        JOIN users u ON u.id = n.user_id
        ORDER BY
            CASE WHEN n.status='active' THEN 0 ELSE 1 END,
            n.university ASC,
            n.id DESC
    ''').fetchall()
    news_rows = db.execute('''
        SELECT id, title, category, excerpt, image_path, created_at
        FROM news_events
        WHERE image_path IS NOT NULL AND TRIM(image_path) <> ''
        ORDER BY is_featured DESC, created_at DESC
        LIMIT 6
    ''').fetchall()
    doc_rows = db.execute('''
        SELECT 'executive' as source_type, reference_code as title, notes as summary, decision_document_path as file_path, issued_at as created_at
        FROM executive_decisions
        WHERE decision_document_path IS NOT NULL AND TRIM(decision_document_path) <> ''
        UNION ALL
        SELECT 'nrc' as source_type, title, summary, file_path, submitted_at as created_at
        FROM nrc_documents
        WHERE file_path IS NOT NULL AND TRIM(file_path) <> ''
        ORDER BY created_at DESC
        LIMIT 8
    ''').fetchall()
    db.close()

    def profile_url(path, folder):
        return upload_url(folder, path)

    def current_status_label(status):
        return (status or 'current').replace('_', ' ').title()

    neb_current, neb_past = [], []
    for row in neb_rows:
        item = {
            'id': row['id'],
            'name': row['name'],
            'role': row['position'],
            'title': row['position'],
            'body': row['hierarchy'],
            'term_start': row['term_start'],
            'term_end': row['term_end'],
            'status': 'current' if row['is_active'] else 'past',
            'description': row['role_description'] or row['bio'] or 'National Executive Board member supporting EPSA governance and institutional direction.',
            'bio': row['bio'],
            'photo': profile_url(row['profile_photo'], 'appointees'),
            'user_id': row['linked_user_id']
        }
        (neb_current if row['is_active'] else neb_past).append(item)

    nec_current, nec_past = [], []
    for row in nec_rows:
        item = {
            'id': row['id'],
            'name': row['name'],
            'role': row['assigned_role'] or 'Executive Committee Member',
            'title': row['assigned_role'] or 'Executive Committee Member',
            'university': row['university'],
            'vote_rank': row['vote_rank'],
            'vote_count': row['vote_count'],
            'status': current_status_label(row['status']),
            'term_start': row['term_start'],
            'term_end': row['term_end'],
            'assignment_type': 'Elected' if row['governance_origin'] == 'national_election' else 'Governance Assignment',
            'decision_reference': row['decision_reference'],
            'engagement_status': row['engagement_status'],
            'performance_flag': row['performance_flag'],
            'description': row['bio'] or 'Executive Committee member serving EPSA’s national leadership agenda.',
            'photo': profile_url(row['profile_photo'], 'profiles'),
            'user_id': row['user_id']
        }
        if row['status'] in ('active', 'reassigned', 'standby'):
            nec_current.append(item)
        else:
            nec_past.append(item)

    nrc_current, nrc_past = [], []
    university_index = {}
    for row in nrc_rows:
        item = {
            'id': row['id'],
            'name': row['name'],
            'university': row['university'],
            'student_id': row['student_id'],
            'status': current_status_label(row['status']),
            'eligibility_status': current_status_label(row['eligibility_status']),
            'midterm_status': current_status_label(row['midterm_status']),
            'term_start': row['term_start'],
            'term_end': row['term_end'],
            'last_activity_at': row['last_activity_at'],
            'inactivity_flag': row['inactivity_flag'],
            'handover_status': row['handover_status'],
            'description': row['bio'] or 'University Representative connecting campus students with national EPSA governance.',
            'photo': profile_url(row['profile_photo'], 'profiles'),
            'user_id': row['user_id']
        }
        bucket = nrc_current if row['status'] == 'active' else nrc_past
        bucket.append(item)
        university_index.setdefault(row['university'], []).append(item)

    result = {
        'overview': {
            'title': 'History of EPSA',
            'launch_date': '2025-11-17',
            'recognition_date': '2025-12-13',
            'summary': 'EPSA emerged as a student-led national initiative to unify psychology students across Ethiopia and quickly matured into a recognized governance and professional development platform.',
            'announcement': 'EPSA was officially launched on November 17, 2025, as a student-led national initiative aimed at unifying psychology students across Ethiopia. On December 13, 2025, EPSA became a semi-autonomous division under the Ethiopian Psychologists’ Association (EPA), marking its formal recognition and integration into the national professional structure.'
        },
        'timeline': [
            {
                'date': '2025-10-01',
                'label': 'Proposal & Idea Phase',
                'description': 'The founding team shaped the concept, governance intent, and institutional proposal for a national psychology students’ association.'
            },
            {
                'date': '2025-11-17',
                'label': 'Official Launch',
                'description': 'EPSA launched as a student-led national initiative focused on unity, representation, training, and professional development.'
            },
            {
                'date': '2025-12-13',
                'label': 'Recognition Under EPA',
                'description': 'EPSA became a semi-autonomous division under the Ethiopian Psychologists’ Association (EPA), strengthening national legitimacy and coordination.'
            },
            {
                'date': '2026-01-10',
                'label': 'Early Programs',
                'description': 'Webinars, training programs, and digital systems began taking shape to support students across universities.'
            },
            {
                'date': '2026-02-15',
                'label': 'Structured Governance',
                'description': 'Representative, executive, and oversight structures matured into a more accountable national governance pipeline.'
            }
        ],
        'founders': founders,
        'neb': {'current': neb_current, 'past': neb_past},
        'nec': {'current': nec_current, 'past': nec_past},
        'nrc': {
            'current': nrc_current,
            'past': nrc_past,
            'universities': [
                {
                    'name': university,
                    'count': len(members),
                    'active_count': len([m for m in members if m['status'].lower() == 'active'])
                }
                for university, members in sorted(university_index.items())
            ]
        },
        'milestones': [
            {'value': len(founders), 'label': 'Founding Coordinators'},
            {'value': len(neb_current), 'label': 'Current NEB Members'},
            {'value': len(nec_current), 'label': 'Active NEC Members'},
            {'value': len(nrc_current), 'label': 'Active NRC Representatives'}
        ],
        'gallery': [
            {
                'id': row['id'],
                'title': row['title'],
                'category': row['category'],
                'excerpt': row['excerpt'],
                'image': upload_url('news', row['image_path']),
                'created_at': row['created_at']
            }
            for row in news_rows
        ],
        'documents': [
            {
                'title': row['title'],
                'summary': row['summary'],
                'source_type': row['source_type'],
                'url': upload_url('governance_docs', row['file_path']),
                'created_at': row['created_at']
            }
            for row in doc_rows
        ],
        'external_links': [
            {'label': 'EPA Telegram', 'url': None, 'note': 'Link can be added when the official EPA Telegram URL is confirmed.'},
            {'label': 'EPSA Channel', 'url': None, 'note': 'Link can be added when the official EPSA channel URL is confirmed.'}
        ]
    }
    return jsonify(result)

@app.route('/api/news')
def public_news():
    db = get_db()
    rows = db.execute("SELECT * FROM news_events ORDER BY is_featured DESC, created_at DESC LIMIT 5").fetchall()
    db.close()
    result = []
    for r in rows:
        d = dict(r)
        if d['image_path']:
            d['image_url'] = upload_url('news', d['image_path'])
        result.append(d)
    return jsonify(result)


@app.route('/uploads/<folder>/<filename>')
def serve_upload(folder, filename):
    if not is_public_folder(folder):
        abort(404)
    return public_upload_response(folder, filename)

@app.route('/api/documents/<doc_type>/<filename>')
@jwt_required()
def get_document(doc_type, filename):
    if doc_type not in ['slips', 'receipts', 'profiles', 'fin_receipts', 'governance_docs', 'proposals']:
        abort(400)
        
    user_id = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    db.close()
    
    if not user or user['role'] not in ['admin', 'super_admin']:
        abort(403)
        
    return private_upload_response(doc_type, filename, download_name=filename)


@app.route('/')
def serve_home():
    if IS_PRODUCTION_RUNTIME:
        return {'status': 'ok'}, 200
    return send_from_directory(PROJECT_ROOT, 'index.html')


@app.route('/<path:path>')
def serve_frontend(path):
    if path.startswith(('api/', 'uploads/')):
        abort(404)
    return send_from_directory(PROJECT_ROOT, path)

# WebSocket events
@sock.on('connect')
def on_connect():
    ensure_runtime_ready()
    print('[WS] Client connected')

@sock.on('disconnect')
def on_disconnect():
    print('[WS] Client disconnected')

@sock.on('join_room')
def on_join(data):
    from flask_socketio import join_room
    room = f"chat_{min(data['user_id'], data['partner_id'])}_{max(data['user_id'], data['partner_id'])}"
    join_room(room)

@sock.on('send_message')
def on_message(data):
    from flask_socketio import emit
    from flask_jwt_extended import decode_token
    try:
        token   = data.get('token', '')
        decoded = decode_token(token)
        from_id = decoded['sub']
        to_id   = data['to_id']
        text    = data['text']
        db = get_db()
        db.execute("INSERT INTO messages (from_user_id, to_user_id, text) VALUES (?,?,?)", (from_id, to_id, text))
        db.commit()
        db.close()
        room = f"chat_{min(from_id, to_id)}_{max(from_id, to_id)}"
        emit('new_message', {'from_id': from_id, 'text': text, 'time': 'Now'}, room=room)
    except Exception as e:
        print('[WS Error]', e)

if __name__ == '__main__':
    ensure_runtime_ready()
    port = int(os.environ.get('PORT') or os.environ.get('EPSA_LOCAL_BACKEND_PORT') or 5000)
    print(f"EPSA Backend starting in {settings.env} mode")
    sock.run(app, host='0.0.0.0', port=port, debug=settings.debug)
