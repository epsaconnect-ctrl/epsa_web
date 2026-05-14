/**
 * EPSA Admin — Training Management (Professional Rewrite)
 * =========================================================
 * Fixes:
 *  1. "Loading forever" — uses self-managed panel divs, not DOM tbody lookups
 *  2. Tab not clickable  — proper panel show/hide with active class
 *  3. Exam selector      — shows Exam Center exams, NOT mock exams
 * Features:
 *  - Cover photo upload (Supabase training_graphics)
 *  - Rich WYSIWYG module editor
 *  - Inline quiz builder per module
 *  - Beautiful card-grid UI
 */

/* ════════════════════════════════════════════════════════
   PART A — STATE, INIT, TAB SYSTEM, PROGRAMS PANEL
   ════════════════════════════════════════════════════════ */

/* ── State ─────────────────────────────────────────────── */
let _atState = {
  trainings: [],
  tab: 'programs',
  editTid: null,
  enrollTid: null,
  detailTid: null,
  detailTab: 'modules',
};

/* ── Helpers ───────────────────────────────────────────── */
function atEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function atFmt(dt) {
  if (!dt) return '—';
  try { return new Date(dt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }
  catch { return dt; }
}

/* ── Main init (called when admin switches to training section) ── */
function initAdminTraining() {
  _buildAdminTrainingShell();
  _switchAdminTrainingTab('programs');
  _loadAdminTrainingPrograms();
}
window.initAdminTraining = initAdminTraining;

/* ── Shell builder ─────────────────────────────────────── */
function _buildAdminTrainingShell() {
  const sec = _atSection();
  if (!sec || sec.dataset.atBuilt) return;
  sec.dataset.atBuilt = '1';

  // Clear any existing content that might cause conflicts
  sec.querySelectorAll('.admin-training-tabs,.at-panel-wrap').forEach(el => el.remove());

  const tabBar = document.createElement('div');
  tabBar.className = 'admin-training-tabs';
  tabBar.innerHTML = `
    <button class="admin-training-tab active" data-at="programs" onclick="_switchAdminTrainingTab('programs',this)">
      <span class="at-tab-icon">📋</span> Programs
    </button>
    <button class="admin-training-tab" data-at="enrollments" onclick="_switchAdminTrainingTab('enrollments',this)">
      <span class="at-tab-icon">👥</span> Enrollments
    </button>
    <button class="admin-training-tab" data-at="receipts" onclick="_switchAdminTrainingTab('receipts',this)">
      <span class="at-tab-icon">🧾</span> Receipts
    </button>
    <button class="admin-training-tab" data-at="analytics" onclick="_switchAdminTrainingTab('analytics',this)">
      <span class="at-tab-icon">📊</span> Analytics
    </button>`;
  sec.insertBefore(tabBar, sec.firstChild);

  const wrap = document.createElement('div');
  wrap.className = 'at-panel-wrap';
  wrap.innerHTML = `
    <div class="at-panel active" id="at-panel-programs"></div>
    <div class="at-panel" id="at-panel-enrollments"></div>
    <div class="at-panel" id="at-panel-receipts"></div>
    <div class="at-panel" id="at-panel-analytics"></div>`;
  sec.appendChild(wrap);
}

function _atSection() {
  return document.getElementById('asec-trainings')
    || document.querySelector('[data-section="trainings"]')
    || document.querySelector('.admin-section.trainings');
}

/* ── Tab switching ─────────────────────────────────────── */
function _switchAdminTrainingTab(tab, btn) {
  _atState.tab = tab;
  document.querySelectorAll('.admin-training-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.at === tab);
  });
  document.querySelectorAll('.at-panel').forEach(p => {
    p.classList.toggle('active', p.id === `at-panel-${tab}`);
  });
  if (tab === 'programs') _loadAdminTrainingPrograms();
  else if (tab === 'enrollments') _renderEnrollmentPanel();
  else if (tab === 'receipts') _loadAdminReceipts();
  else if (tab === 'analytics') _renderAnalyticsPanel();
}
window._switchAdminTrainingTab = _switchAdminTrainingTab;

