import sqlite3
import json

def test_json():
    try:
        db = sqlite3.connect(r'c:\Users\dawit\Desktop\EPSA WEB\backend\epsa.db')
        db.row_factory = sqlite3.Row
        
        vote_phase = db.execute("SELECT * FROM voting_phases LIMIT 1").fetchone()
        
        my_nom = db.execute("""
            SELECT n.id, n.is_approved, n.position, n.bio, n.statement, n.vision, n.manifesto_path, n.video_url,
                   u.id as user_id, u.first_name||' '||u.father_name as name, u.university,
                   u.program_type, u.academic_year, u.profile_photo,
                   (
                       SELECT COUNT(*)
                       FROM votes v
                       WHERE v.candidate_id = n.user_id AND v.phase_id = n.phase_id
                   ) as vote_count
            FROM nominations n JOIN users u ON n.user_id=u.id
            WHERE n.phase_id=1 AND n.user_id=1
            ORDER BY n.id DESC LIMIT 1
        """).fetchone()

        my_nomination = dict(my_nom) if my_nom else None
        if my_nomination:
            my_nomination['is_me'] = True
            
        data = {
            'active': True,
            'phase': dict(vote_phase) if vote_phase else None,
            'candidates': [],
            'my_vote_id': None,
            'my_nomination': my_nomination
        }
        
        json.dumps(data)
        print("JSON OK")
    except Exception as e:
        import traceback
        traceback.print_exc()

test_json()
