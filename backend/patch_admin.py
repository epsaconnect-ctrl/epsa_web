"""Patch admin dashboard with Teacher & Mock Exam management panels."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\dawit\Desktop\EPSA WEB\admin\dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ── 1. Add nav items ──────────────────────────────────────────────────────────
# Find the last nav label block and append after it
LAST_NAV_LABEL = '<div class="admin-nav-label">Overview</div>'
if LAST_NAV_LABEL not in content:
    # fallback: find the admin nav container end
    print('Finding admin-nav label...')
    idx = content.find('admin-nav"')
    print(repr(content[idx:idx+300]))
else:
    # Find a good injection point — find last admin-nav-link before </ul> or </nav>
    # We'll inject before the closing </nav> or </div> of admin-nav
    # Find the last admin-nav-link
    INJECT_AFTER = 'onclick="switchAdminSection(\'news\')"'
    if INJECT_AFTER not in content:
        # Try alternatives
        for alt in ["switchAdminSection('clubs')", "switchAdminSection('partners')", 
                    "switchAdminSection('grants')", "switchAdminSection('voting')"]:
            if alt in content:
                INJECT_AFTER = alt
                break

    print(f'Injecting nav after: {INJECT_AFTER}')
    
    # Find the end of that button
    idx = content.find(INJECT_AFTER)
    if idx >= 0:
        # Find </button> after this
        btn_end = content.find('</button>', idx)
        if btn_end >= 0:
            btn_end += len('</button>')
            NAV_INJECTION = '''

      <div class="admin-nav-label">Intelligence</div>
      <button class="admin-nav-link" data-sec="question-bank" onclick="switchAdminSection('question-bank')"><span class="admin-nav-icon">📚</span> Question Bank</button>
      <button class="admin-nav-link" data-sec="teachers"      onclick="switchAdminSection('teachers')"><span class="admin-nav-icon">🎓</span> Teachers <span class="admin-nav-badge" id="teacherBadge" style="display:none"></span></button>
      <button class="admin-nav-link" data-sec="mock-exams"   onclick="switchAdminSection('mock-exams')"><span class="admin-nav-icon">🎯</span> Mock Exams</button>'''
            content = content[:btn_end] + NAV_INJECTION + content[btn_end:]
            print('SUCCESS: Admin nav items injected')

# ── 2. Inject HTML panels before </body> ──────────────────────────────────────
ADMIN_PANELS = '''
  <!-- ══════════════════════════════════════════════════════
       ADMIN: QUESTION BANK
  ══════════════════════════════════════════════════════ -->
  <div id="admin-section-question-bank" class="admin-section" style="display:none">
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div>
        <h2 style="font-size:1.4rem;font-weight:800">📚 Question Bank</h2>
        <p style="color:var(--text-muted,#86efac);font-size:.88rem;margin-top:4px">Review, approve, and manage teacher-submitted questions</p>
      </div>
      <div id="qbStats" style="display:flex;gap:12px;flex-wrap:wrap"></div>
    </div>

    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(34,197,94,.15);border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select id="qbStatusFilter" onchange="loadAdminQuestions()" style="padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.85rem">
          <option value="pending">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Status</option>
        </select>
        <select id="qbCategoryFilter" onchange="loadAdminQuestions()" style="padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.85rem">
          <option value="">All Categories</option>
          <option>Social Psychology</option><option>Clinical Psychology</option>
          <option>Developmental Psychology</option><option>Cognitive Psychology</option>
          <option>Abnormal Psychology</option><option>Research Methods &amp; Statistics</option>
          <option>Counseling Psychology</option><option>Biological Psychology</option>
          <option>General Psychology</option>
        </select>
        <button onclick="loadAdminQuestions()" style="padding:9px 16px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:9px;color:#22c55e;font-weight:700;cursor:pointer;font-family:inherit;font-size:.85rem">🔄 Refresh</button>
        <span id="qbTotal" style="color:#86efac;font-size:.82rem;margin-left:auto"></span>
      </div>
    </div>

    <div style="overflow-x:auto;border-radius:12px;border:1px solid rgba(34,197,94,.12)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:rgba(0,0,0,.25)">
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left;white-space:nowrap">Question</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Category</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Bloom's</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Diff.</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Teacher</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Status</th>
            <th style="padding:11px 14px;font-size:.72rem;font-weight:700;color:#86efac;text-align:left">Actions</th>
          </tr>
        </thead>
        <tbody id="qbTableBody">
          <tr><td colspan="7" style="padding:32px;text-align:center;color:#86efac">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div id="qbPagination" style="display:flex;gap:8px;justify-content:center;margin-top:16px"></div>
  </div>

  <!-- ══════════════════════════════════════════════════════
       ADMIN: TEACHERS
  ══════════════════════════════════════════════════════ -->
  <div id="admin-section-teachers" class="admin-section" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div>
        <h2 style="font-size:1.4rem;font-weight:800">🎓 Teacher Management</h2>
        <p style="color:#86efac;font-size:.88rem;margin-top:4px">Review teacher applications and manage approved contributors</p>
      </div>
      <div style="display:flex;gap:8px">
        <select id="teacherStatusFilter" onchange="loadAdminTeachers()" style="padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.85rem">
          <option value="pending">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Teachers</option>
        </select>
        <button onclick="loadAdminTeachers()" style="padding:9px 16px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:9px;color:#22c55e;font-weight:700;cursor:pointer;font-family:inherit;font-size:.85rem">🔄</button>
      </div>
    </div>
    <div id="teacherCardsGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
      <div style="text-align:center;color:#86efac;padding:40px;grid-column:1/-1">Loading…</div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════
       ADMIN: MOCK EXAMS
  ══════════════════════════════════════════════════════ -->
  <div id="admin-section-mock-exams" class="admin-section" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px">
      <div>
        <h2 style="font-size:1.4rem;font-weight:800">🎯 Mock Exam Management</h2>
        <p style="color:#86efac;font-size:.88rem;margin-top:4px">Schedule, activate, and analyze national mock examinations</p>
      </div>
      <button onclick="openCreateExamModal()" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-family:inherit;font-size:.88rem;font-weight:700;cursor:pointer">➕ Schedule New Exam</button>
    </div>
    <div id="adminExamList" style="display:flex;flex-direction:column;gap:14px">
      <div style="text-align:center;color:#86efac;padding:40px">Loading…</div>
    </div>
  </div>

  <!-- Report modal -->
  <div id="examReportModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:8000;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto">
    <div style="background:#0a2e18;border:1px solid rgba(34,197,94,.2);border-radius:20px;padding:32px;width:100%;max-width:800px;position:relative">
      <button onclick="document.getElementById('examReportModal').style.display='none'" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.07);border:none;color:#86efac;width:32px;height:32px;border-radius:50%;cursor:pointer">✕</button>
      <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:20px">📊 Post-Exam Analytics Report</h2>
      <div id="examReportContent" style="color:#86efac">Loading…</div>
    </div>
  </div>

  <!-- Create exam modal -->
  <div id="createExamModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:8000;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto">
    <div style="background:#0a2e18;border:1px solid rgba(34,197,94,.2);border-radius:20px;padding:32px;width:100%;max-width:580px;position:relative">
      <button onclick="document.getElementById('createExamModal').style.display='none'" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,.07);border:none;color:#86efac;width:32px;height:32px;border-radius:50%;cursor:pointer">✕</button>
      <h2 style="font-size:1.15rem;font-weight:800;margin-bottom:20px">➕ Schedule Mock Exam</h2>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Exam Title *</label>
          <input id="newExamTitle" placeholder="e.g. EPSA National Mock Exam — Round 1" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem"/>
        </div>
        <div>
          <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Description</label>
          <textarea id="newExamDesc" rows="2" placeholder="Brief description for students" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem;resize:vertical"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Questions *</label>
            <input id="newExamCount" type="number" value="100" min="10" max="500" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem"/>
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Duration (mins) *</label>
            <input id="newExamDuration" type="number" value="120" min="10" max="480" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem"/>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Opens At</label>
            <input id="newExamStart" type="datetime-local" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem"/>
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:700;color:#86efac;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Closes At</label>
            <input id="newExamEnd" type="datetime-local" style="width:100%;padding:10px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(34,197,94,.2);border-radius:9px;color:inherit;font-family:inherit;font-size:.9rem"/>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px">
          <button onclick="document.getElementById('createExamModal').style.display='none'" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.15);border-radius:10px;color:#86efac;font-family:inherit;font-weight:600;cursor:pointer">Cancel</button>
          <button onclick="createMockExam()" style="flex:2;padding:11px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:700;cursor:pointer" id="createExamBtn">Create Exam</button>
        </div>
      </div>
    </div>
  </div>

  <script>
  // ══════════════════════════════════════════
  //   ADMIN: QUESTION BANK
  // ══════════════════════════════════════════
  let qbPage = 1;

  async function loadAdminQuestions(page) {
    if (page) qbPage = page;
    const tbody = document.getElementById('qbTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="padding:24px;text-align:center;color:#86efac">Loading…</td></tr>';
    try {
      const params = {
        status: document.getElementById('qbStatusFilter').value,
        page: qbPage,
        category: document.getElementById('qbCategoryFilter').value || '',
      };
      const data = await API.adminListQuestions(params);
      renderQBStats(data.stats || {});
      renderQBTable(data.questions || []);
      document.getElementById('qbTotal').textContent = data.total + ' question(s) found';
      renderAdminPagination('qbPagination', data.page, data.pages, loadAdminQuestions);
    } catch(err) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:#f87171">${err.message||'Failed'}</td></tr>`;
    }
  }

  function renderQBStats(stats) {
    const el = document.getElementById('qbStats');
    if (!el) return;
    el.innerHTML = [
      ['📬 Pending', stats.pending||0, '#f59e0b'],
      ['✅ Approved', stats.approved||0, '#22c55e'],
      ['❌ Rejected', stats.rejected||0, '#f87171'],
      ['📦 Total', stats.total||0, '#86efac'],
    ].map(([l,v,c]) =>
      `<div style="background:rgba(0,0,0,.3);border:1px solid rgba(34,197,94,.12);border-radius:10px;padding:10px 16px;text-align:center">
        <div style="font-size:1.2rem;font-weight:800;color:${c}">${v}</div>
        <div style="font-size:.72rem;color:#86efac;margin-top:2px">${l}</div>
      </div>`
    ).join('');
  }

  function renderQBTable(questions) {
    const tbody = document.getElementById('qbTableBody');
    if (!questions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:40px;text-align:center;color:#86efac;opacity:.6">No questions found</td></tr>';
      return;
    }
    const badgeColors = { pending:'#f59e0b', approved:'#22c55e', rejected:'#f87171' };
    const diffColors  = { easy:'#22c55e', medium:'#f59e0b', hard:'#f87171' };
    tbody.innerHTML = questions.map(q => `
      <tr style="border-bottom:1px solid rgba(34,197,94,.06)" onmouseover="this.style.background='rgba(255,255,255,.02)'" onmouseout="this.style.background=''">
        <td style="padding:11px 14px;max-width:240px">
          <div style="font-size:.83rem;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escAdminHtml(q.question_text)}</div>
        </td>
        <td style="padding:11px 14px;font-size:.78rem;color:#86efac;white-space:nowrap">${q.subject_category||'—'}</td>
        <td style="padding:11px 14px;font-size:.78rem;white-space:nowrap">${q.bloom_level||'—'}</td>
        <td style="padding:11px 14px"><span style="background:rgba(0,0,0,.3);color:${diffColors[q.difficulty]||'#86efac'};padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">${q.difficulty||'—'}</span></td>
        <td style="padding:11px 14px;font-size:.78rem;color:#86efac;white-space:nowrap">${escAdminHtml(q.teacher_name||'—')}</td>
        <td style="padding:11px 14px"><span style="background:rgba(0,0,0,.3);color:${badgeColors[q.status]||'#86efac'};padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700;border:1px solid ${badgeColors[q.status]||'#86efac'}33">${q.status}</span></td>
        <td style="padding:11px 14px;white-space:nowrap">
          ${q.status==='pending' ? `
            <button onclick="approveQuestion(${q.id})" style="background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);padding:4px 10px;border-radius:7px;font-family:inherit;font-size:.75rem;font-weight:700;cursor:pointer;margin-right:4px">✅ Approve</button>
            <button onclick="rejectQuestion(${q.id})" style="background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.3);padding:4px 10px;border-radius:7px;font-family:inherit;font-size:.75rem;font-weight:700;cursor:pointer">❌ Reject</button>
          ` : `<span style="color:#86efac;font-size:.75rem;opacity:.6">${q.status}</span>`}
        </td>
      </tr>`).join('');
  }

  async function approveQuestion(id) {
    try {
      await API.adminApproveQuestion(id);
      showToast('Question approved ✅', 'success');
      loadAdminQuestions();
    } catch(e) { showToast(e.message, 'error'); }
  }
  async function rejectQuestion(id) {
    const notes = prompt('Rejection notes for teacher (optional):') || '';
    try {
      await API.adminRejectQuestion(id, notes);
      showToast('Question rejected', 'info');
      loadAdminQuestions();
    } catch(e) { showToast(e.message, 'error'); }
  }

  // ══════════════════════════════════════════
  //   ADMIN: TEACHERS
  // ══════════════════════════════════════════
  async function loadAdminTeachers() {
    const grid = document.getElementById('teacherCardsGrid');
    grid.innerHTML = '<div style="text-align:center;color:#86efac;padding:40px;grid-column:1/-1">Loading…</div>';
    try {
      const status = document.getElementById('teacherStatusFilter').value;
      const data = await API.adminListTeachers(status);
      const teachers = data.teachers || [];
      const badge = document.getElementById('teacherBadge');
      if (badge) {
        const pending = teachers.filter(t => t.status === 'pending').length;
        badge.textContent = pending;
        badge.style.display = pending ? 'inline' : 'none';
      }
      if (!teachers.length) {
        grid.innerHTML = '<div style="text-align:center;color:#86efac;padding:60px;grid-column:1/-1;opacity:.6">No teachers found</div>';
        return;
      }
      grid.innerHTML = teachers.map(t => renderTeacherCard(t)).join('');
    } catch(err) {
      grid.innerHTML = `<div style="color:#f87171;padding:32px;text-align:center;grid-column:1/-1">${err.message}</div>`;
    }
  }

  function renderTeacherCard(t) {
    const statusColors = { pending:'#f59e0b', approved:'#22c55e', rejected:'#f87171' };
    const sc = statusColors[t.status] || '#86efac';
    const initials = (t.name||'T').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const btns = t.status === 'pending' ? `
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="approveTeacher(${t.id})" style="flex:1;padding:9px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);border-radius:9px;font-family:inherit;font-weight:700;cursor:pointer;font-size:.83rem">✅ Approve</button>
        <button onclick="rejectTeacher(${t.id})" style="flex:1;padding:9px;background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.3);border-radius:9px;font-family:inherit;font-weight:700;cursor:pointer;font-size:.83rem">❌ Reject</button>
      </div>` : `<div style="margin-top:14px;font-size:.78rem;color:#86efac">Approved questions: <strong style="color:#22c55e">${t.approved_count||0}</strong></div>`;

    return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(34,197,94,.14);border-radius:14px;padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:42px;height:42px;border-radius:50%;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#22c55e;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escAdminHtml(t.name||'')}</div>
          <div style="font-size:.75rem;color:#86efac;margin-top:1px">${escAdminHtml(t.email||'')}</div>
        </div>
        <span style="padding:3px 9px;border-radius:14px;font-size:.68rem;font-weight:800;color:${sc};background:${sc}18;border:1px solid ${sc}33;flex-shrink:0">${t.status}</span>
      </div>
      <div style="font-size:.78rem;color:#86efac;line-height:1.7">
        <div>🎓 ${escAdminHtml(t.specialization||'—')}</div>
        <div>🏫 ${escAdminHtml(t.institution||'—')}</div>
        <div>📅 Exp: ${t.years_of_experience||0} yrs · 📦 ${t.question_count||0} questions submitted</div>
      </div>
      ${btns}
    </div>`;
  }

  async function approveTeacher(id) {
    try {
      await API.adminApproveTeacher(id);
      showToast('Teacher approved! They can now log in.', 'success');
      loadAdminTeachers();
    } catch(e) { showToast(e.message, 'error'); }
  }
  async function rejectTeacher(id) {
    const reason = prompt('Rejection reason (shown to teacher):') || '';
    try {
      await API.adminRejectTeacher(id, reason);
      showToast('Teacher application rejected', 'info');
      loadAdminTeachers();
    } catch(e) { showToast(e.message, 'error'); }
  }

  // ══════════════════════════════════════════
  //   ADMIN: MOCK EXAMS
  // ══════════════════════════════════════════
  async function loadAdminMockExams() {
    const container = document.getElementById('adminExamList');
    container.innerHTML = '<div style="text-align:center;color:#86efac;padding:40px">Loading…</div>';
    try {
      const data = await API.adminListMockExams();
      const exams = data.exams || [];
      if (!exams.length) {
        container.innerHTML = '<div style="text-align:center;color:#86efac;padding:60px;opacity:.6">No mock exams scheduled yet. Click "Schedule New Exam" to create one.</div>';
        return;
      }
      container.innerHTML = exams.map(e => renderAdminExamRow(e)).join('');
    } catch(err) {
      container.innerHTML = `<div style="color:#f87171;padding:32px;text-align:center">${err.message}</div>`;
    }
  }

  function renderAdminExamRow(e) {
    const isActive = e.is_active === 1;
    const resultsReleased = e.results_released === 1;
    const statusLabel = resultsReleased ? 'Results Released' : isActive ? 'Active' : 'Scheduled';
    const statusColor = resultsReleased ? '#3b82f6' : isActive ? '#22c55e' : '#f59e0b';
    const avgScore = e.avg_score ? e.avg_score.toFixed(1) + '%' : '—';

    return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(34,197,94,.14);border-radius:14px;padding:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <h3 style="font-size:.95rem;font-weight:800">${escAdminHtml(e.title)}</h3>
          <span style="padding:2px 10px;border-radius:14px;font-size:.68rem;font-weight:800;color:${statusColor};border:1px solid ${statusColor}44;white-space:nowrap">${statusLabel}</span>
        </div>
        <div style="font-size:.78rem;color:#86efac;display:flex;gap:16px;flex-wrap:wrap">
          <span>📝 ${e.question_count} Qs</span>
          <span>⏱️ ${e.duration_mins} min</span>
          <span>👥 ${e.submission_count||0} submitted</span>
          <span>📊 Avg: ${avgScore}</span>
          ${e.scheduled_at ? `<span>🕐 Opens: ${new Date(e.scheduled_at).toLocaleString()}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0">
        ${!isActive && !resultsReleased ? `<button onclick="activateExam(${e.id})" style="padding:8px 14px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);border-radius:9px;font-family:inherit;font-size:.8rem;font-weight:700;cursor:pointer">▶ Activate</button>` : ''}
        ${isActive && !resultsReleased ? `<button onclick="releaseResults(${e.id})" style="padding:8px 14px;background:rgba(59,130,246,.15);color:#3b82f6;border:1px solid rgba(59,130,246,.3);border-radius:9px;font-family:inherit;font-size:.8rem;font-weight:700;cursor:pointer">📢 Release Results</button>` : ''}
        ${e.submission_count > 0 ? `<button onclick="viewExamReport(${e.id})" style="padding:8px 14px;background:rgba(167,139,250,.12);color:#a78bfa;border:1px solid rgba(167,139,250,.3);border-radius:9px;font-family:inherit;font-size:.8rem;font-weight:700;cursor:pointer">📊 Report</button>` : ''}
      </div>
    </div>`;
  }

  function openCreateExamModal() {
    document.getElementById('createExamModal').style.display = 'flex';
  }
  async function createMockExam() {
    const btn = document.getElementById('createExamBtn');
    const title = document.getElementById('newExamTitle').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await API.adminCreateMockExam({
        title,
        description: document.getElementById('newExamDesc').value.trim(),
        question_count: parseInt(document.getElementById('newExamCount').value||100),
        duration_mins: parseInt(document.getElementById('newExamDuration').value||120),
        scheduled_at: document.getElementById('newExamStart').value||null,
        ends_at: document.getElementById('newExamEnd').value||null,
        is_active: 0,
      });
      document.getElementById('createExamModal').style.display = 'none';
      showToast('Mock exam scheduled! ✅');
      loadAdminMockExams();
    } catch(err) { showToast(err.message||'Failed', 'error'); }
    finally { btn.disabled=false; btn.textContent='Create Exam'; }
  }
  async function activateExam(id) {
    if (!confirm('Activate this exam? Students will be able to start immediately.')) return;
    try { await API.adminActivateMockExam(id); showToast('Exam activated!'); loadAdminMockExams(); }
    catch(e) { showToast(e.message, 'error'); }
  }
  async function releaseResults(id) {
    if (!confirm('Release results to all students? This will also close the exam.')) return;
    try { await API.adminReleaseExamResults(id); showToast('Results released!', 'success'); loadAdminMockExams(); }
    catch(e) { showToast(e.message, 'error'); }
  }
  async function viewExamReport(id) {
    const modal = document.getElementById('examReportModal');
    const content = document.getElementById('examReportContent');
    modal.style.display = 'flex';
    content.innerHTML = '<div style="text-align:center;color:#86efac;padding:40px">Loading analytics…</div>';
    try {
      const data = await API.adminGetExamReport(id);
      const ov = data.overview || {};
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px">
          ${[['Submissions',ov.total_submissions,'#22c55e'],['Avg Score',ov.avg_score?.toFixed(1)+'%','#f59e0b'],['Pass Rate',ov.pass_rate+'%','#3b82f6'],['Highest',ov.max_score?.toFixed(1)+'%','#a78bfa']].map(([l,v,c])=>
            `<div style="background:rgba(0,0,0,.3);border:1px solid rgba(34,197,94,.12);border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.3rem;font-weight:800;color:${c}">${v||0}</div><div style="font-size:.72rem;color:#86efac;margin-top:3px">${l}</div></div>`
          ).join('')}
        </div>
        <h3 style="color:#22c55e;font-size:.88rem;font-weight:800;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Category Performance</h3>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
          ${(data.category_performance||[]).map(c=>`
            <div style="display:flex;align-items:center;gap:12px">
              <div style="font-size:.78rem;color:#86efac;width:200px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escAdminHtml(c.category)}</div>
              <div style="flex:1;height:7px;background:rgba(255,255,255,.07);border-radius:6px;overflow:hidden"><div style="width:${((c.correctness_rate||0)*100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#16a34a,#22c55e);border-radius:6px"></div></div>
              <div style="font-size:.78rem;font-weight:700;color:#22c55e;width:40px;text-align:right">${((c.correctness_rate||0)*100).toFixed(0)}%</div>
            </div>`).join('')}
        </div>
        <h3 style="color:#22c55e;font-size:.88rem;font-weight:800;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Top Students</h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${(data.top_students||[]).map((s,i)=>`
            <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px">
              <div style="width:22px;height:22px;border-radius:50%;background:rgba(34,197,94,.15);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;color:#22c55e;flex-shrink:0">${i+1}</div>
              <div style="flex:1;font-size:.83rem">${escAdminHtml(s.name)} <span style="color:#86efac;font-size:.75rem">(${escAdminHtml(s.university||'')})</span></div>
              <div style="font-weight:800;color:#22c55e;font-size:.9rem">${(s.score||0).toFixed(1)}%</div>
            </div>`).join('')}
        </div>`;
    } catch(err) {
      content.innerHTML = `<div style="color:#f87171;text-align:center;padding:40px">${err.message}</div>`;
    }
  }

  function escAdminHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Render admin pagination
  function renderAdminPagination(id, page, pages, cb) {
    const el = document.getElementById(id);
    if (!el || pages <= 1) { if(el) el.innerHTML=''; return; }
    let html = `<button onclick="${cb.name}(${Math.max(1,page-1)})" style="padding:6px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.2);border-radius:7px;color:#86efac;cursor:pointer;font-family:inherit" ${page<=1?'disabled':''}>‹</button>`;
    for(let p=Math.max(1,page-2); p<=Math.min(pages,page+2); p++) {
      html += `<button onclick="${cb.name}(${p})" style="padding:6px 12px;background:${p===page?'rgba(34,197,94,.15)':'rgba(255,255,255,.06)'};border:1px solid ${p===page?'rgba(34,197,94,.5)':'rgba(34,197,94,.2)'};border-radius:7px;color:${p===page?'#22c55e':'#86efac'};cursor:pointer;font-family:inherit;font-weight:${p===page?700:400}">${p}</button>`;
    }
    html += `<button onclick="${cb.name}(${Math.min(pages,page+1)})" style="padding:6px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(34,197,94,.2);border-radius:7px;color:#86efac;cursor:pointer;font-family:inherit" ${page>=pages?'disabled':''}>›</button>`;
    el.innerHTML = html;
  }

  // Hook into switchAdminSection
  const _origAdminSwitch = typeof switchAdminSection === 'function' ? switchAdminSection : null;
  function switchAdminSection(name) {
    if (_origAdminSwitch) _origAdminSwitch(name);
    else {
      document.querySelectorAll('.admin-section').forEach(s => s.style.display='none');
      const t = document.getElementById('admin-section-' + name);
      if (t) t.style.display = 'block';
      document.querySelectorAll('.admin-nav-link').forEach(b => b.classList.remove('active'));
      const nb = document.querySelector('.admin-nav-link[data-sec="' + name + '"]');
      if (nb) nb.classList.add('active');
    }
    if (name === 'question-bank') loadAdminQuestions();
    if (name === 'teachers')      loadAdminTeachers();
    if (name === 'mock-exams')    loadAdminMockExams();
  }
  window.switchAdminSection = switchAdminSection;
  </script>
'''

if '</body>' in content:
    content = content.replace('</body>', ADMIN_PANELS + '\n</body>', 1)
    print('SUCCESS: Admin panels injected')
else:
    print('ERROR: no </body> in admin dashboard')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('DONE')
