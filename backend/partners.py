"""EPSA Partners Routes"""
from flask import Blueprint, request, jsonify
from models import get_db
from storage import upload_url

partners_bp = Blueprint('partners', __name__)

# ─── PUBLIC: List Active Partners ────────────────────────────────────
@partners_bp.route('', methods=['GET'])
def list_partners():
    category = request.args.get('category', '')
    search = request.args.get('search', '').strip().lower()
    db = get_db()
    rows = db.execute("SELECT * FROM partners WHERE is_active=1 ORDER BY name").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        # Filter by category
        if category and d.get('category','').lower() != category.lower():
            continue
        # Filter by search
        if search and search not in (d.get('name','') + d.get('description','')).lower():
            continue
        if d['logo_path']:
            d['logo_url'] = upload_url('partners', d['logo_path'])
        # Attach gallery
        gallery = db.execute(
            "SELECT * FROM partner_gallery WHERE partner_id=? ORDER BY order_num", (d['id'],)
        ).fetchall()
        d['gallery'] = [{'image_url': upload_url('partner_gallery', g['image_path']), 'caption': g['caption']} for g in gallery]
        result.append(d)
    db.close()
    return jsonify(result)

@partners_bp.route('/<int:pid>', methods=['GET'])
def get_partner(pid):
    db = get_db()
    p = db.execute("SELECT * FROM partners WHERE id=?", (pid,)).fetchone()
    if not p: db.close(); return jsonify({'error': 'Not found'}), 404
    gallery = db.execute(
        "SELECT * FROM partner_gallery WHERE partner_id=? ORDER BY order_num", (pid,)
    ).fetchall()
    db.close()
    d = dict(p)
    if d['logo_path']: d['logo_url'] = upload_url('partners', d['logo_path'])
    d['gallery'] = [{'image_url': upload_url('partner_gallery', g['image_path']), 'caption': g['caption']} for g in gallery]
    return jsonify(d)

# ─── PUBLIC: Partner Categories ──────────────────────────────────────
@partners_bp.route('/categories', methods=['GET'])
def partner_categories():
    db = get_db()
    rows = db.execute("SELECT DISTINCT category FROM partners WHERE is_active=1 ORDER BY category").fetchall()
    db.close()
    return jsonify([r['category'] for r in rows])