/* ── Programs panel ────────────────────────────────────── */
async function _loadAdminTrainingPrograms() {
  const panel = document.getElementById('at-panel-programs');
  if (!panel) return;
  panel.innerHTML = `
    <div class="at-loading">
      <div class="at-spinner"></div>
      <div>Loading training programs…</div>
    </div>`;
  try {
    // Use the covers endpoint so cover_image_url is already resolved
    const list = await API.adminListTrainingsWithCovers();
    _atState.trainings = Array.isArray(list) ? list : [];
    _renderProgramsPanel(_atState.trainings);
  } catch (e) {
    panel.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`;
  }
}
window.loadAdminTrainings = _loadAdminTrainingPrograms; // backward-compat alias

function _renderProgramsPanel(list) {
  const panel = document.getElementById('at-panel-programs');
  if (!panel) return;

  panel.innerHTML = `
    <div class="at-programs-header">
      <div>
        <div class="at-programs-title">Training Programs</div>
        <div class="at-programs-sub">${list.length} program${list.length !== 1 ? 's' : ''} total</div>
      </div>
      <button class="btn btn-primary" onclick="openCreateTrainingModal()" id="btnCreateTraining">
        <span>＋</span> New Training
      </button>
    </div>

    ${list.length === 0 ? `
      <div class="at-empty-state">
        <div class="at-empty-icon">🎓</div>
        <div class="at-empty-title">No Training Programs Yet</div>
        <div class="at-empty-desc">Create your first professional training program to get started.</div>
        <button class="btn btn-primary" onclick="openCreateTrainingModal()">Create First Training</button>
      </div>` : `
      <div class="at-programs-grid">
        ${list.map(t => _renderTrainingCard(t)).join('')}
      </div>`}`;
}

function _renderTrainingCard(t) {
  const s = t.stats || {};
  const isActive = t.is_active;
  const coverStyle = t.cover_image_url
    ? `background-image:url('${atEsc(t.cover_image_url)}');background-size:cover;background-position:center;`
    : `background:linear-gradient(135deg,#0d3d21,#1a6b3c);`;
  return `
    <div class="at-training-card">
      <div class="at-card-banner" style="${coverStyle}">
        ${!t.cover_image_url ? `<div class="at-card-icon">${atEsc(t.icon || '🎓')}</div>` : ''}
        <div class="at-card-overlay">
          <span class="at-card-format-badge">${atEsc(t.format || 'online')}</span>
          <span class="at-card-status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
      <div class="at-card-body">
        <div class="at-card-title">${atEsc(t.title)}</div>
        ${t.instructor_display_name ? `<div class="at-card-instructor">👤 ${atEsc(t.instructor_display_name)}</div>` : ''}
        <div class="at-card-stats">
          <div class="at-stat-chip pending">⏳ ${s.pending || 0} Pending</div>
          <div class="at-stat-chip registered">✅ ${s.registered || 0} Enrolled</div>
          <div class="at-stat-chip cert">🏆 ${s.certificates_issued || 0} Certs</div>
        </div>
        <div class="at-card-meta">
          <span>${t.module_count || 0} modules</span>
          <span>·</span>
          <span>${t.is_free || +t.price === 0 ? '🆓 Free' : `ETB ${(+t.price || 0).toLocaleString()}`}</span>
        </div>
      </div>
      <div class="at-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditTrainingModal(${t.id})">✏️ Edit</button>
        <button class="btn btn-primary btn-sm" onclick="openAdminTrainingDetail(${t.id})">⚙️ Manage</button>
        <button class="btn btn-ghost btn-sm at-toggle-btn" onclick="adminToggleTraining(${t.id},${isActive ? 0 : 1})" style="color:${isActive ? '#dc2626' : '#059669'};">
          ${isActive ? '⏸ Deactivate' : '▶ Activate'}
        </button>
      </div>
    </div>`;
}

/* ── Toggle active state ───────────────────────────────── */
async function adminToggleTraining(tid, newActive) {
  try {
    await API.adminUpdateTraining(tid, { is_active: newActive });
    if (typeof showToast === 'function') showToast(newActive ? 'Training activated' : 'Training deactivated', 'success');
    _loadAdminTrainingPrograms();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Failed', 'error');
  }
}
window.adminToggleTraining = adminToggleTraining;

/* ════════════════════════════════════════════════════════
   PART B — CREATE / EDIT TRAINING MODAL
   ════════════════════════════════════════════════════════ */

let _coverFileToUpload = null; // holds File object before training is saved

function openCreateTrainingModal() {
  _atState.editTid = null;
  _coverFileToUpload = null;
  _showTrainingFormModal({});
}
window.openCreateTrainingModal = openCreateTrainingModal;

async function openEditTrainingModal(tid) {
  _atState.editTid = tid;
  _coverFileToUpload = null;
  const t = _atState.trainings.find(x => x.id === tid) || {};
  _showTrainingFormModal(t);
}
window.openEditTrainingModal = openEditTrainingModal;

function _showTrainingFormModal(t) {
  let modal = document.getElementById('atfModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'atfModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }

  const isEdit = !!_atState.editTid;
  modal.innerHTML = `
    <div class="modal" style="max-width:700px;padding:0;overflow:hidden;border-radius:24px;">
      <!-- Modal header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;">
        <div>
          <div style="font-family:var(--font-display,'Outfit',sans-serif);font-weight:900;font-size:1.2rem;color:#0f172a;">
            ${isEdit ? '✏️ Edit Training' : '🎓 Create New Training'}
          </div>
          <div style="font-size:0.76rem;color:#94a3b8;margin-top:2px;">
            ${isEdit ? 'Update training program details' : 'Set up a professional training program'}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('atfModal').classList.remove('active')" style="border-radius:12px;">✕</button>
      </div>

      <div style="overflow-y:auto;max-height:calc(90vh - 130px);padding:24px;">
        <div style="display:grid;gap:18px;">

          <!-- Cover Photo Upload Zone -->
          <div>
            <label class="form-label" style="margin-bottom:8px;display:block;">📷 Training Cover Photo <span style="color:#94a3b8;font-weight:400;">(appears on student card)</span></label>
            <div id="atfCoverZone" class="at-cover-upload-zone" onclick="document.getElementById('atfCoverInput').click()">
              <div id="atfCoverPreview" style="display:none;position:relative;">
                <img id="atfCoverImg" style="width:100%;height:160px;object-fit:cover;border-radius:12px;display:block;" />
                <button type="button" onclick="event.stopPropagation();_atClearCover()" class="at-cover-remove">✕ Remove</button>
              </div>
              <div id="atfCoverPlaceholder">
                <div style="font-size:2.5rem;margin-bottom:8px;">🖼️</div>
                <div style="font-weight:700;color:#334155;font-size:0.9rem;">Upload Cover Image</div>
                <div style="font-size:0.76rem;color:#94a3b8;margin-top:4px;">Drag & drop or click · JPG, PNG, WEBP</div>
              </div>
            </div>
            <input type="file" id="atfCoverInput" accept="image/*" style="display:none;" onchange="_atHandleCoverFile(this.files[0])">
            ${t.cover_image_url ? `<div style="font-size:0.72rem;color:#059669;margin-top:4px;">✅ Current cover image saved</div>` : ''}
          </div>

          <!-- Title -->
          <div class="form-group">
            <label class="form-label">Training Title *</label>
            <input id="atf_title" class="form-input" value="${atEsc(t.title || '')}" placeholder="e.g. Psychology Research Methods Workshop">
          </div>

          <!-- Description -->
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea id="atf_desc" class="form-input" rows="3" placeholder="Describe what students will learn…">${atEsc(t.description || '')}</textarea>
          </div>

          <!-- Format + Instructor -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="form-group">
              <label class="form-label">Format</label>
              <select id="atf_format" class="form-input">
                ${['online','in-person','hybrid','workshop','webinar'].map(f =>
                  `<option value="${f}" ${(t.format || 'online') === f ? 'selected' : ''}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Instructor Name</label>
              <input id="atf_instructor" class="form-input" value="${atEsc(t.instructor_display_name || '')}" placeholder="Display name">
            </div>
          </div>

          <!-- Price -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:end;">
            <div class="form-group">
              <label class="form-label">Price (ETB)</label>
              <input id="atf_price" class="form-input" type="number" value="${t.price || 0}" min="0">
            </div>
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="atf_free" ${(t.is_free !== 0) ? 'checked' : ''} onchange="document.getElementById('atf_price').disabled=this.checked">
                <span>Free Training</span>
              </label>
              <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">No payment required</div>
            </div>
          </div>

          <!-- Max Participants -->
          <div class="form-group">
            <label class="form-label">Max Participants <span style="color:#94a3b8;font-weight:400;">(leave blank for unlimited)</span></label>
            <input id="atf_max" class="form-input" type="number" value="${t.max_participants || ''}" placeholder="Unlimited">
          </div>

          <!-- Certificate -->
          <div style="border-top:1px solid #f1f5f9;padding-top:16px;">
            <div style="font-size:0.76rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:12px;">🏆 Certificate</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div class="form-group">
                <label class="form-label">Certificate Title</label>
                <input id="atf_cert_title" class="form-input" value="${atEsc(t.cert_title || '')}" placeholder="Certificate of Completion">
              </div>
              <div class="form-group">
                <label class="form-label">Issued By</label>
                <input id="atf_cert_desc" class="form-input" value="${atEsc(t.cert_desc || '')}" placeholder="Ethiopian Psychology Students Association">
              </div>
            </div>
          </div>

          <!-- Linked Assessments — EXAM CENTER ONLY -->
          <div style="border-top:1px solid #f1f5f9;padding-top:16px;">
            <div style="font-size:0.76rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:4px;">🔗 Linked Assessments</div>
            <div style="font-size:0.76rem;color:#2563eb;background:rgba(37,99,235,0.07);border-radius:8px;padding:8px 12px;margin-bottom:12px;">
              ℹ️ These link to <strong>Exam Center</strong> exams — NOT Mock Exams. Students take these in the <strong>Exam</strong> section of their portal.
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div class="form-group">
                <label class="form-label">Pre-Test Exam <span style="color:#94a3b8;font-weight:400;">(optional)</span></label>
                <select id="atf_pre_exam" class="form-input">
                  <option value="">— None —</option>
                </select>
                <div style="font-size:0.7rem;color:#64748b;margin-top:4px;">Shown before training starts</div>
              </div>
              <div class="form-group">
                <label class="form-label">Post-Test Exam <span style="color:#94a3b8;font-weight:400;">(optional)</span></label>
                <select id="atf_post_exam" class="form-input">
                  <option value="">— None —</option>
                </select>
                <div style="font-size:0.7rem;color:#64748b;margin-top:4px;">Required to unlock certificate</div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <button class="btn btn-ghost" onclick="document.getElementById('atfModal').classList.remove('active')">Cancel</button>
            <button class="btn btn-primary" id="atfSaveBtn" onclick="_saveTrainingForm()">
              ${isEdit ? '💾 Save Changes' : '🚀 Create Training'}
            </button>
          </div>
        </div>
      </div>
    </div>`;

  modal.classList.add('active');
  _loadRealExamOptions(t.pre_exam_id, t.post_exam_id);

  // Drag & drop for cover
  const zone = document.getElementById('atfCoverZone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) _atHandleCoverFile(f);
    });
  }

  // Init price state
  const freeChk = document.getElementById('atf_free');
  const priceInp = document.getElementById('atf_price');
  if (freeChk && priceInp) priceInp.disabled = freeChk.checked;
}

function _atHandleCoverFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  _coverFileToUpload = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('atfCoverImg');
    const preview = document.getElementById('atfCoverPreview');
    const placeholder = document.getElementById('atfCoverPlaceholder');
    if (img) img.src = e.target.result;
    if (preview) preview.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}
window._atHandleCoverFile = _atHandleCoverFile;

function _atClearCover() {
  _coverFileToUpload = null;
  const preview = document.getElementById('atfCoverPreview');
  const placeholder = document.getElementById('atfCoverPlaceholder');
  if (preview) preview.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
  const inp = document.getElementById('atfCoverInput');
  if (inp) inp.value = '';
}
window._atClearCover = _atClearCover;

async function _loadRealExamOptions(preId, postId) {
  try {
    const exams = await API.adminListRealExams();
    const list = Array.isArray(exams) ? exams : [];
    const opts = '<option value="">— None —</option>' +
      list.map(e => `<option value="${e.id}">${atEsc(e.title)}${e.is_active ? '' : ' (Inactive)'}</option>`).join('');
    const pre = document.getElementById('atf_pre_exam');
    const post = document.getElementById('atf_post_exam');
    if (pre) { pre.innerHTML = opts; if (preId) pre.value = preId; }
    if (post) { post.innerHTML = opts; if (postId) post.value = postId; }
  } catch {
    // exam center might be empty — that's fine
  }
}

async function _saveTrainingForm() {
  const btn = document.getElementById('atfSaveBtn');
  const title = document.getElementById('atf_title')?.value.trim();
  if (!title) { if (typeof showToast === 'function') showToast('Title is required', 'error'); return; }

  const data = {
    title,
    description: document.getElementById('atf_desc')?.value.trim() || '',
    format: document.getElementById('atf_format')?.value || 'online',
    instructor_display_name: document.getElementById('atf_instructor')?.value.trim() || '',
    price: parseFloat(document.getElementById('atf_price')?.value) || 0,
    is_free: document.getElementById('atf_free')?.checked ? 1 : 0,
    max_participants: parseInt(document.getElementById('atf_max')?.value) || null,
    cert_title: document.getElementById('atf_cert_title')?.value.trim() || '',
    cert_desc: document.getElementById('atf_cert_desc')?.value.trim() || '',
    pre_exam_id: parseInt(document.getElementById('atf_pre_exam')?.value) || null,
    pre_exam_type: document.getElementById('atf_pre_exam')?.value ? 'exam' : null,
    post_exam_id: parseInt(document.getElementById('atf_post_exam')?.value) || null,
    post_exam_type: document.getElementById('atf_post_exam')?.value ? 'exam' : null,
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    let tid = _atState.editTid;
    if (tid) {
      await API.adminUpdateTraining(tid, data);
    } else {
      const res = await API.adminCreateTraining(data);
      tid = res.id;
    }

    // Upload cover image if selected
    if (_coverFileToUpload && tid) {
      const fd = new FormData();
      fd.append('cover', _coverFileToUpload);
      await API.adminUploadTrainingCover(tid, fd);
    }

    if (typeof showToast === 'function') showToast(_atState.editTid ? 'Training updated!' : 'Training created!', 'success');
    document.getElementById('atfModal')?.classList.remove('active');
    _coverFileToUpload = null;
    _loadAdminTrainingPrograms();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Failed to save', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _atState.editTid ? '💾 Save Changes' : '🚀 Create Training'; }
  }
}
window._saveTrainingForm = _saveTrainingForm;

/* ════════════════════════════════════════════════════════
   PART C — TRAINING DETAIL MANAGER + MODULE RICH EDITOR
   ════════════════════════════════════════════════════════ */

/* ── Training Detail Modal (Modules / Sessions / Announcements / Analytics) ── */
async function openAdminTrainingDetail(tid) {
  _atState.detailTid = tid;
  _atState.detailTab = 'modules';
  const t = _atState.trainings.find(x => x.id === tid) || { title: 'Training Manager' };

  let modal = document.getElementById('atDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'atDetailModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }
  modal.innerHTML = `
    <div class="modal" style="max-width:920px;padding:0;overflow:hidden;border-radius:24px;display:flex;flex-direction:column;max-height:92vh;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
        <div>
          <div style="font-family:var(--font-display,'Outfit',sans-serif);font-weight:900;font-size:1.05rem;color:#0f172a;">⚙️ ${atEsc(t.title)}</div>
          <div style="font-size:0.72rem;color:#94a3b8;margin-top:1px;">Training Management Console</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('atDetailModal').classList.remove('active')" style="border-radius:12px;">✕ Close</button>
      </div>
      <div style="display:flex;gap:0;padding:0 22px;border-bottom:1px solid #e2e8f0;background:#fafafa;overflow-x:auto;flex-shrink:0;" id="atDetailTabs">
        ${[['modules','📚 Modules'],['sessions','📅 Sessions'],['announcements','📢 Announcements'],['analytics','📊 Analytics']].map(([tab, label], i) =>
          `<button class="th-tab${i === 0 ? ' active' : ''}" onclick="_switchDetailTab('${tab}',this)">${label}</button>`
        ).join('')}
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px;min-height:0;" id="atDetailBody">
        <div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>
      </div>
    </div>`;
  modal.classList.add('active');
  await _renderDetailModules(tid);
}
window.openAdminTrainingDetail = openAdminTrainingDetail;

async function _switchDetailTab(tab, btn) {
  _atState.detailTab = tab;
  document.querySelectorAll('#atDetailTabs .th-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const body = document.getElementById('atDetailBody');
  body.innerHTML = '<div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>';
  const tid = _atState.detailTid;
  if (tab === 'modules') await _renderDetailModules(tid);
  else if (tab === 'sessions') await _renderDetailSessions(tid);
  else if (tab === 'announcements') await _renderDetailAnnouncements(tid);
  else if (tab === 'analytics') await _renderDetailAnalytics(tid);
}
window._switchDetailTab = _switchDetailTab;

/* ── Modules panel inside detail ────────────────────────── */
async function _renderDetailModules(tid) {
  const body = document.getElementById('atDetailBody');
  if (!body) return;
  try {
    const mods = await API.adminGetModules(tid);
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-weight:800;font-size:0.95rem;color:#0f172a;">📚 Modules <span style="color:#94a3b8;font-weight:400;font-size:0.8rem;">${mods.length} total</span></div>
        <button class="btn btn-primary btn-sm" onclick="openModuleEditor(${tid}, null)">＋ Add Module</button>
      </div>
      <div class="admin-module-builder">
        ${mods.length ? mods.map((m, i) => `
          <div class="admin-module-row">
            <span class="admin-module-num">${i + 1}</span>
            <div class="admin-module-info">
              <div class="admin-module-title">${atEsc(m.title)}</div>
              <div class="admin-module-subtitle">${m.estimated_mins || 0} min${m.video_url ? ' · 🎬 Video' : ''}${m.quiz_meta ? ' · 🧠 Quiz' : ''}</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="openModuleEditor(${tid}, ${m.id})">✏️ Edit</button>
            <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="_deleteModule(${tid},${m.id})">🗑</button>
          </div>`).join('') : '<div style="text-align:center;padding:32px;color:#94a3b8;">No modules yet. Add your first module.</div>'}
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`;
  }
}

async function _deleteModule(tid, mid) {
  if (!confirm('Delete this module? This cannot be undone.')) return;
  try {
    await API.adminDeleteModule(tid, mid);
    if (typeof showToast === 'function') showToast('Module deleted', 'success');
    await _renderDetailModules(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._deleteModule = _deleteModule;

/* ── FULL-SCREEN MODULE EDITOR (rich WYSIWYG + quiz builder) ── */
let _moduleQuizQuestions = []; // [{question,options:[4],correct:0}]

async function openModuleEditor(tid, mid) {
  _atState.detailTid = tid;
  _moduleQuizQuestions = [];

  let overlay = document.getElementById('atModuleEditorOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'atModuleEditorOverlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:100030;background:#f8fafc;overflow-y:auto;';
    document.body.appendChild(overlay);
  }

  // Load existing data if editing
  let mod = {}, existingQuiz = null;
  if (mid) {
    try {
      const d = await API.adminGetModules(tid);
      mod = d.find(m => m.id === mid) || {};
      const qd = await API.adminGetModuleQuiz(tid, mid);
      if (qd.quiz) {
        existingQuiz = qd.quiz;
        _moduleQuizQuestions = existingQuiz.questions || [];
      }
    } catch { /* ignore */ }
  }

  overlay.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:24px 20px 60px;">
      <!-- Editor Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
        <div>
          <div style="font-family:var(--font-display,'Outfit',sans-serif);font-size:1.4rem;font-weight:900;color:#0f172a;">
            ${mid ? '✏️ Edit Module' : '📝 New Module'}
          </div>
          <div style="font-size:0.78rem;color:#64748b;margin-top:2px;">EPSA Professional Training Content Editor</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" onclick="_closeModuleEditor()">✕ Cancel</button>
          <button class="btn btn-primary" id="atModSaveBtn" onclick="_saveModuleEditor(${tid},${mid || 'null'})">💾 Save Module</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 380px;gap:24px;align-items:start;">
        <!-- Left: Editor -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Basic info -->
          <div style="background:white;border-radius:18px;border:1px solid #e2e8f0;padding:20px;">
            <div style="font-weight:800;font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:14px;">📋 Module Info</div>
            <div style="display:grid;gap:12px;">
              <div class="form-group" style="margin:0;">
                <label class="form-label">Module Title *</label>
                <input id="atmod_title" class="form-input" value="${atEsc(mod.title || '')}" placeholder="e.g. Introduction to Research Ethics">
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">Summary / Subtitle</label>
                <input id="atmod_summary" class="form-input" value="${atEsc(mod.summary || '')}" placeholder="One-line description for module list">
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group" style="margin:0;">
                  <label class="form-label">Estimated Minutes</label>
                  <input id="atmod_mins" class="form-input" type="number" value="${mod.estimated_mins || 30}" min="1">
                </div>
                <div class="form-group" style="margin:0;">
                  <label class="form-label">Video Embed URL</label>
                  <input id="atmod_video" class="form-input" value="${atEsc(mod.video_url || '')}" placeholder="YouTube embed URL…" oninput="_previewVideo(this.value)">
                </div>
              </div>
              <div id="atmod_video_preview" style="display:none;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
                <iframe id="atmod_video_iframe" style="width:100%;height:180px;border:0;" allowfullscreen></iframe>
              </div>
            </div>
          </div>

          <!-- Rich Content Editor -->
          <div style="background:white;border-radius:18px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:4px;flex-wrap:wrap;background:#fafafa;" id="atRichToolbar">
              ${[
                ['bold','<b>B</b>','Bold'],['italic','<i>I</i>','Italic'],['underline','<u>U</u>','Underline'],
                ['|'],
                ['formatBlock:h2','H2','Heading 2'],['formatBlock:h3','H3','Heading 3'],['formatBlock:p','P','Paragraph'],
                ['|'],
                ['insertUnorderedList','• List','Bullet List'],['insertOrderedList','1. List','Numbered List'],
                ['|'],
                ['formatBlock:blockquote','❝','Blockquote'],['insertHorizontalRule','—','Divider'],
              ].map(([cmd, label, title]) => {
                if (cmd === '|') return '<div style="width:1px;height:24px;background:#e2e8f0;margin:0 4px;align-self:center;"></div>';
                const [c, val] = cmd.includes(':') ? cmd.split(':') : [cmd, null];
                return `<button type="button" class="at-rich-btn" title="${title || label}" onclick="_richCmd('${c}','${val || ''}')"><span>${label}</span></button>`;
              }).join('')}
            </div>
            <div id="atmod_content" class="at-rich-editor" contenteditable="true"
              style="min-height:320px;padding:20px;outline:none;font-size:0.94rem;line-height:1.8;color:#1e293b;">
              ${mod.content_html || '<p>Start writing your module content here…</p>'}
            </div>
          </div>
        </div>

        <!-- Right: Quiz Builder + Preview -->
        <div style="display:flex;flex-direction:column;gap:16px;position:sticky;top:20px;">

          <!-- EPSA Module Preview card -->
          <div class="at-module-preview-card">
            <div class="at-module-preview-logo">
              <img src="/frontend/my_epsa_logo.png" onerror="this.style.display='none'" style="height:28px;">
              <span>EPSA Training</span>
            </div>
            <div class="at-module-preview-title" id="atmod_preview_title">${atEsc(mod.title || 'Module Title')}</div>
            <div class="at-module-preview-sub" id="atmod_preview_sub">${atEsc(mod.summary || 'Module summary will appear here')}</div>
            <div class="at-module-preview-meta">
              <span id="atmod_preview_mins">⏱ ${mod.estimated_mins || 30} min</span>
              <span>·</span>
              <span>${_moduleQuizQuestions.length} quiz questions</span>
            </div>
          </div>

          <!-- Quiz Builder -->
          <div style="background:white;border-radius:18px;border:1px solid #e2e8f0;padding:18px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div style="font-weight:800;font-size:0.82rem;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">🧠 Module Quiz</div>
              <button class="btn btn-primary btn-sm" onclick="_addQuizQuestion()">＋ Add Question</button>
            </div>
            <div style="font-size:0.72rem;color:#64748b;margin-bottom:12px;">
              Pass mark: <input id="atmod_quiz_pass" type="number" value="${existingQuiz?.pass_percent || 70}" min="1" max="100" style="width:52px;padding:2px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.72rem;">%
              &nbsp; Title: <input id="atmod_quiz_title" value="${atEsc(existingQuiz?.title || 'Knowledge Check')}" style="width:140px;padding:2px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.72rem;">
            </div>
            <div id="atQuizQList" style="display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto;">
              ${_moduleQuizQuestions.length ? '' : '<div id="atQuizEmpty" style="text-align:center;padding:20px;color:#94a3b8;font-size:0.82rem;">No questions yet.<br>Add questions to create a quiz.</div>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Live preview update
  ['atmod_title','atmod_summary','atmod_mins'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _updateModulePreview);
  });

  // Render existing questions
  _moduleQuizQuestions.forEach((_, i) => _renderQuizQuestion(i));
}
window.openModuleEditor = openModuleEditor;

function _closeModuleEditor() {
  const overlay = document.getElementById('atModuleEditorOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}
window._closeModuleEditor = _closeModuleEditor;

/* ── Rich text commands ────────────────────────────────── */
function _richCmd(cmd, value) {
  document.getElementById('atmod_content')?.focus();
  if (cmd === 'formatBlock') {
    document.execCommand('formatBlock', false, `<${value}>`);
  } else {
    document.execCommand(cmd, false, value || null);
  }
}
window._richCmd = _richCmd;

function _previewVideo(url) {
  const wrap = document.getElementById('atmod_video_preview');
  const iframe = document.getElementById('atmod_video_iframe');
  if (!url || !wrap || !iframe) { if (wrap) wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  iframe.src = url;
}
window._previewVideo = _previewVideo;

function _updateModulePreview() {
  const title = document.getElementById('atmod_title')?.value || 'Module Title';
  const sub = document.getElementById('atmod_summary')?.value || 'Module summary';
  const mins = document.getElementById('atmod_mins')?.value || '30';
  const pt = document.getElementById('atmod_preview_title');
  const ps = document.getElementById('atmod_preview_sub');
  const pm = document.getElementById('atmod_preview_mins');
  if (pt) pt.textContent = title;
  if (ps) ps.textContent = sub;
  if (pm) pm.textContent = `⏱ ${mins} min`;
}
window._updateModulePreview = _updateModulePreview;

/* ── Quiz question management ────────────────────────── */
function _addQuizQuestion() {
  _moduleQuizQuestions.push({ question: '', options: ['', '', '', ''], correct: 0 });
  const empty = document.getElementById('atQuizEmpty');
  if (empty) empty.remove();
  _renderQuizQuestion(_moduleQuizQuestions.length - 1);
  // Update preview count
  const pm = document.getElementById('atmod_preview_mins');
  // done via side effect
}
window._addQuizQuestion = _addQuizQuestion;

function _renderQuizQuestion(idx) {
  const list = document.getElementById('atQuizQList');
  if (!list) return;
  const q = _moduleQuizQuestions[idx];
  const existing = document.getElementById(`atqq_${idx}`);
  const card = document.createElement('div');
  card.id = `atqq_${idx}`;
  card.className = 'at-quiz-q-card';
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="font-weight:800;font-size:0.8rem;color:#475569;">Q${idx + 1}</span>
      <button class="btn btn-ghost btn-sm" style="color:#dc2626;padding:2px 6px;" onclick="_removeQuizQuestion(${idx})">🗑</button>
    </div>
    <input class="form-input" style="font-size:0.82rem;margin-bottom:8px;" placeholder="Question text…"
      value="${atEsc(q.question)}" oninput="_atState.detailTid; _moduleQuizQuestions[${idx}].question=this.value">
    <div style="font-size:0.72rem;color:#64748b;margin-bottom:6px;">Options (click radio to mark correct):</div>
    ${q.options.map((opt, oi) => `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <input type="radio" name="atq_correct_${idx}" value="${oi}" ${q.correct === oi ? 'checked' : ''}
          onchange="_moduleQuizQuestions[${idx}].correct=${oi}" style="accent-color:#1a6b3c;">
        <input class="form-input" style="flex:1;font-size:0.8rem;padding:6px 10px;" placeholder="Option ${String.fromCharCode(65+oi)}…"
          value="${atEsc(opt)}" oninput="_moduleQuizQuestions[${idx}].options[${oi}]=this.value">
      </div>`).join('')}`;
  if (existing) existing.replaceWith(card);
  else list.appendChild(card);
}
window._renderQuizQuestion = _renderQuizQuestion;

function _removeQuizQuestion(idx) {
  _moduleQuizQuestions.splice(idx, 1);
  const list = document.getElementById('atQuizQList');
  if (list) {
    list.innerHTML = '';
    if (!_moduleQuizQuestions.length) {
      list.innerHTML = '<div id="atQuizEmpty" style="text-align:center;padding:20px;color:#94a3b8;font-size:0.82rem;">No questions yet.</div>';
    } else {
      _moduleQuizQuestions.forEach((_, i) => _renderQuizQuestion(i));
    }
  }
}
window._removeQuizQuestion = _removeQuizQuestion;

/* ── Save module editor ───────────────────────────────── */
async function _saveModuleEditor(tid, mid) {
  const btn = document.getElementById('atModSaveBtn');
  const title = document.getElementById('atmod_title')?.value.trim();
  if (!title) { if (typeof showToast === 'function') showToast('Module title required', 'error'); return; }

  const data = {
    title,
    summary: document.getElementById('atmod_summary')?.value.trim() || '',
    content_html: document.getElementById('atmod_content')?.innerHTML || '',
    video_url: document.getElementById('atmod_video')?.value.trim() || '',
    estimated_mins: parseInt(document.getElementById('atmod_mins')?.value) || 30,
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    let savedMid = mid;
    if (mid) {
      await API.adminUpdateModule(tid, mid, data);
    } else {
      const res = await API.adminCreateModule(tid, data);
      savedMid = res.id;
    }

    // Save quiz if questions exist
    if (_moduleQuizQuestions.length > 0 && savedMid) {
      const quizTitle = document.getElementById('atmod_quiz_title')?.value.trim() || 'Knowledge Check';
      const passPercent = parseInt(document.getElementById('atmod_quiz_pass')?.value) || 70;
      // Validate questions
      const valid = _moduleQuizQuestions.every(q => q.question.trim() && q.options.every(o => o.trim()));
      if (!valid) { if (typeof showToast === 'function') showToast('All quiz questions and options must be filled', 'warning'); }
      else {
        await API.adminSaveModuleQuiz(tid, savedMid, {
          title: quizTitle,
          pass_percent: passPercent,
          questions: _moduleQuizQuestions,
        });
      }
    }

    if (typeof showToast === 'function') showToast('Module saved successfully!', 'success');
    _closeModuleEditor();
    await _renderDetailModules(tid);
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Failed to save module', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save Module'; }
  }
}
window._saveModuleEditor = _saveModuleEditor;

/* ════════════════════════════════════════════════════════
   PART D — SESSIONS / ANNOUNCEMENTS / ANALYTICS / ENROLLMENTS / RECEIPTS
   ════════════════════════════════════════════════════════ */

/* ── Sessions (inside detail modal) ────────────────────── */
async function _renderDetailSessions(tid) {
  const body = document.getElementById('atDetailBody');
  if (!body) return;
  try {
    const sessions = await API.adminGetSessions(tid);
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-weight:800;font-size:0.95rem;">📅 Sessions</div>
        <button class="btn btn-primary btn-sm" onclick="_openSessionForm(${tid}, null)">＋ Add Session</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;" id="atSessionList">
        ${sessions.length ? sessions.map(s => `
          <div class="admin-module-row">
            <div style="flex:1;">
              <div class="admin-module-title">${atEsc(s.title || 'Session')}</div>
              <div class="admin-module-subtitle">${s.session_date ? atFmt(s.session_date) : ''} ${s.start_time ? '· '+atEsc(s.start_time) : ''} ${s.location ? '· '+atEsc(s.location) : ''} ${s.is_online ? '· 🌐 Online' : ''}</div>
              ${s.meeting_url ? `<a href="${atEsc(s.meeting_url)}" target="_blank" style="font-size:0.72rem;color:#2563eb;">Join Link ↗</a>` : ''}
            </div>
            <button class="btn btn-ghost btn-sm" onclick="_openSessionForm(${tid}, ${s.id}, ${JSON.stringify(s).replace(/"/g,'&quot;')})">✏️</button>
            <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="_deleteSession(${tid},${s.id})">🗑</button>
          </div>`).join('') : '<div style="text-align:center;padding:32px;color:#94a3b8;">No sessions scheduled yet.</div>'}
      </div>`;
  } catch (e) { body.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}

function _openSessionForm(tid, sid, existing = null) {
  const s = existing || {};
  let modal = document.getElementById('atSessionModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'atSessionModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }
  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div style="font-weight:900;font-size:1rem;margin-bottom:16px;">📅 ${sid ? 'Edit' : 'Add'} Session</div>
      <div style="display:grid;gap:12px;">
        <div class="form-group"><label class="form-label">Session Title</label>
          <input id="atsess_title" class="form-input" value="${atEsc(s.title||'')}" placeholder="e.g. Week 1 – Introduction"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label class="form-label">Date</label>
            <input id="atsess_date" class="form-input" type="date" value="${s.session_date?.split('T')[0]||''}"></div>
          <div class="form-group"><label class="form-label">Start Time</label>
            <input id="atsess_time" class="form-input" type="time" value="${s.start_time||''}"></div>
        </div>
        <div class="form-group"><label class="form-label">Location / Venue</label>
          <input id="atsess_loc" class="form-input" value="${atEsc(s.location||'')}" placeholder="Room 3B or leave blank for online"></div>
        <div class="form-group"><label class="form-label">Meeting URL (online)</label>
          <input id="atsess_url" class="form-input" value="${atEsc(s.meeting_url||'')}" placeholder="https://zoom.us/…"></div>
        <div class="form-group"><label class="form-label" style="display:flex;gap:8px;align-items:center;cursor:pointer;">
          <input type="checkbox" id="atsess_online" ${s.is_online?'checked':''}>
          <span>Online session</span></label></div>
        <div class="form-group"><label class="form-label">Notes</label>
          <textarea id="atsess_notes" class="form-input" rows="2" placeholder="Extra info…">${atEsc(s.notes||'')}</textarea></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" onclick="document.getElementById('atSessionModal').classList.remove('active')">Cancel</button>
          <button class="btn btn-primary" onclick="_saveSession(${tid},${sid||'null'})">💾 Save</button>
        </div>
      </div>
    </div>`;
  modal.classList.add('active');
}
window._openSessionForm = _openSessionForm;

async function _saveSession(tid, sid) {
  const data = {
    title: document.getElementById('atsess_title')?.value.trim(),
    session_date: document.getElementById('atsess_date')?.value || null,
    start_time: document.getElementById('atsess_time')?.value || null,
    location: document.getElementById('atsess_loc')?.value.trim() || null,
    meeting_url: document.getElementById('atsess_url')?.value.trim() || null,
    is_online: document.getElementById('atsess_online')?.checked ? 1 : 0,
    notes: document.getElementById('atsess_notes')?.value.trim() || null,
  };
  try {
    if (sid) await API.adminUpdateSession(tid, sid, data);
    else await API.adminCreateSession(tid, data);
    if (typeof showToast === 'function') showToast('Session saved', 'success');
    document.getElementById('atSessionModal')?.classList.remove('active');
    await _renderDetailSessions(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._saveSession = _saveSession;

async function _deleteSession(tid, sid) {
  if (!confirm('Delete this session?')) return;
  try {
    await API.adminDeleteSession(tid, sid);
    await _renderDetailSessions(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._deleteSession = _deleteSession;

/* ── Announcements (inside detail modal) ───────────────── */
async function _renderDetailAnnouncements(tid) {
  const body = document.getElementById('atDetailBody');
  if (!body) return;
  try {
    const list = await API.adminGetAnnouncements(tid);
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-weight:800;font-size:0.95rem;">📢 Announcements</div>
        <button class="btn btn-primary btn-sm" onclick="_openAnnouncementForm(${tid})">＋ Post</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${list.length ? list.map(a => `
          <div style="background:white;border-radius:14px;border:1px solid #e2e8f0;padding:14px 16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-weight:700;font-size:0.88rem;color:#1e293b;">${atEsc(a.title || '')}</div>
                <div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${atEsc(a.body || '')}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="font-size:0.7rem;color:#94a3b8;">${atFmt(a.created_at)}</span>
                <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="_deleteAnnouncement(${tid},${a.id})">🗑</button>
              </div>
            </div>
          </div>`).join('') : '<div style="text-align:center;padding:32px;color:#94a3b8;">No announcements yet.</div>'}
      </div>`;
  } catch (e) { body.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}

function _openAnnouncementForm(tid) {
  let modal = document.getElementById('atAnnouncementModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'atAnnouncementModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  }
  modal.innerHTML = `
    <div class="modal" style="max-width:460px;">
      <div style="font-weight:900;font-size:1rem;margin-bottom:16px;">📢 Post Announcement</div>
      <div style="display:grid;gap:12px;">
        <div class="form-group"><label class="form-label">Title</label>
          <input id="atan_title" class="form-input" placeholder="Announcement title"></div>
        <div class="form-group"><label class="form-label">Message</label>
          <textarea id="atan_body" class="form-input" rows="3" placeholder="What would you like to announce?"></textarea></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" onclick="document.getElementById('atAnnouncementModal').classList.remove('active')">Cancel</button>
          <button class="btn btn-primary" onclick="_postAnnouncement(${tid})">📢 Post</button>
        </div>
      </div>
    </div>`;
  modal.classList.add('active');
}
window._openAnnouncementForm = _openAnnouncementForm;

async function _postAnnouncement(tid) {
  const title = document.getElementById('atan_title')?.value.trim();
  const body_ = document.getElementById('atan_body')?.value.trim();
  if (!title) { if (typeof showToast === 'function') showToast('Title required', 'error'); return; }
  try {
    await API.adminCreateAnnouncement(tid, { title, body: body_ });
    if (typeof showToast === 'function') showToast('Announcement posted!', 'success');
    document.getElementById('atAnnouncementModal')?.classList.remove('active');
    await _renderDetailAnnouncements(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._postAnnouncement = _postAnnouncement;

async function _deleteAnnouncement(tid, anid) {
  if (!confirm('Delete announcement?')) return;
  try {
    await API.adminDeleteAnnouncement(tid, anid);
    await _renderDetailAnnouncements(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._deleteAnnouncement = _deleteAnnouncement;

/* ── Analytics (inside detail modal) ───────────────────── */
async function _renderDetailAnalytics(tid) {
  const body = document.getElementById('atDetailBody');
  if (!body) return;
  try {
    const data = await API.adminTrainingAnalytics(tid);
    const overview = data.overview || {};
    const completions = data.module_completion_rates || [];
    const t = _atState.trainings.find(x => x.id === tid) || {};
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px;">
        ${[
          ['👥', 'Total Enrolled', overview.registered || 0, '#2563eb'],
          ['📋', 'Pending', overview.pending || 0, '#f59e0b'],
          ['✅', 'Completed', overview.completed || 0, '#059669'],
          ['🏆', 'Certificates', overview.certificates_issued || 0, '#7c3aed'],
          ['⏳', 'Avg. Progress', `${Math.round(overview.avg_progress_pct || 0)}%`, '#0891b2'],
        ].map(([icon, label, val, color]) => `
          <div style="background:white;border-radius:16px;border:1px solid #e2e8f0;padding:16px;text-align:center;">
            <div style="font-size:1.8rem;">${icon}</div>
            <div style="font-size:1.4rem;font-weight:900;color:${color};margin:4px 0;">${val}</div>
            <div style="font-size:0.72rem;color:#64748b;">${label}</div>
          </div>`).join('')}
      </div>
      ${completions.length ? `
        <div style="background:white;border-radius:18px;border:1px solid #e2e8f0;padding:18px;">
          <div style="font-weight:800;margin-bottom:14px;color:#0f172a;">📚 Module Completion Rates</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${completions.map(m => {
              const pct = Math.round(m.completion_rate || 0);
              return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px;">
                    <span style="color:#334155;font-weight:600;">${atEsc(m.title)}</span>
                    <span style="color:#64748b;">${pct}% completed</span>
                  </div>
                  <div style="background:#f1f5f9;border-radius:99px;height:8px;overflow:hidden;">
                    <div style="height:100%;border-radius:99px;background:${pct >= 75 ? '#059669' : pct >= 40 ? '#f59e0b' : '#dc2626'};width:${pct}%;transition:width 0.6s ease;"></div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      <div style="margin-top:14px;text-align:right;">
        <button class="btn btn-primary btn-sm" onclick="_issueBatchCertificates(${tid})">🏆 Issue All Eligible Certificates</button>
      </div>`;
  } catch (e) { body.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}

async function _issueBatchCertificates(tid) {
  try {
    const data = await API.adminTrainingAnalytics(tid);
    const eligible = (data.eligible_for_cert || []);
    if (!eligible.length) { if (typeof showToast === 'function') showToast('No students eligible yet', 'info'); return; }
    let count = 0;
    for (const uid of eligible) {
      try { await API.adminIssueCertificate(tid, uid); count++; } catch { /* skip */ }
    }
    if (typeof showToast === 'function') showToast(`${count} certificates issued!`, 'success');
    await _renderDetailAnalytics(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._issueBatchCertificates = _issueBatchCertificates;

/* ── Global ENROLLMENTS tab ────────────────────────────── */
function _renderEnrollmentPanel() {
  const panel = document.getElementById('at-panel-enrollments');
  if (!panel) return;
  const trainings = _atState.trainings;
  if (!trainings.length) {
    panel.innerHTML = '<div class="at-empty-state"><div class="at-empty-icon">👥</div><div class="at-empty-title">No trainings</div></div>';
    return;
  }
  const firstId = trainings[0].id;
  panel.innerHTML = `
    <div style="margin-bottom:16px;">
      <label class="form-label" style="margin-bottom:6px;display:block;">Select Training Program</label>
      <select class="form-input" style="max-width:360px;" id="atEnrollTidSelect" onchange="_loadEnrollmentList(this.value)">
        ${trainings.map(t => `<option value="${t.id}">${atEsc(t.title)}</option>`).join('')}
      </select>
    </div>
    <div id="atEnrollListWrap">
      <div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>
    </div>`;
  _loadEnrollmentList(firstId);
}

async function _loadEnrollmentList(tid) {
  const wrap = document.getElementById('atEnrollListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>';
  try {
    const list = await API.adminGetEnrollments(tid, 'all');
    const rows = Array.isArray(list) ? list : [];
    wrap.innerHTML = `
      <div style="font-size:0.82rem;font-weight:700;color:#64748b;margin-bottom:12px;">${rows.length} enrollment${rows.length!==1?'s':''}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${rows.length ? rows.map(a => {
          const statusColor = {pending:'#f59e0b',approved:'#059669',registered:'#2563eb',rejected:'#dc2626'}[a.status] || '#94a3b8';
          return `
            <div class="admin-module-row">
              <div style="flex:1;">
                <div class="admin-module-title">${atEsc(a.full_name || a.user_id || '—')}</div>
                <div class="admin-module-subtitle">${atEsc(a.email || '')} ${a.phone ? '· '+atEsc(a.phone) : ''}</div>
              </div>
              <span style="font-size:0.72rem;font-weight:700;color:${statusColor};background:${statusColor}22;padding:3px 10px;border-radius:99px;">${a.status}</span>
              ${a.status === 'pending' ? `
                <button class="btn btn-primary btn-sm" onclick="_approveEnroll(${tid},${a.id})">✓ Approve</button>
                <button class="btn btn-ghost btn-sm" style="color:#dc2626;" onclick="_rejectEnroll(${tid},${a.id})">✗</button>` : ''}
              ${a.status === 'approved' ? `
                <button class="btn btn-primary btn-sm" onclick="_registerEnroll(${tid},${a.id})">Register</button>` : ''}
            </div>`;
        }).join('') : '<div style="text-align:center;padding:32px;color:#94a3b8;">No enrollments found.</div>'}
      </div>`;
  } catch (e) { wrap.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}
window._loadEnrollmentList = _loadEnrollmentList;

async function _approveEnroll(tid, aid) {
  try {
    await API.adminApproveEnrollment(tid, aid);
    if (typeof showToast === 'function') showToast('Approved', 'success');
    _loadEnrollmentList(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._approveEnroll = _approveEnroll;

async function _rejectEnroll(tid, aid) {
  const reason = prompt('Reason for rejection (optional):') || '';
  try {
    await API.adminRejectEnrollment(tid, aid, reason);
    if (typeof showToast === 'function') showToast('Rejected', 'success');
    _loadEnrollmentList(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._rejectEnroll = _rejectEnroll;

async function _registerEnroll(tid, aid) {
  try {
    await API.adminRegisterEnrollment(tid, aid);
    if (typeof showToast === 'function') showToast('Student registered', 'success');
    _loadEnrollmentList(tid);
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._registerEnroll = _registerEnroll;

/* ── Global RECEIPTS tab ────────────────────────────────── */
async function _loadAdminReceipts() {
  const panel = document.getElementById('at-panel-receipts');
  if (!panel) return;
  panel.innerHTML = '<div class="at-loading"><div class="at-spinner"></div><div>Loading receipts…</div></div>';
  try {
    const list = await API.adminAllReceipts();
    const rows = Array.isArray(list) ? list : [];
    panel.innerHTML = `
      <div style="font-weight:800;font-size:0.95rem;margin-bottom:16px;">🧾 Payment Receipts <span style="color:#94a3b8;font-weight:400;font-size:0.8rem;">${rows.length} total</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${rows.length ? rows.map(r => {
          const verified = r.verified || r.receipt_verified;
          return `
            <div class="admin-module-row">
              <div style="flex:1;">
                <div class="admin-module-title">${atEsc(r.full_name || r.user_id || '—')} — ${atEsc(r.training_title || r.training_id || '—')}</div>
                <div class="admin-module-subtitle">${atFmt(r.receipt_uploaded_at || r.created_at)}</div>
              </div>
              ${r.receipt_path ? `<a class="btn btn-ghost btn-sm" href="${atEsc(r.receipt_url || '#')}" target="_blank">🖼 View</a>` : ''}
              <span style="font-size:0.72rem;font-weight:700;color:${verified?'#059669':'#f59e0b'};background:${verified?'#05996922':'#f59e0b22'};padding:3px 10px;border-radius:99px;">
                ${verified ? '✅ Verified' : '⏳ Pending'}
              </span>
              ${!verified && r.id ? `<button class="btn btn-primary btn-sm" onclick="_verifyReceipt(${r.id})">✓ Verify</button>` : ''}
            </div>`;
        }).join('') : '<div style="text-align:center;padding:32px;color:#94a3b8;">No receipts submitted yet.</div>'}
      </div>`;
  } catch (e) { panel.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}

async function _verifyReceipt(appId) {
  try {
    await API.verifyReceipt(appId);
    if (typeof showToast === 'function') showToast('Receipt verified', 'success');
    _loadAdminReceipts();
  } catch (e) { if (typeof showToast === 'function') showToast(e.message, 'error'); }
}
window._verifyReceipt = _verifyReceipt;

/* ── Global ANALYTICS tab ────────────────────────────────── */
function _renderAnalyticsPanel() {
  const panel = document.getElementById('at-panel-analytics');
  if (!panel) return;
  const trainings = _atState.trainings;
  if (!trainings.length) {
    panel.innerHTML = '<div class="at-empty-state"><div class="at-empty-icon">📊</div><div class="at-empty-title">No trainings</div></div>';
    return;
  }
  const firstId = trainings[0].id;
  panel.innerHTML = `
    <div style="margin-bottom:16px;">
      <label class="form-label" style="margin-bottom:6px;display:block;">Select Training Program</label>
      <select class="form-input" style="max-width:360px;" id="atAnalyticsTidSelect" onchange="_loadGlobalAnalytics(this.value)">
        ${trainings.map(t => `<option value="${t.id}">${atEsc(t.title)}</option>`).join('')}
      </select>
    </div>
    <div id="atAnalyticsWrap">
      <div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>
    </div>`;
  _loadGlobalAnalytics(firstId);
}

async function _loadGlobalAnalytics(tid) {
  const wrap = document.getElementById('atAnalyticsWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="at-loading"><div class="at-spinner"></div><div>Loading…</div></div>';
  // Reuse the detail analytics renderer, but target the global panel wrap
  try {
    const data = await API.adminTrainingAnalytics(tid);
    const overview = data.overview || {};
    const completions = data.module_completion_rates || [];
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
        ${[['👥','Enrolled',overview.registered||0,'#2563eb'],['📋','Pending',overview.pending||0,'#f59e0b'],
           ['✅','Completed',overview.completed||0,'#059669'],['🏆','Certificates',overview.certificates_issued||0,'#7c3aed'],
           ['⏳','Avg Progress',`${Math.round(overview.avg_progress_pct||0)}%`,'#0891b2']
        ].map(([icon,label,val,color]) => `
          <div style="background:white;border-radius:16px;border:1px solid #e2e8f0;padding:14px;text-align:center;">
            <div style="font-size:1.6rem;">${icon}</div>
            <div style="font-size:1.3rem;font-weight:900;color:${color};margin:4px 0;">${val}</div>
            <div style="font-size:0.72rem;color:#64748b;">${label}</div>
          </div>`).join('')}
      </div>
      ${completions.length ? `
        <div style="background:white;border-radius:18px;border:1px solid #e2e8f0;padding:18px;">
          <div style="font-weight:800;margin-bottom:12px;">📚 Module Completion</div>
          ${completions.map(m => {
            const pct = Math.round(m.completion_rate || 0);
            return `<div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px;">
                <span>${atEsc(m.title)}</span><span style="color:#64748b;">${pct}%</span>
              </div>
              <div style="background:#f1f5f9;border-radius:99px;height:8px;">
                <div style="height:100%;border-radius:99px;background:${pct>=75?'#059669':pct>=40?'#f59e0b':'#dc2626'};width:${pct}%;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>` : ''}`;
  } catch (e) { wrap.innerHTML = `<div class="at-error-box">⚠️ ${atEsc(e.message)}</div>`; }
}
window._loadGlobalAnalytics = _loadGlobalAnalytics;
