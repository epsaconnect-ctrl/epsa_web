/**
 * EPSA Admin — Training Management
 */

/* ── STATE ─────────────────────────────────────── */
let _adminTrainings = [];
let _adminTrainingTab = 'programs';
let _editTid = null;

/* ── INIT ──────────────────────────────────────── */
function initAdminTraining() {
  renderAdminTrainingTabs();
  loadAdminTrainings();
}

function renderAdminTrainingTabs() {
  const sec = document.getElementById('asec-trainings');
  if (!sec || sec.dataset.enhanced) return;
  sec.dataset.enhanced = '1';

  const tabBar = document.createElement('div');
  tabBar.className = 'admin-training-tabs';
  tabBar.innerHTML = `
    <button class="admin-training-tab active" data-at="programs">Programs</button>
    <button class="admin-training-tab" data-at="enrollments">Enrollments</button>
    <button class="admin-training-tab" data-at="receipts">Receipts</button>
    <button class="admin-training-tab" data-at="analytics">Analytics</button>`;
  sec.insertBefore(tabBar, sec.firstChild);

  tabBar.querySelectorAll('.admin-training-tab').forEach(btn => {
    btn.onclick = () => {
      tabBar.querySelectorAll('.admin-training-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _adminTrainingTab = btn.dataset.at;
      if (_adminTrainingTab === 'programs') loadAdminTrainings();
      else if (_adminTrainingTab === 'enrollments') renderAdminEnrollmentSelector();
      else if (_adminTrainingTab === 'receipts') loadAdminReceipts();
      else if (_adminTrainingTab === 'analytics') renderAdminAnalyticsSelector();
    };
  });
}

/* ── LOAD TRAININGS ────────────────────────────── */
async function loadAdminTrainings() {
  const tbody = document.getElementById('trainingsTbody');
  const pendingTbody = document.getElementById('trainingPendingTbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">Loading…</td></tr>';
  try {
    const list = await API.adminListTrainings();
    _adminTrainings = list;
    renderAdminTrainingList(list);
    renderAdminPendingEnrollments(list);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#b91c1c;padding:16px;">${e.message}</td></tr>`;
  }
}

function renderAdminTrainingList(list) {
  const tbody = document.getElementById('trainingsTbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#94a3b8;">No trainings yet. Create your first one.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => {
    const s = t.stats || {};
    const statusBadge = t.is_active
      ? '<span style="padding:3px 10px;border-radius:999px;background:rgba(5,150,105,0.1);color:#059669;font-size:0.72rem;font-weight:700;">Active</span>'
      : '<span style="padding:3px 10px;border-radius:999px;background:#f1f5f9;color:#94a3b8;font-size:0.72rem;font-weight:700;">Inactive</span>';
    return `<tr>
      <td><strong>${esc(t.title)}</strong><div style="font-size:0.74rem;color:#94a3b8;">${esc(t.format||'')} · ${t.module_count||0} modules</div></td>
      <td>${esc(t.format||'')}</td>
      <td>${t.is_free ? '<span style="color:#059669;font-weight:700;">Free</span>' : `ETB ${(+t.price||0).toLocaleString()}`}</td>
      <td>
        <span title="Pending" style="margin-right:4px;">⏳${s.pending||0}</span>
        <span title="Registered" style="margin-right:4px;">✅${s.registered||0}</span>
        <span title="Receipt">🧾${s.receipt||0}</span>
      </td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openEditTrainingModal(${t.id})">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="openAdminTrainingDetail(${t.id})">Manage</button>
        <button class="btn btn-ghost btn-sm" onclick="adminToggleTraining(${t.id},${t.is_active?0:1})" style="color:${t.is_active?'#dc2626':'#059669'};">${t.is_active?'Deactivate':'Activate'}</button>
      </td>
    </tr>`;
  }).join('');
}

function renderAdminPendingEnrollments(list) {
  const tbody = document.getElementById('trainingPendingTbody');
  if (!tbody) return;
  const pending = [];
  // We'll load these from the API when needed; show a button per training
  tbody.innerHTML = list.map(t => {
    const s = t.stats || {};
    if (!s.pending && !s.receipt) return '';
    return `<tr>
      <td colspan="5" style="padding:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff8f0;border-radius:12px;margin:4px 0;">
          <div>
            <strong>${esc(t.title)}</strong>
            <span style="margin-left:10px;padding:2px 8px;background:rgba(217,119,6,0.1);color:#d97706;border-radius:999px;font-size:0.72rem;font-weight:700;">${s.pending||0} pending · ${s.receipt||0} receipt</span>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openAdminEnrollments(${t.id},'${esc(t.title)}')">Review</button>
        </div>
      </td>
    </tr>`;
  }).filter(Boolean).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No pending enrollments.</td></tr>';
}

/* ── CREATE / EDIT MODAL ───────────────────────── */
function openCreateTrainingModal() {
  _editTid = null;
  showTrainingFormModal({});
}

async function openEditTrainingModal(tid) {
  _editTid = tid;
  const t = _adminTrainings.find(x => x.id === tid) || {};
  showTrainingFormModal(t);
}

function showTrainingFormModal(t) {
  let modal = document.getElementById('adminTrainingFormModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adminTrainingFormModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal" style="max-width:640px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 id="atfmTitle" style="font-family:var(--font-display);font-weight:900;font-size:1.2rem;">Create Training</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('adminTrainingFormModal').classList.remove('active')">✕</button>
      </div>
      <div id="atfmBody"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.classList.remove('active'); });
  }
  document.getElementById('atfmTitle').textContent = _editTid ? 'Edit Training' : 'Create Training';
  document.getElementById('atfmBody').innerHTML = `
    <div style="display:grid;gap:14px;">
      <div class="form-group"><label class="form-label">Title *</label><input id="atfm_title" class="form-input" value="${esc(t.title||'')}" placeholder="Training title"></div>
      <div class="form-group"><label class="form-label">Description</label><textarea id="atfm_desc" class="form-input" rows="3" placeholder="Describe this training…">${esc(t.description||'')}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Format</label>
          <select id="atfm_format" class="form-input">
            ${['online','in-person','hybrid','workshop','webinar'].map(f=>`<option value="${f}"${(t.format||'online')===f?' selected':''}>${f}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Icon (emoji)</label><input id="atfm_icon" class="form-input" value="${esc(t.icon||'🎓')}" style="font-size:1.3rem;"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Price (ETB)</label><input id="atfm_price" class="form-input" type="number" value="${t.price||0}" min="0"></div>
        <div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;margin-top:24px;">
          <input type="checkbox" id="atfm_free" ${t.is_free!==0?'checked':''}> Free training</label></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Max Participants</label><input id="atfm_max" class="form-input" type="number" value="${t.max_participants||''}" placeholder="Unlimited"></div>
        <div class="form-group"><label class="form-label">Instructor Name</label><input id="atfm_instructor" class="form-input" value="${esc(t.instructor_display_name||'')}" placeholder="Display name"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group"><label class="form-label">Certificate Title</label><input id="atfm_cert_title" class="form-input" value="${esc(t.cert_title||'')}" placeholder="Certificate of Completion"></div>
        <div class="form-group"><label class="form-label">Certificate Description</label><input id="atfm_cert_desc" class="form-input" value="${esc(t.cert_desc||'')}" placeholder="Issued by EPSA"></div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:14px;margin-top:4px;">
        <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:10px;">🔗 Linked Assessments</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group"><label class="form-label">Pre-Test Exam <span style="color:#94a3b8;font-weight:400;">(optional)</span></label>
            <select id="atfm_pre_exam" class="form-input">
              <option value="">— None —</option>
            </select>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">Shown before training starts</div>
          </div>
          <div class="form-group"><label class="form-label">Post-Test Exam <span style="color:#94a3b8;font-weight:400;">(optional)</span></label>
            <select id="atfm_post_exam" class="form-input">
              <option value="">— None —</option>
            </select>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">Required to unlock certificate</div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button class="btn btn-ghost" onclick="document.getElementById('adminTrainingFormModal').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" id="atfmSave">Save Training</button>
      </div>
    </div>`;
  modal.classList.add('active');
  document.getElementById('atfmSave').onclick = saveTrainingForm;
  // Populate exam dropdowns async
  _loadExamOptions(t.pre_exam_id, t.post_exam_id);
}

async function _loadExamOptions(preId, postId) {
  try {
    const list = await API.adminListMockExams();
    const exams = Array.isArray(list) ? list : (list.exams || []);
    const opts = '<option value="">— None —</option>' +
      exams.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
    const pre = document.getElementById('atfm_pre_exam');
    const post = document.getElementById('atfm_post_exam');
    if (pre) { pre.innerHTML = opts; if (preId) pre.value = preId; }
    if (post) { post.innerHTML = opts; if (postId) post.value = postId; }
  } catch { /* exams not critical */ }
}

async function saveTrainingForm() {
  const btn = document.getElementById('atfmSave');
  const data = {
    title: document.getElementById('atfm_title').value.trim(),
    description: document.getElementById('atfm_desc').value.trim(),
    format: document.getElementById('atfm_format').value,
    icon: document.getElementById('atfm_icon').value.trim() || '🎓',
    price: parseFloat(document.getElementById('atfm_price').value) || 0,
    is_free: document.getElementById('atfm_free').checked ? 1 : 0,
    max_participants: parseInt(document.getElementById('atfm_max').value) || null,
    instructor_display_name: document.getElementById('atfm_instructor').value.trim(),
    cert_title: document.getElementById('atfm_cert_title').value.trim(),
    cert_desc: document.getElementById('atfm_cert_desc').value.trim(),
    pre_exam_id: parseInt(document.getElementById('atfm_pre_exam')?.value) || null,
    post_exam_id: parseInt(document.getElementById('atfm_post_exam')?.value) || null,
  };
  if (!data.title) { if(typeof showToast==='function') showToast('Title required','error'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (_editTid) await API.adminUpdateTraining(_editTid, data);
    else await API.adminCreateTraining(data);
    if(typeof showToast==='function') showToast(_editTid?'Training updated':'Training created','success');
    document.getElementById('adminTrainingFormModal').classList.remove('active');
    loadAdminTrainings();
  } catch(e) {
    if(typeof showToast==='function') showToast(e.message||'Failed','error');
  } finally { btn.disabled=false; btn.textContent='Save Training'; }
}

async function adminToggleTraining(tid, newActive) {
  try {
    await API.adminUpdateTraining(tid, { is_active: newActive });
    if(typeof showToast==='function') showToast(newActive?'Training activated':'Training deactivated','success');
    loadAdminTrainings();
  } catch(e) { if(typeof showToast==='function') showToast(e.message||'Failed','error'); }
}

function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── ENROLLMENTS ───────────────────────────────── */
let _enrollTid = null;

function renderAdminEnrollmentSelector() {
  const sec = document.getElementById('asec-trainings');
  let panel = document.getElementById('adminEnrollPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'adminEnrollPanel';
    sec.appendChild(panel);
  }
  panel.innerHTML = `<div style="margin-bottom:14px;font-size:0.85rem;color:#64748b;">Select a training to manage enrollments:</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
    ${_adminTrainings.map(t => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:white;border:1px solid #e2e8f0;border-radius:14px;">
        <div><strong>${esc(t.title)}</strong><span style="margin-left:10px;font-size:0.76rem;color:#94a3b8;">${(t.stats||{}).total||0} applicants</span></div>
        <button class="btn btn-primary btn-sm" onclick="openAdminEnrollments(${t.id},'${esc(t.title)}')">Manage</button>
      </div>`).join('')}
    </div>`;
}

async function openAdminEnrollments(tid, title) {
  _enrollTid = tid;
  let modal = document.getElementById('adminEnrollModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adminEnrollModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal" style="max-width:900px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h3 id="aemTitle" style="font-family:var(--font-display);font-weight:900;font-size:1.1rem;"></h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('adminEnrollModal').classList.remove('active')">✕</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:14px;" id="aemFilters">
        ${['all','pending','approved','receipt','registered','rejected'].map((s,i)=>`<span class="pill-tab${i===0?' active':''}" onclick="loadEnrollmentsFiltered('${s}',this)">${s}</span>`).join('')}
      </div>
      <div id="aemBody" style="max-height:480px;overflow-y:auto;"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.classList.remove('active'); });
  }
  document.getElementById('aemTitle').textContent = `Enrollments — ${title}`;
  modal.classList.add('active');
  await loadEnrollmentsFiltered('all');
}

async function loadEnrollmentsFiltered(status, tabEl) {
  if (tabEl) {
    document.querySelectorAll('#aemFilters .pill-tab').forEach(t=>t.classList.remove('active'));
    tabEl.classList.add('active');
  }
  const body = document.getElementById('aemBody');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">Loading…</div>';
  try {
    const list = await API.adminGetEnrollments(_enrollTid, status);
    if (!list.length) { body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">No enrollments found.</div>'; return; }
    body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8fafc;font-size:0.74rem;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">
        <th style="padding:10px 12px;text-align:left;">Student</th>
        <th style="padding:10px 12px;">University</th>
        <th style="padding:10px 12px;">Status</th>
        <th style="padding:10px 12px;">Submitted</th>
        <th style="padding:10px 12px;">Actions</th>
      </tr></thead>
      <tbody>${list.map(e => {
        const name = `${e.first_name||''} ${e.father_name||''}`.trim();
        const statusColors = {pending:'#d97706',approved:'#2563eb',registered:'#059669',rejected:'#dc2626',receipt:'#7c3aed',waitlisted:'#94a3b8'};
        const col = statusColors[e.status] || '#64748b';
        const actions = [];
        if (e.status === 'pending') {
          actions.push(`<button class="btn btn-primary btn-sm" onclick="adminApprove(${e.id})">Approve</button>`);
          actions.push(`<button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="adminReject(${e.id})">Reject</button>`);
        }
        if (e.status === 'receipt' || e.status === 'approved') {
          actions.push(`<button class="btn btn-primary btn-sm" onclick="adminRegister(${e.id})">Confirm</button>`);
          if (e.receipt_path) actions.push(`<a href="/api/trainings/receipt/${e.id}/file" target="_blank" class="btn btn-ghost btn-sm">View Receipt</a>`);
        }
        return `<tr style="border-bottom:1px solid #f1f5f9;font-size:0.84rem;">
          <td style="padding:10px 12px;"><div style="font-weight:700;">${esc(name)}</div><div style="font-size:0.72rem;color:#94a3b8;">${esc(e.email||'')}</div></td>
          <td style="padding:10px 12px;color:#64748b;">${esc(e.university||'')}</td>
          <td style="padding:10px 12px;"><span style="padding:3px 10px;border-radius:999px;background:${col}20;color:${col};font-size:0.72rem;font-weight:700;">${e.status}</span></td>
          <td style="padding:10px 12px;color:#94a3b8;font-size:0.76rem;">${(e.submitted_at||'').slice(0,10)}</td>
          <td style="padding:10px 12px;">${actions.join(' ')}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch(err) { body.innerHTML = `<div style="padding:20px;color:#b91c1c;">${err.message}</div>`; }
}

async function adminApprove(aid) {
  try {
    await API.adminApproveEnrollment(_enrollTid, aid);
    if(typeof showToast==='function') showToast('Approved','success');
    await loadEnrollmentsFiltered('all');
    loadAdminTrainings();
  } catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function adminReject(aid) {
  const reason = prompt('Rejection reason (optional):') || '';
  try {
    await API.adminRejectEnrollment(_enrollTid, aid, reason);
    if(typeof showToast==='function') showToast('Rejected','success');
    await loadEnrollmentsFiltered('all');
    loadAdminTrainings();
  } catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function adminRegister(aid) {
  try {
    await API.adminRegisterEnrollment(_enrollTid, aid);
    if(typeof showToast==='function') showToast('Enrollment confirmed — student now has access','success');
    await loadEnrollmentsFiltered('all');
    loadAdminTrainings();
  } catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}


/* ── TRAINING DETAIL MANAGER ───────────────────── */
async function openAdminTrainingDetail(tid) {
  const t = _adminTrainings.find(x => x.id === tid) || {};
  let modal = document.getElementById('adminTrainingDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adminTrainingDetailModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal" style="max-width:860px;padding:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e2e8f0;">
        <div id="atdTitle" style="font-family:var(--font-display);font-weight:900;font-size:1.1rem;"></div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('adminTrainingDetailModal').classList.remove('active')">✕</button>
      </div>
      <div style="display:flex;gap:0;padding:0 22px;border-bottom:1px solid #e2e8f0;background:#fafafa;overflow-x:auto;" id="atdTabs">
        ${['modules','sessions','announcements','analytics'].map((tab,i)=>
          `<button class="th-tab${i===0?' active':''}" onclick="switchAtdTab('${tab}',this)">${tab.charAt(0).toUpperCase()+tab.slice(1)}</button>`
        ).join('')}
      </div>
      <div style="padding:20px;max-height:520px;overflow-y:auto;" id="atdBody"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.classList.remove('active'); });
  }
  document.getElementById('atdTitle').textContent = t.title || 'Training Manager';
  modal._tid = tid;
  modal.classList.add('active');
  document.querySelectorAll('#atdTabs .th-tab').forEach((b,i) => b.classList.toggle('active', i===0));
  await renderAtdModules(tid, document.getElementById('atdBody'));
}

async function switchAtdTab(tab, btn) {
  document.querySelectorAll('#atdTabs .th-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const modal = document.getElementById('adminTrainingDetailModal');
  const tid = modal._tid;
  const body = document.getElementById('atdBody');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">Loading…</div>';
  if (tab === 'modules') await renderAtdModules(tid, body);
  else if (tab === 'sessions') await renderAtdSessions(tid, body);
  else if (tab === 'announcements') await renderAtdAnnouncements(tid, body);
  else if (tab === 'analytics') await renderAtdAnalytics(tid, body);
}

/* ── MODULE BUILDER ─────────────────────────────── */
async function renderAtdModules(tid, body) {
  const mods = await API.adminGetModules(tid);
  body.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
      <button class="btn btn-primary btn-sm" onclick="openModuleForm(${tid},null)">+ Add Module</button>
    </div>
    <div class="admin-module-builder">
      ${mods.length ? mods.map((m,i) => `
        <div class="admin-module-row">
          <span class="admin-module-num">${i+1}</span>
          <div class="admin-module-info">
            <div class="admin-module-title">${esc(m.title)}</div>
            <div class="admin-module-subtitle">${m.estimated_mins||0} min${m.video_url?' · Video':''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openModuleForm(${tid},${m.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="deleteModule(${tid},${m.id})">Del</button>
        </div>`).join('') : '<div style="padding:24px;text-align:center;color:#94a3b8;">No modules yet.</div>'}
    </div>`;
}

function openModuleForm(tid, mid) {
  let fm = document.getElementById('adminModuleFormModal');
  if (!fm) {
    fm = document.createElement('div'); fm.id = 'adminModuleFormModal'; fm.className = 'modal-overlay';
    fm.innerHTML = `<div class="modal" style="max-width:640px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h3 id="amfTitle" style="font-family:var(--font-display);font-weight:800;">Module</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('adminModuleFormModal').classList.remove('active')">✕</button>
      </div>
      <div id="amfBody"></div>
    </div>`;
    document.body.appendChild(fm);
    fm.addEventListener('click', e => { if(e.target===fm) fm.classList.remove('active'); });
  }
  fm._tid = tid; fm._mid = mid;
  document.getElementById('amfTitle').textContent = mid ? 'Edit Module' : 'Add Module';
  document.getElementById('amfBody').innerHTML = `
    <div style="display:grid;gap:12px;">
      <div class="form-group"><label class="form-label">Title *</label><input id="amf_title" class="form-input" placeholder="Module title"></div>
      <div class="form-group"><label class="form-label">Summary</label><input id="amf_summary" class="form-input" placeholder="Short description"></div>
      <div class="form-group"><label class="form-label">Content HTML</label><textarea id="amf_content" class="form-input" rows="5" placeholder="<p>Content…</p>"></textarea></div>
      <div class="form-group"><label class="form-label">Video Embed URL</label><input id="amf_video" class="form-input" placeholder="https://www.youtube.com/embed/…"></div>
      <div class="form-group"><label class="form-label">Est. Minutes</label><input id="amf_mins" class="form-input" type="number" value="30" min="0"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-ghost" onclick="document.getElementById('adminModuleFormModal').classList.remove('active')">Cancel</button>
        <button class="btn btn-primary" onclick="saveModuleForm()">Save</button>
      </div>
    </div>`;
  fm.classList.add('active');
}

async function saveModuleForm() {
  const fm = document.getElementById('adminModuleFormModal');
  const tid = fm._tid, mid = fm._mid;
  const data = {
    title: document.getElementById('amf_title').value.trim(),
    summary: document.getElementById('amf_summary').value.trim(),
    content_html: document.getElementById('amf_content').value,
    video_url: document.getElementById('amf_video').value.trim(),
    estimated_mins: parseInt(document.getElementById('amf_mins').value) || 0,
  };
  if (!data.title) { if(typeof showToast==='function') showToast('Title required','error'); return; }
  try {
    if (mid) await API.adminUpdateModule(tid, mid, data); else await API.adminCreateModule(tid, data);
    if(typeof showToast==='function') showToast('Saved','success');
    fm.classList.remove('active');
    await renderAtdModules(tid, document.getElementById('atdBody'));
  } catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function deleteModule(tid, mid) {
  if (!confirm('Delete module?')) return;
  try { await API.adminDeleteModule(tid, mid); await renderAtdModules(tid, document.getElementById('atdBody')); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

/* ── SESSIONS ───────────────────────────────────── */
async function renderAtdSessions(tid, body) {
  const sess = await API.adminGetSessions(tid);
  body.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <input id="sessTitle" class="form-input" style="flex:1;min-width:180px;" placeholder="Session title">
      <input id="sessStart" class="form-input" style="width:200px;" type="datetime-local">
      <input id="sessMeet"  class="form-input" style="flex:1;min-width:180px;" placeholder="Meet URL">
      <button class="btn btn-primary btn-sm" onclick="addSession(${tid})">Add</button>
    </div>
    ${sess.map(s=>`
      <div class="th-session-card" style="margin-bottom:8px;">
        <div style="flex:1;">
          <div class="th-session-title">${esc(s.title)}</div>
          <div class="th-session-time">${s.starts_at||'TBA'}</div>
          ${s.meet_url?`<div style="font-size:0.76rem;color:#2563eb;">📹 ${esc(s.meet_url)}</div>`:''}
        </div>
        <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="deleteSession(${tid},${s.id})">Del</button>
      </div>`).join('') || '<div style="color:#94a3b8;font-size:0.84rem;">No sessions yet.</div>'}`;
}

async function addSession(tid) {
  const title = document.getElementById('sessTitle')?.value.trim();
  if (!title) { if(typeof showToast==='function') showToast('Title required','error'); return; }
  const data = { title, starts_at: document.getElementById('sessStart')?.value||null, meet_url: document.getElementById('sessMeet')?.value||'', session_type:'live' };
  try { await API.adminCreateSession(tid, data); await renderAtdSessions(tid, document.getElementById('atdBody')); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function deleteSession(tid, sid) {
  if (!confirm('Delete session?')) return;
  try { await API.adminDeleteSession(tid, sid); await renderAtdSessions(tid, document.getElementById('atdBody')); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

/* ── ANNOUNCEMENTS ──────────────────────────────── */
async function renderAtdAnnouncements(tid, body) {
  const anns = await API.adminGetAnnouncements(tid);
  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <input id="annTitle" class="form-input" style="flex:1;" placeholder="Announcement title *">
      <button class="btn btn-primary btn-sm" onclick="postAnnouncement(${tid})">Post</button>
    </div>
    <textarea id="annBody" class="form-input" rows="2" placeholder="Body (optional)" style="width:100%;margin-bottom:14px;"></textarea>
    ${anns.map(a=>`
      <div style="padding:10px 14px;background:white;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div><div style="font-weight:700;font-size:0.86rem;">${a.pinned?'📌 ':''}${esc(a.title)}</div><div style="font-size:0.78rem;color:#64748b;">${esc(a.body||'')}</div></div>
        <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="deleteAnnouncement(${tid},${a.id})">✕</button>
      </div>`).join('') || '<div style="color:#94a3b8;font-size:0.82rem;">No announcements yet.</div>'}`;
}

async function postAnnouncement(tid) {
  const title = document.getElementById('annTitle')?.value.trim();
  if (!title) { if(typeof showToast==='function') showToast('Title required','error'); return; }
  try { await API.adminCreateAnnouncement(tid,{title, body: document.getElementById('annBody')?.value||''}); await renderAtdAnnouncements(tid, document.getElementById('atdBody')); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function deleteAnnouncement(tid, anid) {
  try { await API.adminDeleteAnnouncement(tid, anid); await renderAtdAnnouncements(tid, document.getElementById('atdBody')); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

/* ── ANALYTICS ──────────────────────────────────── */
async function renderAtdAnalytics(tid, body) {
  try {
    const d = await API.adminTrainingAnalytics(tid);
    const s = d.stats || {};
    body.innerHTML = `
      <div class="admin-train-analytics-grid">
        ${[['Total',s.total,'#0f172a'],['Pending',s.pending,'#d97706'],['Registered',s.registered,'#059669'],['Certs',s.certificates_issued,'#7c3aed']].map(([l,v,c])=>
          `<div class="admin-train-kpi"><div class="admin-train-kpi-num" style="color:${c};">${v||0}</div><div class="admin-train-kpi-label">${l}</div></div>`).join('')}
      </div>
      <div style="font-weight:800;margin-bottom:10px;">Module Completion</div>
      ${d.module_progress.map(m=>`
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="flex:1;font-size:0.84rem;">${esc(m.title)}</div>
          <div style="width:120px;background:#f1f5f9;border-radius:999px;height:6px;">
            <div style="height:100%;background:#1a6b3c;border-radius:999px;width:${s.registered>0?Math.round((m.completed_count/s.registered)*100):0}%;"></div>
          </div>
          <div style="font-size:0.76rem;color:#64748b;">${m.completed_count}</div>
        </div>`).join('') || '<div style="color:#94a3b8;font-size:0.82rem;">No data.</div>'}`;
  } catch(e) { body.innerHTML = `<div style="color:#b91c1c;padding:20px;">${e.message}</div>`; }
}

/* ── RECEIPTS ───────────────────────────────────── */
async function loadAdminReceipts() {
  try {
    const list = await API.adminAllReceipts();
    const tbody = document.getElementById('receiptsTbody');
    if (!tbody) return;
    tbody.innerHTML = list.length ? list.map(r=>{
      const name = `${r.first_name||''} ${r.father_name||''}`.trim();
      return `<tr>
        <td>${esc(name)}<div style="font-size:0.72rem;color:#94a3b8;">${esc(r.email||'')}</div></td>
        <td>${esc(r.training_title||'')}</td>
        <td>ETB ${(+r.price||0).toLocaleString()}</td>
        <td>${(r.submitted_at||'').slice(0,10)}</td>
        <td>${r.receipt_path?`<a href="/api/trainings/receipt/${r.id}/file" target="_blank" class="btn btn-ghost btn-sm">View</a>`:'—'}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="adminRegisterFromReceipt(${r.training_id},${r.id})">Confirm</button>
          <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="adminRejectReceipt(${r.training_id},${r.id})">Reject</button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">No pending receipts.</td></tr>';
  } catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function adminRegisterFromReceipt(tid, aid) {
  try { await API.adminRegisterEnrollment(tid,aid); if(typeof showToast==='function') showToast('Confirmed','success'); loadAdminReceipts(); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

async function adminRejectReceipt(tid, aid) {
  try { await API.adminRejectEnrollment(tid,aid,'Receipt rejected'); if(typeof showToast==='function') showToast('Rejected','success'); loadAdminReceipts(); }
  catch(e) { if(typeof showToast==='function') showToast(e.message,'error'); }
}

function renderAdminAnalyticsSelector() {
  const sec = document.getElementById('asec-trainings');
  let panel = document.getElementById('adminAnalyticsPanel');
  if (!panel) { panel = document.createElement('div'); panel.id='adminAnalyticsPanel'; sec.appendChild(panel); }
  panel.innerHTML = `<div style="margin-bottom:14px;font-size:0.85rem;color:#64748b;">Select a training to view analytics:</div>
    ${_adminTrainings.map(t=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:white;border:1px solid #e2e8f0;border-radius:14px;margin-bottom:8px;">
        <strong>${esc(t.title)}</strong>
        <button class="btn btn-ghost btn-sm" onclick="openAdminTrainingDetail(${t.id})">Analytics</button>
      </div>`).join('')}`;
}


