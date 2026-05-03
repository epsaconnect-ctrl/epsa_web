// 
// EPSA ADMIN DASHBOARD JS
// 

let currentAdminSection = 'overview';
let currentApplicantId  = null;
let allApplicants       = [];
let allTeacherApplicants = [];
let allTrainingsAdmin   = [];
let allExamsAdmin       = [];
let currentApplicantFilter = 'all';

function relocateDynamicAdminSections() {
  const adminContent = document.querySelector('.admin-content');
  if (!adminContent) return;
  document.querySelectorAll('.admin-section[id^="admin-section-"]').forEach((section) => {
    if (section.parentElement !== adminContent) {
      adminContent.appendChild(section);
    }
  });
}

function adminSectionTarget(section) {
  return document.getElementById(`asec-${section}`) || document.getElementById(`admin-section-${section}`);
}

function adminSectionTitle(section) {
  const titles = {
    overview: 'Dashboard',
    applications: 'Applications',
    students: 'All Students',
    'student-messages': 'Student Messages',
    trainings: 'Training Programs',
    receipts: 'Payment Receipts',
    news: 'News & Events',
    'question-bank': 'Question Bank',
    teachers: 'Teachers',
    'mock-exams': 'Mock Exams',
    voting: 'Voting System',
    exams: 'Exam Center',
    'clubs-admin': 'Clubs & Oversight',
    'grants-admin': 'Grants & Financials',
    'partners-admin': 'Partner Control',
    analytics: 'Analytics Engine',
  };
  return titles[section] || section;
}

function runAdminSectionLoader(section) {
  const loaders = {
    applications: () => loadApplicants(currentApplicantFilter),
    students: () => loadAllStudents(),
    'student-messages': () => loadAdminStudentMessages(),
    trainings: () => loadAdminTrainings(),
    receipts: () => loadPendingReceipts(),
    news: () => { if (typeof loadAdminNews === 'function') loadAdminNews(); },
    'question-bank': () => { if (typeof loadAdminQuestions === 'function') loadAdminQuestions(); },
    teachers: () => { if (typeof loadAdminTeachers === 'function') loadAdminTeachers(); },
    'mock-exams': () => { if (typeof loadAdminMockExams === 'function') loadAdminMockExams(); },
    voting: () => loadVotingAdmin(),
    exams: () => loadAdminExams(),
    'clubs-admin': () => { if (typeof window.loadAdminClubs === 'function') window.loadAdminClubs(); },
    'grants-admin': () => { if (typeof window.loadAdminProposals === 'function') window.loadAdminProposals(); },
    'partners-admin': () => { if (typeof window.loadAdminPartners === 'function') window.loadAdminPartners(); },
    analytics: () => { if (typeof window.loadAnalyticsDashboard === 'function') window.loadAnalyticsDashboard(); },
  };
  const loader = loaders[section];
  if (typeof loader === 'function') {
    Promise.resolve(loader()).catch((error) => {
      console.error(`Admin section load failed for ${section}`, error);
      showToast(error?.message || `Failed to load ${adminSectionTitle(section)}`, 'error');
    });
  }
}

// ── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  relocateDynamicAdminSections();
  const user = API.getUser();
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    window.location.href = 'login.html'; return;
  }
  const name = document.getElementById('adminName');
  if (name) name.textContent = user.name || user.username || 'Admin';
  const av = document.getElementById('adminAvatarSm');
  if (av) av.textContent = (user.name || user.username || 'A')[0].toUpperCase();

  startClock();
  await loadDashboardStats();
  // Never block dashboard boot on applications APIs.
  loadApplicants('all');
});

// ── CLOCK ─────────────────────────────────────
function startClock() {
  const el = document.getElementById('adminDateTime');
  const tick = () => {
    if (el) el.textContent = new Date().toLocaleString('en-GB', {
      weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'
    });
  };
  tick(); setInterval(tick, 60000);
}

// ── SECTION SWITCH ────────────────────────────
function switchAdminSection(section) {
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  const target = adminSectionTarget(section);
  if (target) target.style.display = 'block';
  document.querySelectorAll('.admin-nav-link').forEach(l =>
    l.classList.toggle('active', l.dataset.sec === section));
  const pt = document.getElementById('adminPageTitle');
  if (pt) pt.textContent = adminSectionTitle(section);
  currentAdminSection = section;
  setAdminSidebarOpen(false);
  runAdminSectionLoader(section);
}
window.switchAdminSection = switchAdminSection;

function setAdminSidebarOpen(force) {
  const sidebar = document.getElementById('adminSidebar') || document.querySelector('.admin-sidebar');
  const backdrop = document.getElementById('adminSidebarBackdrop');
  if (!sidebar) return;
  const shouldOpen = typeof force === 'boolean' ? force : !sidebar.classList.contains('sidebar-active');
  sidebar.classList.toggle('open', shouldOpen);
  sidebar.classList.toggle('sidebar-active', shouldOpen);
  backdrop?.classList.toggle('active', shouldOpen);
  document.body.classList.toggle('admin-sidebar-open', shouldOpen && window.innerWidth <= 768);
}

function toggleAdminSidebar() {
  setAdminSidebarOpen();
}
window.setAdminSidebarOpen = setAdminSidebarOpen;
window.toggleAdminSidebar = toggleAdminSidebar;

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setAdminSidebarOpen(false);
});

async function refreshCurrentSection() { await switchAdminSection(currentAdminSection); }
window.refreshCurrentSection = refreshCurrentSection;

// ── STATS ─────────────────────────────────────
async function loadDashboardStats() {
  try {
    const data = await API.adminStats();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('kpi-total',     data.total_students   || 0);
    s('kpi-pending',   data.pending          || 0);
    s('kpi-trainings', data.active_trainings || 0);
    s('kpi-receipts',  data.pending_receipts || 0);
    const pb = document.getElementById('pendingBadge');
    if (pb) { pb.textContent = data.pending || 0; pb.style.display = data.pending > 0 ? 'inline-block' : 'none'; }
    await loadRecentApplicants();
  } catch(err) {
    showToast('Failed to load dashboard stats', 'error');
  }
}

// ── APPLICANTS ────────────────────────────────

async function loadApplicants(status = 'pending', tabEl = null) {
  currentApplicantFilter = status;
  if (tabEl) {
    document.querySelectorAll('#appFilterTabs .pill-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }
  try {
    allApplicants = await API.getApplicants(status);
    renderApplicantsTable(allApplicants);
  } catch(err) {
    showToast('Failed to load applicants', 'error');
    document.getElementById('applicantsTbody').innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--epsa-red);padding:var(--space-8);">System Error: Unable to fetch data</td></tr>`;
  }
}
window.loadApplicants = loadApplicants;

async function loadRecentApplicants() {
  const tbody = document.getElementById('recentAppsTbody'); if (!tbody) return;
  try {
    const data = await API.getPendingApplicants();
    const recent = data.filter(a => a.status === 'pending').slice(0, 5);
    renderToTbody(tbody, recent, true);
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--epsa-red);">Failed to load recent</td></tr>`;
  }
}

function renderApplicantsTable(applicants) {
  const tbody = document.getElementById('applicantsTbody'); if (!tbody) return;
  renderToTbody(tbody, applicants, false);
}

function renderToTbody(tbody, applicants, compact) {
  if (!applicants.length) {
    tbody.innerHTML = `<tr><td colspan="${compact ? 6 : 8}" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No applicants found</td></tr>`;
    return;
  }

  const statusBadge = s => ({
    pending:  `<span class="badge status-pending">Pending</span>`,
    approved: `<span class="badge status-approved">Approved</span>`,
    rejected: `<span class="badge status-rejected">Rejected</span>`,
  }[s] || `<span class="badge badge-gray">${s}</span>`);

  tbody.innerHTML = applicants.map(a => `
    <tr>
      <td>
        <div class="table-avatar-name">
          <div class="table-avatar">${a.first_name[0]}${a.father_name[0]}</div>
          <div><div class="table-primary">${a.first_name} ${a.father_name}</div><div class="table-secondary">${a.email}</div></div>
        </div>
      </td>
      <td style="font-size:0.8rem;">${a.university}</td>
      ${!compact ? `<td><span class="badge badge-gray">${a.program_type}</span></td>` : ''}
      <td style="font-size:0.8rem;">${a.academic_year ? `Year ${a.academic_year}` : ''}</td>
      <td style="font-size:0.78rem;color:var(--text-muted);">${formatDate(a.created_at)}</td>
      <td>${statusBadge(a.status)}</td>
      <td>
        <div class="table-actions">
          <button class="action-btn action-btn-view" onclick="viewApplicant(${a.id})">View</button>
          ${a.status === 'pending' ? `
            <button class="action-btn action-btn-approve" onclick="quickApprove(${a.id}, this)">Approve</button>
            <button class="action-btn action-btn-reject"  onclick="openRejectModal(${a.id})">Reject</button>` : ''}
          <button type="button" class="action-btn action-btn-reject" title="Delete record" onclick="adminDeleteApplicant(${a.id})">Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

function renderApplicationMetrics(studentApplicants = [], teacherApplicants = []) {
  const target = document.getElementById('applicationsSummaryCards');
  if (!target) return;
  const studentPending = studentApplicants.filter((item) => item.status === 'pending').length;
  const teacherPending = teacherApplicants.filter((item) => item.status === 'pending').length;
  const reviewed = studentApplicants.filter((item) => item.status !== 'pending').length
    + teacherApplicants.filter((item) => item.status !== 'pending').length;
  target.innerHTML = [
    ['Student Applications', studentApplicants.length, 'var(--epsa-green)'],
    ['Teacher Applications', teacherApplicants.length, '#3b82f6'],
    ['Pending Review', studentPending + teacherPending, 'var(--epsa-gold)'],
    ['Reviewed', reviewed, '#16a34a'],
  ].map(([label, value, color]) => `
    <div class="intel-stat-card">
      <div class="intel-stat-value" style="color:${color}">${value}</div>
      <div class="intel-stat-label">${label}</div>
    </div>
  `).join('');
}

function renderTeacherApplicationsPanel(applicants = []) {
  const grid = document.getElementById('teacherApplicationsGrid');
  const count = document.getElementById('teacherApplicationsCount');
  if (count) count.textContent = `${applicants.length} teacher application(s)`;
  if (!grid) return;
  if (!applicants.length) {
    grid.innerHTML = `<div class="intel-empty-state">No teacher applications found for this filter.</div>`;
    return;
  }
  const statusTone = {
    pending: '#f59e0b',
    approved: '#22c55e',
    rejected: '#f87171',
  };
  grid.innerHTML = applicants.map((teacher) => {
    const initials = (teacher.name || 'T').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    const tone = statusTone[teacher.status] || '#86efac';
    const pendingActions = teacher.status === 'pending'
      ? `
        <button class="btn btn-primary" style="flex:1" onclick="approveTeacher(${teacher.id})">Approve</button>
        <button class="btn btn-ghost" style="flex:1;border:1px solid rgba(248,113,113,.28);color:#fecaca;background:rgba(248,113,113,.08)" onclick="rejectTeacher(${teacher.id})">Reject</button>
      `
      : `<button class="btn btn-ghost" style="flex:1" onclick="openTeacherReview(${teacher.id})">Review Profile</button>`;
    return `
      <article class="teacher-app-card">
        <div class="teacher-app-card-top">
          <div class="teacher-app-avatar">${initials}</div>
          <div style="flex:1;min-width:0">
            <div class="teacher-app-name">${adminEsc(teacher.name || '')}</div>
            <div class="teacher-app-email">${adminEsc(teacher.email || '')}</div>
          </div>
          <span class="teacher-app-status" style="color:${tone};border-color:${tone}44;background:${tone}1A">${adminEsc(teacher.status || 'pending')}</span>
        </div>
        <div class="teacher-app-meta">
          <span>${adminEsc(teacher.specialization || 'Psychology')}</span>
          <span>${adminEsc(teacher.institution || 'Institution not provided')}</span>
          <span>${teacher.years_of_experience || 0} yrs exp.</span>
        </div>
        <div class="teacher-app-summary">${adminEsc((teacher.credentials || 'No supporting credentials were provided.').slice(0, 180))}</div>
        <div class="teacher-app-actions">
          <button class="btn btn-secondary" style="flex:1" onclick="openTeacherReview(${teacher.id})">Open Detail</button>
          ${pendingActions}
        </div>
      </article>
    `;
  }).join('');
}

async function loadApplicants(status = 'pending', tabEl = null) {
  currentApplicantFilter = status;
  if (tabEl) {
    document.querySelectorAll('#appFilterTabs .pill-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }
  try {
    const withTimeout = (promise, ms, fallbackValue) => Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
    ]);

    const [studentsResult, teachersResult] = await Promise.allSettled([
      API.getApplicants(status),
      withTimeout(API.adminListTeachers(status), 6000, { teachers: [] }),
    ]);

    allApplicants = studentsResult.status === 'fulfilled' ? (studentsResult.value || []) : [];
    allTeacherApplicants = (
      teachersResult.status === 'fulfilled' ? (teachersResult.value?.teachers || []) : []
    );

    if (studentsResult.status !== 'fulfilled') {
      showToast('Student applications partially failed to load.', 'error');
    }
    if (teachersResult.status !== 'fulfilled') {
      showToast('Teacher applications partially failed to load.', 'error');
    }

    renderApplicantsTable(allApplicants);
    renderTeacherApplicationsPanel(allTeacherApplicants);
    renderApplicationMetrics(allApplicants, allTeacherApplicants);
  } catch(err) {
    showToast('Failed to load applicants', 'error');
    document.getElementById('applicantsTbody').innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--epsa-red);padding:var(--space-8);">System Error: Unable to fetch data</td></tr>`;
    const grid = document.getElementById('teacherApplicationsGrid');
    if (grid) grid.innerHTML = `<div class="intel-empty-state" style="color:#f87171">Teacher applications could not be loaded.</div>`;
  }
}
window.loadApplicants = loadApplicants;

function filterApplicantTable(q) {
  const filtered = allApplicants.filter(a =>
    `${a.first_name} ${a.father_name} ${a.email} ${a.university}`.toLowerCase().includes(q.toLowerCase()));
  renderApplicantsTable(filtered);
  const teacherFiltered = allTeacherApplicants.filter((teacher) =>
    `${teacher.name || ''} ${teacher.email || ''} ${teacher.specialization || ''} ${teacher.institution || ''}`.toLowerCase().includes(q.toLowerCase()));
  renderTeacherApplicationsPanel(teacherFiltered);
  renderApplicationMetrics(filtered, teacherFiltered);
}
window.filterApplicantTable = filterApplicantTable;

function viewApplicant(id) {
  const a = allApplicants.find(x => x.id === id);
  if (!a) return;
  currentApplicantId = id;

  const header = document.getElementById('applicantDetailHeader');
  const body   = document.getElementById('applicantDetailBody');

  header.innerHTML = `
    <div style="width:90px;height:90px;border-radius:var(--radius-lg);background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.8rem;flex-shrink:0;">${a.first_name[0]}${a.father_name[0]}</div>
    <div>
      <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.3rem;">${a.first_name} ${a.father_name}</h3>
      <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">${a.email} · ${a.phone}</div>
      <div style="margin-top:8px;"><span class="badge ${a.status==='pending'?'status-pending':a.status==='approved'?'status-approved':'status-rejected'}">${a.status.toUpperCase()}</span></div>
    </div>`;

  const rows = [
    [' University', a.university],
    [' Program',    a.program_type],
    [' Year',       a.academic_year ? `Year ${a.academic_year}` : ''],
    [' Phone',      a.phone],
    [' Email',      a.email],
    ['🗓 Applied',    formatDate(a.created_at)],
  ];

  body.innerHTML = rows.map(([l,v]) => `
    <div style="display:flex;justify-content:space-between;padding:var(--space-3) 0;border-bottom:1px solid var(--light-200);font-size:0.875rem;">
      <span style="color:var(--text-muted);font-weight:500;">${l}</span>
      <span style="font-weight:600;">${v}</span>
    </div>`).join('') +
    `<div style="margin-top:var(--space-4);">
      <a class="doc-preview-link" href="#" onclick="viewDocument('slips', '${a.reg_slip}'); return false;"> View Registration Slip</a>
    </div>`;

  const approveBtn = document.getElementById('modalApproveBtn');
  const rejectBtn  = document.getElementById('modalRejectBtn');
  if (approveBtn) approveBtn.style.display = a.status === 'pending' ? 'inline-flex' : 'none';
  if (rejectBtn)  rejectBtn.style.display  = a.status === 'pending' ? 'inline-flex' : 'none';

  document.getElementById('applicantModal').classList.add('active');
}
window.viewApplicant = viewApplicant;

function viewDocument(docType, filename) {
  if (!filename) { showToast('No file attached', 'error'); return; }
  const token = API.getToken();
  fetch(`${API_BASE}/documents/${docType}/${filename}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(async response => {
    if(!response.ok) throw new Error("Document restricted or not found");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    window.open(url, "_blank"); 
  })
  .catch(err => showToast(err.message, "error"));
}
window.viewDocument = viewDocument;

function closeApplicantModal() { document.getElementById('applicantModal').classList.remove('active'); }
window.closeApplicantModal = closeApplicantModal;

async function quickApprove(id, btn) {
  try { await API.approveApplicant(id); } catch(_) {}
  if (btn) btn.closest('tr').querySelector('.badge').outerHTML = `<span class="badge status-approved"> Approved</span>`;
  const a = allApplicants.find(x => x.id === id); if (a) a.status = 'approved';
  showToast('Student approved. Admin should notify the student manually.', 'success');
}
window.quickApprove = quickApprove;

async function approveCurrentApplicant() {
  if (!currentApplicantId) return;
  try { await API.approveApplicant(currentApplicantId); } catch(_) {}
  closeApplicantModal();
  showToast('Student approved. Admin should notify the student manually.', 'success');
  const a = allApplicants.find(x => x.id === currentApplicantId); if (a) a.status = 'approved';
  renderApplicantsTable(allApplicants);
  loadDashboardStats();
}
window.approveCurrentApplicant = approveCurrentApplicant;

let rejectTargetId = null;

function openRejectModal(id) { rejectTargetId = id; document.getElementById('rejectModal').classList.add('active'); }
window.openRejectModal = openRejectModal;

function rejectCurrentApplicant() { openRejectModal(currentApplicantId); closeApplicantModal(); }
window.rejectCurrentApplicant = rejectCurrentApplicant;

async function confirmReject() {
  const reason = document.getElementById('rejectReason').value;
  const custom = document.getElementById('rejectReasonCustom').value.trim();
  const finalReason = custom ? `${reason}. ${custom}` : reason;
  const id = rejectTargetId || currentApplicantId;
  try { await API.rejectApplicant(id, finalReason); } catch(_) {}
  document.getElementById('rejectModal').classList.remove('active');
  const a = allApplicants.find(x => x.id === id); if (a) a.status = 'rejected';
  renderApplicantsTable(allApplicants);
  showToast('Application rejected. Admin should notify the student manually.', 'error');
  loadDashboardStats();
}
window.confirmReject = confirmReject;

async function adminDeleteApplicant(id) {
  if (!confirm('Permanently delete this applicant and all related data?')) return;
  try {
    await API.deleteApplicant(id);
    allApplicants = allApplicants.filter((x) => x.id !== id);
    renderApplicantsTable(allApplicants);
    showToast('Applicant removed', 'success');
    loadDashboardStats();
  } catch (e) {
    showToast(e.message || 'Delete failed', 'error');
  }
}
window.adminDeleteApplicant = adminDeleteApplicant;

// ── ALL STUDENTS ──────────────────────────────
async function loadAllStudents() {
  const tbody = document.getElementById('studentsTbody'); if (!tbody) return;
  let students = [];
  try { 
    students = await API.request('/admin/students?status=approved'); 
  } catch(err) { 
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;">Failed to get students</td></tr>`;
    return;
  }

  tbody.innerHTML = students.map(s => `
    <tr>
      <td><div class="table-avatar-name">
        <div class="table-avatar">${s.first_name[0]}${s.father_name[0]}</div>
        <div><div class="table-primary">${s.first_name} ${s.father_name}</div><div class="table-secondary">${s.email}</div></div>
      </div></td>
      <td style="font-family:monospace;font-size:0.78rem;">${s.student_id||''}</td>
      <td style="font-size:0.8rem;">${s.university}</td>
      <td><span class="badge badge-gray">${s.program_type}</span></td>
      <td style="font-size:0.8rem;">${s.academic_year ? `Year ${s.academic_year}` : ''}</td>
      <td><span class="badge ${s.status==='approved'?'status-approved':s.status==='pending'?'status-pending':'status-rejected'}">${s.status}</span></td>
      <td style="font-size:0.78rem;color:var(--text-muted);">${formatDate(s.created_at)}</td>
      <td><button type="button" class="action-btn action-btn-reject" onclick="adminDeleteRegisteredStudent(${s.id})">🗑 Delete</button></td>
    </tr>`).join('');
}

async function adminDeleteRegisteredStudent(id) {
  if (!confirm('Permanently delete this student account and all related data?')) return;
  try {
    await API.deleteRegisteredStudent(id);
    showToast('Student account deleted', 'success');
    loadAllStudents();
    loadDashboardStats();
  } catch (e) {
    showToast(e.message || 'Delete failed', 'error');
  }
}
window.adminDeleteRegisteredStudent = adminDeleteRegisteredStudent;
window.loadAllStudents = loadAllStudents;

function filterStudentTable(q) { loadAllStudents(); } // simplified
window.filterStudentTable = filterStudentTable;

// ── STUDENT MESSAGES (admin inbox) ────────────
let adminMsgThreads = [];
let adminMsgActiveId = null;

function renderAdminThreadList() {
  const listEl = document.getElementById('adminMsgThreadList');
  if (!listEl) return;
  if (!adminMsgThreads.length) {
    listEl.innerHTML =
      '<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:0.85rem;line-height:1.5;">No conversations yet. Students can reach you from <strong>Messaging</strong> in the student portal (same account you use here).</div>';
    return;
  }
  listEl.innerHTML = adminMsgThreads
    .map((t) => {
      const label = adminEsc(t.full_name || t.name);
      const preview = adminEsc((t.lastMsg || '').slice(0, 96));
      const unread =
        t.unread > 0
          ? `<span style="background:var(--epsa-green);color:#fff;font-size:0.65rem;padding:2px 8px;border-radius:999px;font-weight:700;">${t.unread}</span>`
          : '';
      const active =
        t.id === adminMsgActiveId
          ? 'background:rgba(26,107,60,0.08);border-left:3px solid var(--epsa-green);'
          : '';
      const initials = adminEsc(t.initials || '?');
      return `<button type="button" style="display:flex;width:100%;text-align:left;gap:10px;padding:14px 16px;border:none;border-bottom:1px solid var(--light-200);cursor:pointer;font:inherit;${active}" onclick="adminSelectThread(${t.id})">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-green-dark));color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:0.75rem;">${initials}</div>
        <div style="flex:1;min-width:0;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><span style="font-weight:700;font-size:0.85rem;">${label}</span>${unread}</div><div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview || ''}</div></div>
      </button>`;
    })
    .join('');
}

async function adminLoadThreadMessages(partnerId) {
  adminMsgActiveId = partnerId;
  const row = adminMsgThreads.find((x) => x.id === partnerId);
  const hdr = document.getElementById('adminMsgHeader');
  const body = document.getElementById('adminMsgBody');
  if (hdr) hdr.textContent = row ? row.full_name || row.name : 'Conversation';
  if (!body) return;
  body.innerHTML = '<div style="color:var(--text-muted);">Loading…</div>';
  try {
    const msgs = await API.getMessages(partnerId);
    if (!msgs.length) {
      body.innerHTML =
        '<div style="color:var(--text-muted);">No messages in this thread yet.</div>';
    } else {
      body.innerHTML = msgs
        .map((m) => {
          const mine = m.from === 'me';
          return `<div style="margin-bottom:12px;text-align:${mine ? 'right' : 'left'};"><span style="display:inline-block;max-width:88%;padding:10px 14px;border-radius:14px;background:${mine ? 'var(--epsa-green)' : '#fff'};color:${mine ? '#fff' : 'var(--text-primary)'};border:1px solid var(--light-200);">${adminEsc(m.text)}</span><div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;">${adminEsc(m.time || '')}</div></div>`;
        })
        .join('');
      body.scrollTop = body.scrollHeight;
    }
  } catch (e) {
    body.innerHTML = `<div style="color:#b91c1c;">${adminEsc(e.message)}</div>`;
  }
  try {
    const data = await API.getConversations();
    adminMsgThreads = Array.isArray(data) ? data : [];
    renderAdminThreadList();
  } catch (_) { /* keep previous thread list */ }
}

async function loadAdminStudentMessages() {
  const listEl = document.getElementById('adminMsgThreadList');
  const body = document.getElementById('adminMsgBody');
  const hdr = document.getElementById('adminMsgHeader');
  if (!listEl) return;
  try {
    const data = await API.getConversations();
    adminMsgThreads = Array.isArray(data) ? data : [];
  } catch (e) {
    listEl.innerHTML = `<div style="padding:24px;color:#b91c1c;font-size:0.85rem;">${adminEsc(e.message)}</div>`;
    if (body) body.innerHTML = '';
    if (hdr) hdr.textContent = 'Select a conversation';
    return;
  }
  renderAdminThreadList();
  if (!adminMsgThreads.length) {
    if (body) body.innerHTML = '';
    if (hdr) hdr.textContent = 'Select a conversation';
    adminMsgActiveId = null;
    return;
  }
  if (!adminMsgActiveId || !adminMsgThreads.some((t) => t.id === adminMsgActiveId)) {
    adminMsgActiveId = adminMsgThreads[0].id;
  }
  await adminLoadThreadMessages(adminMsgActiveId);
}
window.loadAdminStudentMessages = loadAdminStudentMessages;

async function adminSelectThread(partnerId) {
  await adminLoadThreadMessages(partnerId);
  renderAdminThreadList();
}
window.adminSelectThread = adminSelectThread;

async function sendAdminThreadMessage() {
  const input = document.getElementById('adminMsgInput');
  if (!input || !adminMsgActiveId) {
    showToast('Select a conversation first', 'error');
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  try {
    await API.sendMessage(adminMsgActiveId, text);
    input.value = '';
    await loadAdminStudentMessages();
  } catch (e) {
    showToast(e.message || 'Send failed', 'error');
  }
}
window.sendAdminThreadMessage = sendAdminThreadMessage;

// ── TRAININGS ─────────────────────────────────

async function loadAdminTrainings() {
  const tbody = document.getElementById('trainingsTbody'); if (!tbody) return;
  try {
    allTrainingsAdmin = await API.getAdminTrainings();
    if (!allTrainingsAdmin.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No training programs yet</td></tr>`;
      return;
    }
    tbody.innerHTML = allTrainingsAdmin.map(t => `
    <tr style="opacity:${t.is_active ? 1 : 0.6};">
      <td><div class="table-primary">${t.title}</div>
        ${!t.is_active ? '<div style="font-size:0.72rem;color:var(--epsa-red);">⚠ Inactive</div>' : ''}
      </td>
      <td><span class="badge ${t.format==='online'?'badge-blue':'badge-green'}">${t.format==='online'?'💻 Online':' In-Person'}</span></td>
      <td style="font-weight:700;color:var(--epsa-green);">${t.price===0?' Free':'ETB '+t.price.toLocaleString()}</td>
      <td>${t.applicant_count || 0}</td>
      <td><span class="badge ${t.is_active ? 'status-approved' : 'status-rejected'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
      <td><div class="table-actions">
        <button class="action-btn action-btn-view" onclick="openEditTraining(${t.id})">Edit</button>
        <button class="action-btn ${t.is_active ? 'action-btn-reject' : 'action-btn-approve'}" onclick="toggleTrainingStatus(${t.id})">${t.is_active ? 'Deactivate' : '▶ Activate'}</button>
      </div></td>
    </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">Failed to get trainings</td></tr>`;
  }
}
window.loadAdminTrainings = loadAdminTrainings;

function openCreateTrainingModal() { document.getElementById('createTrainingModal').classList.add('active'); }
window.openCreateTrainingModal = openCreateTrainingModal;

function openEditTraining(id) {
  const t = allTrainingsAdmin.find(x => x.id === id);
  if (!t) return;
  document.getElementById('et-id').value = t.id;
  document.getElementById('et-title').value = t.title || '';
  document.getElementById('et-format').value = t.format || 'online';
  document.getElementById('et-price').value = t.price || 0;
  document.getElementById('et-desc').value = t.description || '';
  document.getElementById('editTrainingModal').classList.add('active');
}
window.openEditTraining = openEditTraining;

async function submitEditTraining() {
  const id    = document.getElementById('et-id').value;
  const title = document.getElementById('et-title').value.trim();
  const desc  = document.getElementById('et-desc').value.trim();
  if (!title || !desc) { showToast('Title and description required', 'error'); return; }
  try {
    await API.updateTraining(id, {
      title, description: desc,
      format: document.getElementById('et-format').value,
      price:  parseFloat(document.getElementById('et-price').value) || 0
    });
    document.getElementById('editTrainingModal').classList.remove('active');
    showToast(' Training updated!', 'success');
    loadAdminTrainings();
  } catch(e) { showToast('Error updating training', 'error'); }
}
window.submitEditTraining = submitEditTraining;

async function toggleTrainingStatus(id) {
  try {
    const res = await API.toggleTraining(id);
    showToast(res.message, res.is_active ? 'success' : 'gold');
    loadAdminTrainings();
  } catch(e) { showToast('Error updating training status', 'error'); }
}
window.toggleTrainingStatus = toggleTrainingStatus;

async function deactivateTraining(id) {
  if (!confirm('Are you sure you want to deactivate this training program?')) return;
  await toggleTrainingStatus(id);
}
window.deactivateTraining = deactivateTraining;

async function submitCreateTraining() {
  const title = document.getElementById('ct-title').value.trim();
  const desc  = document.getElementById('ct-desc').value.trim();
  if (!title || !desc) { showToast('Title and description required', 'error'); return; }
  try {
    const fileInput = document.getElementById('ct-graphic');
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (file) {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('description', desc);
      fd.append('format', document.getElementById('ct-format').value);
      fd.append('price', String(parseFloat(document.getElementById('ct-price').value) || 0));
      fd.append('icon', document.getElementById('ct-icon').value || '');
      fd.append('cert_title', document.getElementById('ct-cert').value || '');
      fd.append('content_url', document.getElementById('ct-url').value || '');
      fd.append('graphic_caption', (document.getElementById('ct-graphic-caption')?.value || '').trim());
      fd.append('graphic_design', file);
      await API.createTrainingWithUpload(fd);
      if (fileInput) fileInput.value = '';
    } else {
      await API.createTraining({
        title, description: desc,
        format: document.getElementById('ct-format').value,
        price: parseFloat(document.getElementById('ct-price').value) || 0,
        icon: document.getElementById('ct-icon').value || '',
        cert_title: document.getElementById('ct-cert').value,
        content_url: document.getElementById('ct-url').value,
      });
    }
    document.getElementById('createTrainingModal').classList.remove('active');
    showToast(' Training program created!', 'success');
    loadAdminTrainings();
  } catch(err) {
    showToast(err.message || 'Failed to create training', 'error');
  }
}
window.submitCreateTraining = submitCreateTraining;

// ── RECEIPTS ──────────────────────────────────

async function loadPendingReceipts() {
  const tbody = document.getElementById('receiptsTbody'); if (!tbody) return;
  try {
    const receipts = await API.request('/admin/training-applications?status=receipt');
    if (!receipts.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No pending receipts</td></tr>`;
      return;
    }
    tbody.innerHTML = receipts.map(r => `
    <tr>
      <td><div class="table-primary">${r.student_name}</div><div class="table-secondary">${r.university}</div></td>
      <td>${r.training_title}</td>
      <td style="font-weight:700;color:var(--epsa-green);">Paid</td>
      <td style="font-size:0.78rem;color:var(--text-muted);">${formatDate(r.submitted_at)}</td>
      <td><a class="doc-preview-link" href="#" style="font-size:0.8rem;" onclick="viewDocument('receipts', '${r.receipt_path}'); return false;"> View Receipt</a></td>
      <td><div class="table-actions">
        <button class="action-btn action-btn-approve" onclick="verifyReceiptRow(${r.id},this)"> Verify</button>
        <button class="action-btn action-btn-reject"  onclick="showToast('Receipt rejected','error')"> Reject</button>
      </div></td>
    </tr>`).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">Failed to get receipts</td></tr>`;
  }
}
window.loadPendingReceipts = loadPendingReceipts;

async function verifyReceiptRow(id, btn) {
  try { await API.verifyReceipt(id); } catch(_) {}
  if (btn) btn.closest('tr').style.opacity = '0.4';
  showToast(' Receipt verified! Student is now registered for the training.', 'success');
}
window.verifyReceiptRow = verifyReceiptRow;

// ── VOTING ADMIN ──────────────────────────────
let _allNominations = [];
let _nomFilter = 'all';
let _analyticsRefreshTimer = null;
let _currentVotingTab = 'control';
let _currentExamSubmissionData = null;
let _currentExamSubmissionId = null;
let _examSubmissionPoller = null;

function adminEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureVotingWorkspaceShell() {
  const tabsBar = document.querySelector('#asec-voting > div[style*="width:fit-content"]');
  if (tabsBar && !document.getElementById('vtab-executive')) {
    const nebTab = document.getElementById('vtab-neb');
    nebTab?.insertAdjacentHTML('beforebegin', `
      <button class="voting-admin-tab" id="vtab-executive" onclick="switchVotingTab('executive')">Executive Governance</button>
      <button class="voting-admin-tab" id="vtab-nrc" onclick="switchVotingTab('nrc')">NRC Management</button>
    `);
  }

  const controlPanel = document.getElementById('vpanel-control');
  if (controlPanel && !document.getElementById('votingLifecycleBoard')) {
    controlPanel.insertAdjacentHTML('afterbegin', `
      <div id="votingLifecycleBoard" class="governance-launchpad">
        <div class="governance-loading">Loading election control workspace…</div>
      </div>
    `);
  }

  const analyticsPanel = document.getElementById('vpanel-analytics');
  if (analyticsPanel && !document.getElementById('vpanel-executive')) {
    analyticsPanel.insertAdjacentHTML('afterend', `
      <div id="vpanel-executive" class="voting-admin-panel" style="display:none;">
        <div style="margin-bottom:var(--space-5);">
          <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.25rem;">Executive Governance Workspace</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Form the executive committee from election results, manage roles, vacancies, handovers, and long-term governance actions in one place.</p>
        </div>
        <div id="executiveDashboardRoot">
          <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading executive governance workspace…</div>
        </div>
      </div>
      <div id="vpanel-nrc" class="voting-admin-panel" style="display:none;">
        <div style="margin-bottom:var(--space-5);">
          <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.25rem;">NRC Management Workspace</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Sync university winners into the NRC, supervise representative status, and handle replacements and accountability actions without leaving the voting system.</p>
        </div>
        <div id="nrcDashboardRoot">
          <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading NRC management workspace…</div>
        </div>
      </div>
    `);
  }
}

function ensureExamMonitoringShell() {
  const modal = document.getElementById('submissionsModal');
  if (!modal || modal.dataset.enhanced === '1') return;
  const modalCard = modal.querySelector('.modal');
  const bodyContainer = modal.querySelector('div[style*="overflow-y:auto"]');
  const closeBtn = modal.querySelector('button.btn.btn-ghost');
  const modalTitle = modal.querySelector('h3');
  if (modalCard) {
    modalCard.style.maxWidth = '1280px';
    modalCard.style.width = '97vw';
    modalCard.style.maxHeight = '90vh';
  }
  if (modalTitle) modalTitle.textContent = 'Exam Monitoring & Review';
  if (closeBtn) closeBtn.setAttribute('onclick', 'closeSubmissionsModal()');
  if (bodyContainer) {
    bodyContainer.innerHTML = `
      <div id="sub-summary-grid" class="exam-monitor-grid">
        <div class="governance-loading">Loading exam summary…</div>
      </div>
      <div class="exam-monitor-layout">
        <div class="exam-monitor-main">
          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Live Student Activity</div>
              <div class="exam-monitor-caption">This feed updates while students are inside the exam.</div>
            </div>
            <div id="sub-live-feed" class="exam-live-feed">
              <div class="governance-loading">Waiting for live exam activity…</div>
            </div>
          </div>

          <div class="data-table-card">
            <div class="table-header">
              <div class="table-title">Student Attempts</div>
              <div class="exam-monitor-caption">Students stay blocked from scores until the admin releases results.</div>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table">
                <thead><tr><th>#</th><th>Student</th><th>Status</th><th>Progress</th><th>Score</th><th>Review</th><th>Last Activity</th><th>Submitted</th></tr></thead>
                <tbody id="sub-tbody"><tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">Loading…</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Question-by-Question Analysis</div>
              <div class="exam-monitor-caption">Spot weak questions, popular options, and correctness trends instantly.</div>
            </div>
            <div id="sub-question-grid" class="exam-question-grid">
              <div class="governance-loading">Building question analytics…</div>
            </div>
          </div>
        </div>

        <div class="exam-monitor-side">
          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Student Detail</div>
              <div class="exam-monitor-caption">Select a row to review an individual attempt in detail.</div>
            </div>
            <div id="sub-detail-panel" class="exam-detail-panel">
              <div class="governance-loading">Choose a student attempt to view detailed analysis.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  modal.dataset.enhanced = '1';
}

function renderVotingLifecycleBoard() {
  const board = document.getElementById('votingLifecycleBoard');
  if (!board) return;
  const phases = window._epsVotingConfig || [];
  const stats = window._epsVotingAnalytics || {};
  const phaseBreakdown = Array.isArray(stats.phase_breakdown) ? stats.phase_breakdown : [];
  if (!phases.length) {
    board.innerHTML = `<div class="governance-loading">Election controls will appear once the voting phases load.</div>`;
    return;
  }

  const activePhase = phases.find((phase) => phase.status === 'active') || null;
  const nextPhase = phases.find((phase) => phase.can_start) || null;
  const helperCards = phases.map((phase) => {
    const metrics = phaseBreakdown.find((item) => Number(item.phase_number) === Number(phase.phase_number)) || {};
    const phaseState = phase.status === 'active' ? 'Live now' : phase.status === 'finalized' ? 'Finalized' : 'Not started';
    const tone = phase.status === 'active' ? 'green' : phase.status === 'finalized' ? 'blue' : 'gold';
    const actionButton = phase.can_finalize
      ? `<button class="btn btn-primary btn-sm" onclick="triggerAutomationPhase(${phase.phase_number})">Finalize Phase</button>`
      : phase.can_start
        ? `<button class="btn btn-gold btn-sm" onclick="activateVotingPhase(${phase.phase_number})">Start Phase</button>`
        : phase.status === 'finalized'
          ? `<button class="btn btn-ghost btn-sm" onclick="switchVotingTab('analytics')">View Results</button>`
          : `<button class="btn btn-ghost btn-sm" disabled style="opacity:0.65;cursor:not-allowed;">Locked</button>`;
    return `
      <div class="governance-phase-card ${tone}">
        <div class="governance-phase-top">
          <div>
            <div class="governance-phase-kicker">Phase ${phase.phase_number}</div>
            <div class="governance-phase-title">${adminEsc(phase.title)}</div>
          </div>
          <span class="soft-badge ${tone}">${phaseState}</span>
        </div>
        <div class="governance-phase-meta">
          <span>${metrics.candidate_count || 0} approved candidates</span>
          <span>${metrics.vote_count || 0} votes captured</span>
        </div>
        <div class="governance-phase-dates">
          <strong>Window</strong>
          <span>${phase.starts_at ? formatDate(phase.starts_at) : 'Start not set'} to ${phase.ends_at ? formatDate(phase.ends_at) : 'End not set'}</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">${adminEsc(phase.helper_text || '')}</div>
        <div class="governance-phase-actions">
          <button class="btn btn-ghost btn-sm" onclick="switchVotingTab('nominations')">Review Candidates</button>
          ${actionButton}
        </div>
      </div>
    `;
  }).join('');

  board.innerHTML = `
    <div class="governance-launch-grid">
      <div class="governance-hero-card">
        <div class="governance-phase-kicker">Election Launch Guide</div>
        <h3>${activePhase ? `Phase ${activePhase.phase_number} is the active election window.` : 'No phase is live right now.'}</h3>
        <p>${activePhase
          ? `Students are currently working inside ${adminEsc(activePhase.title)}. Use the nomination, analytics, and governance tabs to supervise the election in real time.`
          : `Set the election dates, start the correct phase, and finalize it before unlocking the next governance stage.`}
        </p>
        <div class="governance-hero-actions">
          ${activePhase
            ? `<button class="btn btn-primary" onclick="triggerAutomationPhase(${activePhase.phase_number})">Finalize Phase ${activePhase.phase_number}</button>`
            : nextPhase
              ? `<button class="btn btn-primary" onclick="activateVotingPhase(${nextPhase.phase_number})">Start ${adminEsc(nextPhase.title)}</button>`
              : `<button class="btn btn-primary" onclick="switchVotingTab('analytics')">Open Live Analytics</button>`}
          <button class="btn btn-ghost" onclick="switchVotingTab('executive')">Open Executive Workspace</button>
          <button class="btn btn-ghost" onclick="switchVotingTab('nrc')">Open NRC Workspace</button>
        </div>
      </div>
      <div class="governance-checklist-card">
        <div class="governance-phase-kicker">Admin Flow</div>
        <div class="governance-checklist-item"><strong>1.</strong> Set the phase dates and save the election schedule.</div>
        <div class="governance-checklist-item"><strong>2.</strong> Start Phase 1, supervise nominations and voting, then finalize it.</div>
        <div class="governance-checklist-item"><strong>3.</strong> Start Phase 2 only after Phase 1 is fully finalized.</div>
        <div class="governance-checklist-item"><strong>4.</strong> Finalize Phase 2 to lock the executive committee and move into governance management.</div>
      </div>
    </div>
    <div class="governance-phase-grid">
      ${helperCards}
    </div>
  `;
}

async function activateVotingPhase(phaseNumber) {
  const config = window._epsVotingConfig || [];
  const selected = config.find(item => Number(item.phase_number) === Number(phaseNumber));
  if (!selected) return;
  const confirmed = confirm(`Start Phase ${selected.phase_number} now? This will make "${selected.title}" the only active election phase.`);
  if (!confirmed) return;
  try {
    await saveVotingConfig(true);
    const res = await API.startVotingPhase(selected.phase_number);
    if (res?.phases) window._epsVotingConfig = res.phases;
    showToast(`Phase ${selected.phase_number} is now live.`, 'success');
    await loadVotingConfig();
    await loadVotingAnalytics();
  } catch (err) {
    showToast(err.message || 'Unable to activate phase', 'error');
  }
}
window.activateVotingPhase = activateVotingPhase;

async function loadVotingAdmin() {
  ensureVotingWorkspaceShell();
  await Promise.all([
    loadVotingConfig(),
    loadNominationsAdmin(),
    loadVotingAnalytics(),
  ]);
  switchVotingTab(_currentVotingTab);
  clearInterval(_analyticsRefreshTimer);
  _analyticsRefreshTimer = setInterval(() => {
    if (currentAdminSection !== 'voting') return;
    if (_currentVotingTab === 'analytics' || _currentVotingTab === 'control') loadVotingAnalytics();
    if (_currentVotingTab === 'executive' && typeof window.loadExecutiveDashboard === 'function') window.loadExecutiveDashboard();
    if (_currentVotingTab === 'nrc' && typeof window.loadNRCDashboard === 'function') window.loadNRCDashboard();
  }, 30000);
}
window.loadVotingAdmin = loadVotingAdmin;

// ── Voting Admin Tab Switch ────────────────────
function switchVotingTab(tab) {
  ensureVotingWorkspaceShell();
  _currentVotingTab = tab;
  ['control','nominations','analytics','executive','nrc','neb'].forEach(t => {
    const panel = document.getElementById(`vpanel-${t}`);
    const tabBtn = document.getElementById(`vtab-${t}`);
    if (panel)  panel.style.display  = t === tab ? 'block' : 'none';
    if (tabBtn) tabBtn.classList.toggle('active', t === tab);
  });
  if (tab === 'analytics') loadVotingAnalytics();
  if (tab === 'executive' && typeof window.loadExecutiveDashboard === 'function') window.loadExecutiveDashboard();
  if (tab === 'nrc' && typeof window.loadNRCDashboard === 'function') window.loadNRCDashboard();
  if (tab === 'neb')       loadNEBCandidates();
}
window.switchVotingTab = switchVotingTab;

// ── Nominations (Card View) ────────────────────
async function loadNominationsAdmin() {
  const grid = document.getElementById('nominationCardsGrid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:var(--space-8);">Loading nominations…</div>`;
  try {
    _allNominations = await API.request('/admin/voting/nominations');
    renderNominationCards(_nomFilter);
    // Update KPI badge
    const pending = _allNominations.filter(n => n.is_approved === 0).length;
    const nomKpi = document.getElementById('vkpi-noms');
    if (nomKpi) nomKpi.textContent = pending;
  } catch(e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:red;padding:var(--space-8);">Error loading nominations</div>`;
  }
}
window.loadNominationsAdmin = loadNominationsAdmin;

function filterNominations(filter, tabEl) {
  _nomFilter = filter;
  document.querySelectorAll('#nomFilterTabs .pill-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  renderNominationCards(filter);
}
window.filterNominations = filterNominations;

function renderNominationCards(filter) {
  const grid = document.getElementById('nominationCardsGrid');
  if (!grid) return;

  let noms = _allNominations;
  if (filter === 'pending')  noms = noms.filter(n => n.is_approved === 0);
  if (filter === 'approved') noms = noms.filter(n => n.is_approved === 1);
  if (filter === 'rejected') noms = noms.filter(n => n.is_approved === -1);

  if (!noms.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:var(--space-10);background:white;border-radius:var(--radius-xl);border:1px dashed var(--light-300);">
      <div style="font-size:2rem;margin-bottom:var(--space-3);"></div>
      <div style="font-weight:700;color:var(--text-primary);">No nominations found</div>
      <div style="font-size:0.85rem;margin-top:var(--space-2);">No candidates match this filter</div>
    </div>`;
    return;
  }

  const statusBadge = (s) => {
    if (s === 1)  return `<span class="nom-badge-approved"> Approved</span>`;
    if (s === -1) return `<span class="nom-badge-rejected"> Rejected</span>`;
    return `<span class="nom-badge-pending"> Pending</span>`;
  };

  grid.innerHTML = noms.map(n => {
    const initials = n.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    const statementPreview = (n.statement || 'No statement provided').substring(0, 90) + (n.statement?.length > 90 ? '…' : '');
    return `
    <div class="nomination-card">
      <div class="nomination-card-header">
        <div class="nom-avatar">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.name}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;"> ${n.university}</div>
          <div style="font-size:0.72rem;color:var(--epsa-gold-dark);margin-top:2px;font-weight:600;">Phase ${n.phase_id} · ${n.position || 'Representative'}</div>
        </div>
        <div>${statusBadge(n.is_approved)}</div>
      </div>
      <div class="nomination-card-body">
        <p style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5;margin-bottom:var(--space-3);">${statementPreview}</p>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
          ${n.manifesto_path ? `<a href="${API.resolveUploadUrl('manifestos', n.manifesto_path)}" target="_blank" style="font-size:0.75rem;padding:4px 10px;background:rgba(37,99,235,0.08);color:#2563eb;border-radius:var(--radius-full);text-decoration:none;font-weight:600;"> Manifesto</a>` : ''}
          ${n.video_url ? `<a href="${n.video_url}" target="_blank" style="font-size:0.75rem;padding:4px 10px;background:rgba(220,38,38,0.08);color:#dc2626;border-radius:var(--radius-full);text-decoration:none;font-weight:600;">▶ Video</a>` : ''}
          <span style="font-size:0.72rem;color:var(--text-muted);align-self:center;margin-left:auto;">${formatDate(n.nominated_at)}</span>
        </div>
      </div>
      <div class="nomination-card-footer">
        ${n.is_approved === 0 ? `
          <button class="action-btn action-btn-approve" onclick="approveNomination(${n.id},this)"> Approve</button>
          <button class="action-btn action-btn-reject"  onclick="rejectNomination(${n.id},this)"> Reject</button>
        ` : `<span style="font-size:0.75rem;color:var(--text-muted);">Decision recorded</span>`}
        <button class="action-btn action-btn-view" style="margin-left:auto;" onclick="viewNominationDetail(${n.id})">View Details</button>
      </div>
    </div>`;
  }).join('');
}
window.renderNominationCards = renderNominationCards;

function viewNominationDetail(id) {
  const n = _allNominations.find(x => x.id === id);
  if (!n) return;
  const detail = `Candidate: ${n.name}\nUniversity: ${n.university}\nPosition: ${n.position || 'Representative'}\n\nStatement:\n${n.statement || '(none)'}\n\nVision:\n${n.vision || '(none)'}`;
  alert(detail); // TODO: Replace with a proper modal
}
window.viewNominationDetail = viewNominationDetail;

async function approveNomination(id, btn) {
  try {
    await API.request(`/admin/voting/nominations/${id}/approve`, {method: 'POST'});
    showToast(' Nomination Approved  candidate is now visible to voters', 'success');
    loadNominationsAdmin();
  } catch(err) { showToast(err.message, 'error'); }
}
window.approveNomination = approveNomination;

async function rejectNomination(id, btn) {
  try {
    await API.request(`/admin/voting/nominations/${id}/reject`, {method: 'POST'});
    showToast(' Nomination Rejected', 'success');
    loadNominationsAdmin();
  } catch(err) { showToast(err.message, 'error'); }
}
window.rejectNomination = rejectNomination;

// ── Voting Config ──────────────────────────────
async function loadVotingConfig() {
  const div = document.getElementById('votingConfigForm'); if(!div) return;
  div.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:var(--space-4);">Loading phases...</div>`;
  try {
    const config = await API.getVotingConfig();
    window._epsVotingConfig = config;

    div.innerHTML = config.map(c => {
      const tone = c.status === 'active' ? 'var(--epsa-green)' : c.status === 'finalized' ? '#2563eb' : 'var(--epsa-gold-dark)';
      const statusLabel = c.status === 'active' ? 'Active' : c.status === 'finalized' ? 'Finalized' : 'Not started';
      const actionMarkup = c.can_finalize
        ? `<button class="btn btn-primary btn-sm" onclick="triggerAutomationPhase(${c.phase_number})">Finalize Phase ${c.phase_number}</button>`
        : c.can_start
          ? `<button class="btn btn-gold btn-sm" onclick="activateVotingPhase(${c.phase_number})">Start Phase ${c.phase_number}</button>`
          : `<button class="btn btn-ghost btn-sm" disabled style="opacity:0.65;cursor:not-allowed;">${c.status === 'finalized' ? 'Locked Complete' : 'Waiting'}</button>`;
      return `
      <div style="background:${c.status === 'active' ? 'rgba(26,107,60,0.04)' : c.status === 'finalized' ? 'rgba(37,99,235,0.04)' : 'var(--light-50)'};padding:var(--space-5);border-radius:var(--radius-xl);border:1.5px solid ${c.status === 'active' ? 'rgba(26,107,60,0.2)' : c.status === 'finalized' ? 'rgba(37,99,235,0.18)' : 'var(--light-200)'};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
          <div>
            <div style="font-weight:800;font-size:1rem;">Phase ${c.phase_number} - ${c.title}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${c.description || (c.phase_number === 1 ? 'University Representatives' : 'National Executive Board')}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;line-height:1.6;">${adminEsc(c.helper_text || '')}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;">
            <span style="font-size:0.78rem;font-weight:700;color:${tone};">${statusLabel}</span>
            ${actionMarkup}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);">
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;text-transform:uppercase;">Start Date/Time</label>
            <input type="datetime-local" class="form-input" id="vphase_start_${c.id}" value="${c.starts_at ? c.starts_at.replace(' ', 'T').substring(0,16) : ''}" style="font-size:0.82rem;">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:4px;text-transform:uppercase;">End Date/Time</label>
            <input type="datetime-local" class="form-input" id="vphase_end_${c.id}"   value="${c.ends_at   ? c.ends_at.replace(' ', 'T').substring(0,16)   : ''}" style="font-size:0.82rem;">
          </div>
        </div>
      </div>`;
    }).join('');
    renderVotingLifecycleBoard();
  } catch(err) {
    div.innerHTML = `<p style="color:red;">Failed to get configuration.</p>`;
  }
}
window.loadVotingConfig = loadVotingConfig;

function togglePhaseActiveState() {}
window.togglePhaseActiveState = togglePhaseActiveState;

async function saveVotingConfig(silent = false) {
  const config = window._epsVotingConfig;
  if (!config) return;
  const payload = config.map(c => ({
    id: c.id,
    starts_at: document.getElementById(`vphase_start_${c.id}`)?.value || '',
    ends_at:   document.getElementById(`vphase_end_${c.id}`)?.value   || '',
  }));
  try {
    const res = await API.updateVotingConfig({ phases: payload });
    if (res?.phases) window._epsVotingConfig = res.phases;
    if (!silent) showToast('Voting schedule saved.', 'success');
    await loadVotingConfig();
    return res;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}
window.saveVotingConfig = saveVotingConfig;

async function resetElectionCycle() {
  const confirm1 = confirm("⚠ DANGER ZONE: Are you sure you want to completely RESET the election?");
  if (!confirm1) return;
  const confirm2 = prompt("Type 'RESET' to confirm deleting all votes and nominations:");
  if (confirm2 !== "RESET") {
    showToast("Reset cancelled.", "info");
    return;
  }
  
  try {
    await API.request('/admin/voting/reset', { method: 'POST' });
    showToast(" Election cycle completely reset and cleared.", "success");
    loadVotingConfig();
    loadVotingAnalytics();
    if(window.loadNominationsAdmin) loadNominationsAdmin();
  } catch(err) {
    showToast(err.message, 'error');
  }
}
window.resetElectionCycle = resetElectionCycle;

// ── Voting Analytics ───────────────────────────
async function loadVotingAnalytics() {
  try {
    const stats = await API.request('/admin/voting/analytics');
    window._epsVotingAnalytics = stats;

    // Update main KPI cards
    const s = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    s('vkpi-votes',   stats.total_votes);
    s('vkpi-turnout', `${stats.turnout_pct}%`);
    s('vkpi-unis',    stats.uni_breakdown.length);

    // Analytics tab  gauge
    const gaugePct = document.getElementById('analyticsGaugePct');
    const gaugeBar = document.getElementById('analyticsGaugeBar');
    const votesEl  = document.getElementById('analyticsVotes');
    const eligEl   = document.getElementById('analyticsEligible');
    if (gaugePct) gaugePct.textContent = `${stats.turnout_pct}%`;
    if (gaugeBar) gaugeBar.style.width = `${Math.min(stats.turnout_pct, 100)}%`;
    if (votesEl)  votesEl.textContent  = stats.total_votes;
    if (eligEl)   eligEl.textContent   = stats.total_students || '';

    // University breakdown bars
    const breakdown = document.getElementById('analyticsUniBreakdown');
    if (breakdown) {
      const maxVotes = Math.max(...stats.uni_breakdown.map(u => u.count), 1);
      if (!stats.uni_breakdown.length) {
        breakdown.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:var(--space-4);">No votes cast yet</div>`;
      } else {
        breakdown.innerHTML = stats.uni_breakdown.map(u => `
          <div class="uni-vote-bar-wrap">
            <span class="uni-vote-bar-label" title="${u.university}">${u.university}</span>
            <div class="uni-vote-bar-track">
              <div class="uni-vote-bar-fill" style="width:${Math.round((u.count/maxVotes)*100)}%;"></div>
            </div>
            <span class="uni-vote-bar-count">${u.count}</span>
          </div>`).join('');
      }
    }

    // Top candidates leaderboard (fetch from results or use analytics)
    if (stats.top_candidates && stats.top_candidates.length) {
      const ranks = ['gold','silver','bronze'];
      const lb = document.getElementById('analyticsLeaderboard');
      if (lb) lb.innerHTML = stats.top_candidates.slice(0,5).map((c,i) => `
        <div class="leaderboard-item">
          <div class="leaderboard-rank ${ranks[i] || 'other'}">${i+1}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${c.university || ''}</div>
          </div>
          <div style="font-family:var(--font-display);font-weight:800;color:var(--epsa-green);">${c.votes}</div>
        </div>`).join('');
    }
    renderVotingLifecycleBoard();
  } catch(e) {
    console.warn('Analytics load failed', e);
  }
}
window.loadVotingAnalytics = loadVotingAnalytics;

// ── Finalize Phases ────────────────────────────
async function triggerAutomationPhase(phaseNum) {
  if (!confirm(`Are you sure you want to finalize Phase ${phaseNum}?\n\nThis will:\n${phaseNum===1 ? '- Lock university winners and sync the NRC' : '- Lock the national ranking and build the executive committee'}\n\nThis step cannot be reopened automatically.`)) return;
  try {
    const res = await API.finalizeVotingPhase(phaseNum);
    if (res?.phases) window._epsVotingConfig = res.phases;
    showToast(res.message || `Phase ${phaseNum} finalized.`, 'success');
    await loadVotingConfig();
    await loadVotingAnalytics();
    if (phaseNum === 2) switchVotingTab('executive');
  } catch(e) {
    showToast(e.message, 'error');
  }
}
window.triggerAutomationPhase = triggerAutomationPhase;

// ── NEB Assignment ─────────────────────────────
async function loadNEBCandidates() {
  const container = document.getElementById('nebCandidatesList');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:var(--space-4);">Loading candidates…</div>`;
  try {
    const res = await API.request('/voting/candidates?phase=2');
    const cands = res.candidates || [];
    if (!cands.length) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-muted);background:rgba(255,255,255,0.6);border-radius:var(--radius-lg);padding:var(--space-8);">No Phase 2 candidates available. Finalize Phase 2 first.</div>`;
      return;
    }

    const roles = [
      'Director of Finance & Administration',
      'Director of Communications & PR',
      'Director of Academic Affairs',
      'Director of Training',
      'Director of External Relations',
    ];

    container.innerHTML = roles.map((r, idx) => `
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:var(--space-4);align-items:center;background:rgba(255,255,255,0.7);border-radius:var(--radius-lg);padding:var(--space-4);">
        <div>
          <div style="font-weight:700;font-size:0.88rem;">${r}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Director Position</div>
        </div>
        <select class="form-select" id="neb_assign_${idx}" style="font-size:0.85rem;">
          <option value=""> Select Candidate </option>
          ${cands.map(c => `<option value="${c.user_id}">${c.name} (${c.university}) · ${c.vote_count} votes</option>`).join('')}
        </select>
        <button class="btn btn-sm" style="background:var(--epsa-gold);color:white;border:none;white-space:nowrap;" onclick="assignNEBRole('${r.replace(/'/g,"\\'")}', 'neb_assign_${idx}')">Assign </button>
      </div>`).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:red;padding:var(--space-4);">Error loading candidates: ${e.message}</div>`;
  }
}
window.loadNEBCandidates = loadNEBCandidates;

async function assignNEBRole(roleName, selectId) {
  const userId = document.getElementById(selectId)?.value;
  if (!userId) { showToast('Please select a candidate first', 'error'); return; }
  try {
    await API.request('/admin/voting/assign_neb', {
      method: 'POST',
      body: { user_id: userId, position: roleName, rank: 5 }
    });
    showToast(` ${roleName} assigned successfully!`, 'success');
  } catch(e) {
    showToast(e.message, 'error');
  }
}
window.assignNEBRole = assignNEBRole;

// ── EXAMS ADMIN ───────────────────────────────
async function loadAdminExams() {
  const tbody = document.getElementById('examsTbody'); if (!tbody) return;
  try {
    allExamsAdmin = await API.getAdminExams();
    if (!allExamsAdmin.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No exams yet. Create one to get started.</td></tr>`;
      return;
    }
    tbody.innerHTML = allExamsAdmin.map(e => {
      let statusBadge, publishBtn;
      if (!e.is_active) {
        statusBadge = `<span class="badge badge-gray"> Draft</span>`;
        publishBtn  = `<button class="action-btn action-btn-approve" onclick="publishExamSet(${e.id}, true)">🚀 Publish</button>`;
      } else {
        statusBadge = `<span class="badge status-approved"> Live</span>`;
        publishBtn  = `<button class="action-btn action-btn-reject" onclick="publishExamSet(${e.id}, false)"> Unpublish</button>`;
      }
      return `
      <tr style="opacity:${e.is_active ? 1 : 0.7};">
        <td><div class="table-primary">${e.title}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${e.description||''}</div>
        </td>
        <td>${e.duration_mins} min</td>
        <td><strong>${e.question_count || 0}</strong> Qs</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${formatDate(e.scheduled_at)}</td>
        <td>${statusBadge}</td>
        <td>${e.submission_count || 0}</td>
        <td><div class="table-actions" style="flex-wrap:wrap;gap:4px;">
          <button class="action-btn action-btn-view" onclick="openEditExam(${e.id})">Edit</button>
          <button class="action-btn" style="background:#e8f4ff;color:#1d6fa4;" onclick="openQuestionBuilder(${e.id}, '${e.title.replace(/'/g, "\\'")}')">🗒 Questions</button>
          <button class="action-btn" style="background:#f0faf5;color:#1a6b3c;" onclick="openSubmissionsModal(${e.id})"> Results</button>
          ${publishBtn}
        </div></td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;">Failed to get exams</td></tr>`;
  }
}
window.loadAdminExams = loadAdminExams;

function openCreateExamModal() { document.getElementById('createExamModal').classList.add('active'); }
window.openCreateExamModal = openCreateExamModal;

async function submitCreateExam() {
  const title = document.getElementById('ce-title').value.trim();
  const desc  = document.getElementById('ce-desc').value.trim();
  if (!title || !desc) { showToast('Title and description required', 'error'); return; }
  try {
    const passEl = document.getElementById('ce-passing');
    const passing = passEl ? parseFloat(passEl.value) : 60;
    await API.createExam({
      title, description: desc,
      duration_mins: parseInt(document.getElementById('ce-duration').value) || 60,
      scheduled_at: document.getElementById('ce-scheduled').value,
      passing_score: Number.isFinite(passing) ? passing : 60,
      questions: [],
    });
    document.getElementById('createExamModal').classList.remove('active');
    showToast(' Examination created!', 'success');
    loadAdminExams();
  } catch(err) { 
    showToast(err.message || 'Error creating exam', 'error'); 
  }
}
window.submitCreateExam = submitCreateExam;

function openEditExam(id) {
  const e = allExamsAdmin.find(x => x.id === id);
  if (!e) return;
  document.getElementById('ee-id').value = e.id;
  document.getElementById('ee-title').value = e.title || '';
  document.getElementById('ee-duration').value = e.duration_mins || 60;
  const raw = e.scheduled_at || '';
  document.getElementById('ee-scheduled').value = raw ? String(raw).replace(' ', 'T').slice(0, 16) : '';
  const pe = document.getElementById('ee-passing');
  if (pe) pe.value = e.passing_score != null ? e.passing_score : 60;
  document.getElementById('editExamModal').classList.add('active');
}
window.openEditExam = openEditExam;

async function submitEditExam() {
  const id    = document.getElementById('ee-id').value;
  const title = document.getElementById('ee-title').value.trim();
  if (!title) { showToast('Title required', 'error'); return; }
  try {
    const passEl = document.getElementById('ee-passing');
    const passing = passEl ? parseFloat(passEl.value) : null;
    await API.updateExam(id, {
      title,
      duration_mins: parseInt(document.getElementById('ee-duration').value) || 60,
      scheduled_at: document.getElementById('ee-scheduled').value,
      passing_score: Number.isFinite(passing) ? passing : 60,
    });
    document.getElementById('editExamModal').classList.remove('active');
    showToast(' Examination updated!', 'success');
    loadAdminExams();
  } catch(e) { showToast('Error updating exam', 'error'); }
}
window.submitEditExam = submitEditExam;

async function publishExamSet(id, active) {
  try {
    const res = await API.publishExam(id, active);
    showToast(' ' + res.message, res.is_active ? 'success' : 'gold');
    loadAdminExams();
  } catch (e) {
    showToast(e.message || 'Error updating exam status', 'error');
  }
}
window.publishExamSet = publishExamSet;

async function deactivateExam(id) {
  if (!confirm('Are you sure you want to deactivate this examination?')) return;
  try {
    await API.deleteExam(id);
    showToast('Examination deactivated', 'success');
    loadAdminExams();
  } catch(e) { showToast('Error deactivating exam', 'error'); }
}
window.deactivateExam = deactivateExam;

// ── QUESTION BUILDER ──────────────────────────
let currentQBExamId = null;

function openQuestionBuilder(examId, examTitle) {
  currentQBExamId = examId;
  document.getElementById('qb-exam-id').value = examId;
  document.getElementById('qb-exam-title').textContent = examTitle || 'Exam';
  // Clear form
  document.getElementById('qb-question').value = '';
  document.getElementById('qb-opt-a').value = '';
  document.getElementById('qb-opt-b').value = '';
  document.getElementById('qb-opt-c').value = '';
  document.getElementById('qb-opt-d').value = '';
  document.querySelector('input[name="qb-correct"][value="0"]').checked = true;
  document.getElementById('questionBuilderModal').classList.add('active');
  loadExamQuestions(examId);
}
window.openQuestionBuilder = openQuestionBuilder;

function closeQuestionBuilder() {
  document.getElementById('questionBuilderModal').classList.remove('active');
  currentQBExamId = null;
  loadAdminExams(); // refresh so question count updates
}
window.closeQuestionBuilder = closeQuestionBuilder;

async function loadExamQuestions(examId) {
  const container = document.getElementById('qb-question-list');
  container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:var(--space-4);">Loading…</div>';
  try {
    const questions = await API.getExamQuestions(examId);
    if (!questions.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:var(--space-6);">No questions yet. Add one below.</div>';
      return;
    }
    const labels = ['A','B','C','D'];
    const colors = ['#1a6b3c','#1d6fa4','#c0392b','#8e44ad'];
    container.innerHTML = questions.map((q, i) => `
      <div style="background:white;border:1px solid var(--light-200);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-3);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-3);">
          <div style="font-weight:700;font-size:0.9rem;"><span style="color:var(--text-muted);margin-right:8px;">Q${i+1}.</span>${q.question}</div>
          <button onclick="deleteQuestion(${q.id})" style="background:rgba(192,57,43,0.1);color:#c0392b;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.78rem;flex-shrink:0;margin-left:8px;">Delete</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${['option_a','option_b','option_c','option_d'].filter((_,idx) => q[_]).map((opt, idx) => `
            <div style="padding:6px 10px;border-radius:6px;font-size:0.82rem;
              background:${q.correct_idx === idx ? 'rgba(26,107,60,0.1)' : 'var(--light-50)'};
              border:1.5px solid ${q.correct_idx === idx ? '#1a6b3c' : 'var(--light-200)'};
              color:${q.correct_idx === idx ? '#1a6b3c' : 'inherit'};
              font-weight:${q.correct_idx === idx ? '700' : '400'};">
              <strong>${labels[idx]}.</strong> ${q[opt]}
              ${q.correct_idx === idx ? ' <span style="font-size:0.7rem;">✓ Correct</span>' : ''}
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch(err) {
    container.innerHTML = `<div style="color:red;text-align:center;">${err.message}</div>`;
  }
}
window.loadExamQuestions = loadExamQuestions;

async function saveNewQuestion() {
  const eid  = document.getElementById('qb-exam-id').value;
  const q    = document.getElementById('qb-question').value.trim();
  const a    = document.getElementById('qb-opt-a').value.trim();
  const b    = document.getElementById('qb-opt-b').value.trim();
  const c    = document.getElementById('qb-opt-c').value.trim();
  const d    = document.getElementById('qb-opt-d').value.trim();
  const correct = parseInt(document.querySelector('input[name="qb-correct"]:checked')?.value || '0');

  if (!q || !a || !b || !c) { showToast('Question, A, B and C are required', 'error'); return; }

  try {
    await API.addExamQuestion(eid, { question: q, option_a: a, option_b: b, option_c: c, option_d: d, correct_idx: correct });
    // Clear form
    document.getElementById('qb-question').value = '';
    document.getElementById('qb-opt-a').value = '';
    document.getElementById('qb-opt-b').value = '';
    document.getElementById('qb-opt-c').value = '';
    document.getElementById('qb-opt-d').value = '';
    document.querySelector('input[name="qb-correct"][value="0"]').checked = true;
    showToast(' Question added!', 'success');
    loadExamQuestions(eid);
  } catch(err) {
    showToast(err.message || 'Failed to add question', 'error');
  }
}
window.saveNewQuestion = saveNewQuestion;

async function deleteQuestion(qid) {
  if (!confirm('Delete this question?')) return;
  try {
    await API.deleteExamQuestion(qid);
    showToast('Question deleted', 'gold');
    loadExamQuestions(currentQBExamId);
  } catch(err) {
    showToast(err.message || 'Failed to delete question', 'error');
  }
}
window.deleteQuestion = deleteQuestion;

// ── SUBMISSIONS MODAL ─────────────────────
let currentSubExamId = null;

async function openSubmissionsModal(examId) {
  currentSubExamId = examId;
  document.getElementById('submissionsModal').classList.add('active');
  document.getElementById('sub-exam-title').textContent = 'Loading…';
  document.getElementById('sub-tbody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">Loading…</td></tr>';
  await loadExamSubmissions(examId);
}
window.openSubmissionsModal = openSubmissionsModal;

async function loadExamSubmissions(examId) {
  try {
    const data = await API.getExamSubmissions(examId);
    document.getElementById('sub-exam-title').textContent = data.exam_title;

    // Release bar
    const bar = document.getElementById('sub-release-bar');
    const released = data.results_released;
    bar.style.background = released ? 'rgba(26,107,60,0.08)' : 'rgba(192,57,43,0.08)';
    bar.style.border = `1.5px solid ${released ? '#1a6b3c' : '#c0392b'}30`;
    bar.innerHTML = `
      <div>
        <span style="font-weight:700;color:${released ? '#1a6b3c' : '#c0392b'};">
          ${released ? '🟢 Results Released to Students' : '🔴 Results Hidden from Students'}
        </span>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
          ${released ? 'Students can now see their scores.' : 'Click to release when ready.'}
        </div>
      </div>
      <button class="btn ${released ? 'btn-ghost' : 'btn-primary'}" onclick="releaseExamResultsToggle(${examId})" style="flex-shrink:0;">
        ${released ? ' Hide Results' : '🚀 Release Results'}
      </button>`;

    // Submissions tbody
    const tbody = document.getElementById('sub-tbody');
    if (!data.submissions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No submissions yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.submissions.map((s, i) => {
      const score = s.score !== null ? s.score : '';
      const passed = s.score !== null ? (s.score >= 60 ? '<span class="badge status-approved"> Pass</span>' : '<span class="badge status-rejected"> Fail</span>') : '<span class="badge badge-gray"></span>';
      return `<tr>
        <td style="font-weight:700;color:var(--text-muted);">${i+1}</td>
        <td><div class="table-primary">${s.student_name}</div></td>
        <td style="font-family:monospace;font-size:0.78rem;">${s.student_id||''}</td>
        <td style="font-size:0.8rem;">${s.university||''}</td>
        <td><strong style="font-size:1rem;color:${s.score>=60?'#1a6b3c':'#c0392b'}">${score}%</strong></td>
        <td>${passed}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${formatDate(s.submitted_at)}</td>
      </tr>`;
    }).join('');
  } catch(err) {
    document.getElementById('sub-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;">${err.message}</td></tr>`;
  }
}
window.loadExamSubmissions = loadExamSubmissions;

async function releaseExamResultsToggle(examId) {
  try {
    const res = await API.releaseExamResults(examId);
    showToast(res.message, res.results_released ? 'success' : 'gold');
    loadExamSubmissions(examId);
    loadAdminExams();
  } catch(err) {
    showToast(err.message || 'Failed to toggle result release', 'error');
  }
}
// ── NEWS & EVENTS ──────────────────────────────
function openCreateNewsModal() {
  document.getElementById('newsForm').reset();
  document.getElementById('createNewsModal').classList.add('active');
}
window.openCreateNewsModal = openCreateNewsModal;

async function submitCreateNews(e) {
  e.preventDefault();
  const formData = new FormData();
  formData.append('title', document.getElementById('cn-title').value);
  formData.append('category', document.getElementById('cn-category').value);
  formData.append('excerpt', document.getElementById('cn-excerpt').value);
  formData.append('content', document.getElementById('cn-content').value);
  formData.append('is_featured', document.getElementById('cn-featured').checked ? '1' : '0');
  
  const fileInput = document.getElementById('cn-image');
  if (fileInput.files.length > 0) {
    formData.append('image', fileInput.files[0]);
  }
  
  try {
    await API.request('/admin/news', { method: 'POST', body: formData, isMultipart: true });
    showToast('News published safely!', 'success');
    document.getElementById('createNewsModal').classList.remove('active');
    loadAdminNews();
  } catch(err) {
    showToast(err.message, 'error');
  }
}
window.submitCreateNews = submitCreateNews;

async function loadAdminNews() {
  const tbody = document.getElementById('newsTbody');
  try {
    const news = await API.request('/admin/news');
    if (!news.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">No news published yet.</td></tr>';
      return;
    }
    tbody.innerHTML = news.map(n => `
      <tr>
        <td>${n.image_path ? `<img src="/uploads/news/${n.image_path}" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover;">` : ''}</td>
        <td><span class="badge" style="background:var(--light-100);color:var(--text-muted);">${n.category}</span></td>
        <td style="font-weight:700;">${n.title}</td>
        <td style="font-size:0.8rem;color:var(--text-muted);">${new Date(n.created_at).toLocaleDateString()}</td>
        <td>${n.is_featured ? '<span class="badge" style="background:#fef08a;color:#854d0e;"> Featured</span>' : 'Standard'}</td>
        <td><button class="btn btn-ghost btn-sm" style="color:#ef4444;" onclick="deleteNews(${n.id})">🗑</button></td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">Failed to get news</td></tr>`;
  }
}
window.loadAdminNews = loadAdminNews;

async function deleteNews(id) {
  if(!confirm("Are you sure you want to delete this news update?")) return;
  try {
    await API.request(`/admin/news/${id}`, { method: 'DELETE' });
    showToast('Deleted item.', 'info');
    loadAdminNews();
  } catch(err) {
    showToast(err.message, 'error');
  }
}
window.deleteNews = deleteNews;

// ── LEADERSHIP PROFILES ──────────────────────
async function submitAddLeadership(e) {
  e.preventDefault();
  const form = new FormData();
  form.append('name', document.getElementById('cl-name').value);
  form.append('position', document.getElementById('cl-position').value);
  form.append('hierarchy', document.getElementById('cl-hierarchy').value);
  form.append('order_num', document.getElementById('cl-order').value);
  form.append('bio', document.getElementById('cl-bio').value);
  if (document.getElementById('cl-photo').files.length > 0) {
    form.append('profile_photo', document.getElementById('cl-photo').files[0]);
  }
  
  try {
    await API.request('/admin/leadership/appointed', { method: 'POST', body: form, isMultipart: true });
    showToast('Leadership profile active!', 'success');
    document.getElementById('addLeadershipModal').classList.remove('active');
    document.getElementById('leadershipForm').reset();
    loadAppointedLeadership();
  } catch(err) {
    showToast(err.message, 'error');
  }
}
window.submitAddLeadership = submitAddLeadership;

async function loadAppointedLeadership() {
  const tbody = document.getElementById('appointedLeadershipTbody');
  try {
    const list = await API.request('/admin/leadership/appointed');
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">No appointed members yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(m => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:12px;">
            ${m.profile_photo ? `<img src="/uploads/appointees/${m.profile_photo}" style="width:36px;height:36px;border-radius:var(--radius-full);object-fit:cover;">` : `<div style="width:36px;height:36px;background:var(--light-200);border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;font-size:0.8rem;color:var(--text-muted);">NA</div>`}
            <div><div style="font-weight:700;">${m.name}</div></div>
          </div>
        </td>
        <td style="font-weight:600;color:var(--epsa-green);">${m.position}</td>
        <td><span class="badge" style="background:var(--light-100);">${m.hierarchy}</span></td>
        <td><button class="btn btn-ghost btn-sm" style="color:#ef4444;" onclick="deleteAppointedLeadership(${m.id})">🗑 Delete</button></td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;">Error fetching leadership</td></tr>`;
  }
}
window.loadAppointedLeadership = loadAppointedLeadership;

async function deleteAppointedLeadership(id) {
  if(!confirm("Remove this appointed member?")) return;
  try {
    await API.request(`/admin/leadership/appointed/${id}`, { method: 'DELETE' });
    showToast('Profile removed.', 'info');
    loadAppointedLeadership();
  } catch(err) {
    showToast(err.message, 'error');
  }
}
window.deleteAppointedLeadership = deleteAppointedLeadership;

// Override switchAdminSection locally just to auto-fetch
const originalSwitchAdminSection = window.switchAdminSection;
window.switchAdminSection = function(section) {
  if(originalSwitchAdminSection) originalSwitchAdminSection(section);
  if(section === 'news') loadAdminNews();
  if(section === 'voting') loadAppointedLeadership();
};
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function adminLogout() {
  API.clearToken();
  window.location.href = '../login.html';
}
window.adminLogout = adminLogout;

function ensureVotingWorkspaceShell() {
  const tabsBar = document.querySelector('#asec-voting > div[style*="width:fit-content"]');
  if (tabsBar && !document.getElementById('vtab-executive')) {
    const nebTab = document.getElementById('vtab-neb');
    nebTab?.insertAdjacentHTML('beforebegin', `
      <button class="voting-admin-tab" id="vtab-executive" onclick="switchVotingTab('executive')">Executive Governance</button>
      <button class="voting-admin-tab" id="vtab-nrc" onclick="switchVotingTab('nrc')">NRC Management</button>
    `);
  }

  const controlPanel = document.getElementById('vpanel-control');
  if (controlPanel && !document.getElementById('votingLifecycleBoard')) {
    controlPanel.insertAdjacentHTML('afterbegin', `
      <div id="votingLifecycleBoard" class="governance-launchpad">
        <div class="governance-loading">Loading election control workspace…</div>
      </div>
    `);
  }

  const nebPanel = document.getElementById('vpanel-neb');
  if (nebPanel && !document.getElementById('vpanel-executive')) {
    nebPanel.insertAdjacentHTML('beforebegin', `
      <div id="vpanel-executive" class="voting-admin-panel" style="display:none;">
        <div style="margin-bottom:var(--space-5);">
          <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.25rem;">Executive Governance Workspace</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Form the executive committee from election results, manage roles, vacancies, handovers, and governance decisions without leaving the voting system.</p>
        </div>
      </div>
      <div id="vpanel-nrc" class="voting-admin-panel" style="display:none;">
        <div style="margin-bottom:var(--space-5);">
          <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.25rem;">NRC Management Workspace</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Sync university winners into the NRC, manage replacements, and supervise representative accountability from the election workspace.</p>
        </div>
      </div>
    `);
  }

  const executivePanel = document.getElementById('vpanel-executive');
  if (executivePanel) {
    const oldSection = document.getElementById('asec-executive');
    const oldRoot = document.getElementById('executiveDashboardRoot') || oldSection?.querySelector('#executiveDashboardRoot');
    if (oldRoot && oldRoot.parentElement !== executivePanel) {
      executivePanel.appendChild(oldRoot);
    } else if (!oldRoot) {
      executivePanel.insertAdjacentHTML('beforeend', `
        <div id="executiveDashboardRoot">
          <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading executive governance workspace…</div>
        </div>
      `);
    }
  }

  const nrcPanel = document.getElementById('vpanel-nrc');
  if (nrcPanel) {
    const oldSection = document.getElementById('asec-nrc');
    const oldRoot = document.getElementById('nrcDashboardRoot') || oldSection?.querySelector('#nrcDashboardRoot');
    if (oldRoot && oldRoot.parentElement !== nrcPanel) {
      nrcPanel.appendChild(oldRoot);
    } else if (!oldRoot) {
      nrcPanel.insertAdjacentHTML('beforeend', `
        <div id="nrcDashboardRoot">
          <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading NRC management workspace…</div>
        </div>
      `);
    }
  }
}

function ensureExamMonitoringShell() {
  const modal = document.getElementById('submissionsModal');
  if (!modal || modal.dataset.enhanced === '1') return;
  const bodyContainer = modal.querySelector('div[style*="overflow-y:auto"]');
  const closeBtn = modal.querySelector('button.btn.btn-ghost');
  if (closeBtn) closeBtn.setAttribute('onclick', 'closeSubmissionsModal()');
  if (bodyContainer) {
    bodyContainer.innerHTML = `
      <div id="sub-summary-grid" class="exam-monitor-grid">
        <div class="governance-loading">Loading exam summary…</div>
      </div>
      <div class="exam-monitor-layout">
        <div class="exam-monitor-main">
          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Live Student Activity</div>
              <div class="exam-monitor-caption">This feed updates while students are inside the exam.</div>
            </div>
            <div id="sub-live-feed" class="exam-live-feed">
              <div class="governance-loading">Waiting for live exam activity…</div>
            </div>
          </div>

          <div class="data-table-card">
            <div class="table-header">
              <div class="table-title">Student Attempts</div>
              <div class="exam-monitor-caption">Scores stay private to students until you release results.</div>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table">
                <thead><tr><th>#</th><th>Student</th><th>Status</th><th>Progress</th><th>Score</th><th>Review</th><th>Last Activity</th><th>Submitted</th></tr></thead>
                <tbody id="sub-tbody"><tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">Loading…</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Question-by-Question Analysis</div>
              <div class="exam-monitor-caption">Spot weak questions, answer distribution, and correctness trends instantly.</div>
            </div>
            <div id="sub-question-grid" class="exam-question-grid">
              <div class="governance-loading">Building question analytics…</div>
            </div>
          </div>
        </div>

        <div class="exam-monitor-side">
          <div class="glass-inline-card exam-monitor-card">
            <div class="exam-monitor-header">
              <div class="table-title">Student Detail</div>
              <div class="exam-monitor-caption">Select a row to inspect that student’s attempt.</div>
            </div>
            <div id="sub-detail-panel" class="exam-detail-panel">
              <div class="governance-loading">Choose a student attempt to view detailed analysis.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  modal.dataset.enhanced = '1';
}

function closeSubmissionsModal() {
  clearInterval(_examSubmissionPoller);
  _examSubmissionPoller = null;
  document.getElementById('submissionsModal')?.classList.remove('active');
}
window.closeSubmissionsModal = closeSubmissionsModal;

function formatExamTimestamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeActivity(value) {
  if (!value) return 'No recent activity';
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60000) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day ago`;
}

function examStatusBadge(status) {
  const normalized = String(status || 'in_progress').toLowerCase();
  const tone = normalized === 'submitted' ? 'green' : normalized === 'reviewed' ? 'blue' : 'gold';
  const label = normalized === 'submitted' ? 'Submitted' : normalized === 'reviewed' ? 'Reviewed' : 'Live';
  return `<span class="soft-badge ${tone}">${label}</span>`;
}

function examReviewBadge(status) {
  return String(status || 'pending').toLowerCase() === 'approved'
    ? `<span class="soft-badge green">Approved</span>`
    : `<span class="soft-badge gold">Pending</span>`;
}

function selectExamSubmission(submissionId) {
  _currentExamSubmissionId = submissionId;
  document.querySelectorAll('#sub-tbody tr[data-submission-id]').forEach(row => {
    row.classList.toggle('selected-row', Number(row.dataset.submissionId) === Number(submissionId));
  });
  renderExamSubmissionDetail();
}
window.selectExamSubmission = selectExamSubmission;

function renderExamSubmissionDetail() {
  const panel = document.getElementById('sub-detail-panel');
  if (!panel) return;
  const submissions = _currentExamSubmissionData?.submissions || [];
  const selected = submissions.find(item => Number(item.id) === Number(_currentExamSubmissionId)) || submissions[0];
  if (!selected) {
    panel.innerHTML = '<div class="governance-loading">Choose a student attempt to view detailed analysis.</div>';
    return;
  }
  _currentExamSubmissionId = selected.id;
  const totalQuestions = _currentExamSubmissionData?.question_count || selected.answers_breakdown?.length || 0;
  panel.innerHTML = `
    <div class="exam-detail-hero">
      <div>
        <div class="exam-detail-name">${adminEsc(selected.student_name)}</div>
        <div class="exam-detail-meta">${adminEsc(selected.student_id || 'No student ID')} • ${adminEsc(selected.university || 'University not set')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        ${examStatusBadge(selected.status)}
        ${examReviewBadge(selected.review_status)}
      </div>
    </div>
    <div class="exam-detail-stats">
      <div class="admin-detail-card"><div class="exam-detail-label">Score</div><div class="exam-detail-value">${selected.score ?? ''}${selected.score !== null ? '%' : ''}</div></div>
      <div class="admin-detail-card"><div class="exam-detail-label">Correct</div><div class="exam-detail-value">${selected.correct_count}/${totalQuestions}</div></div>
      <div class="admin-detail-card"><div class="exam-detail-label">Progress</div><div class="exam-detail-value">${selected.progress_count}/${totalQuestions}</div></div>
      <div class="admin-detail-card"><div class="exam-detail-label">Duration</div><div class="exam-detail-value">${selected.duration_mins != null ? `${selected.duration_mins} min` : ''}</div></div>
    </div>
    <div class="exam-detail-meta-grid">
      <div><strong>Started:</strong> ${formatExamTimestamp(selected.started_at)}</div>
      <div><strong>Last activity:</strong> ${formatRelativeActivity(selected.last_activity_at)}</div>
      <div><strong>Submitted:</strong> ${formatExamTimestamp(selected.submitted_at)}</div>
      <div><strong>Review status:</strong> ${selected.review_status === 'approved' ? 'Released to students' : 'Still hidden from students'}</div>
    </div>
    <div class="exam-answer-list">
      ${(selected.answers_breakdown || []).map((item, index) => `
        <div class="exam-answer-item ${item.is_correct ? 'correct' : 'incorrect'}">
          <div class="exam-answer-head">
            <strong>Q${index + 1}</strong>
            <span>${item.is_correct ? 'Correct' : (item.selected_option === '' ? 'Unanswered' : 'Needs review')}</span>
          </div>
          <div class="exam-answer-question">${adminEsc(item.question)}</div>
          <div class="exam-answer-meta">Student: ${adminEsc(item.selected_option)} ${item.selected_text ? `• ${adminEsc(item.selected_text)}` : ''}</div>
          <div class="exam-answer-meta">Correct: ${adminEsc(item.correct_option)} ${item.correct_text ? `• ${adminEsc(item.correct_text)}` : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderExamSummary(data) {
  const summaryRoot = document.getElementById('sub-summary-grid');
  if (!summaryRoot) return;
  const summary = data.summary || {};
  summaryRoot.innerHTML = `
    <div class="admin-detail-card"><div class="exam-detail-label">Exam Duration</div><div class="exam-detail-value">${data.duration_mins || 0} min</div><div class="exam-monitor-caption">${data.question_count || 0} questions</div></div>
    <div class="admin-detail-card"><div class="exam-detail-label">Live Attempts</div><div class="exam-detail-value">${summary.in_progress_count || 0}</div><div class="exam-monitor-caption">Students currently taking the exam</div></div>
    <div class="admin-detail-card"><div class="exam-detail-label">Submitted</div><div class="exam-detail-value">${summary.submitted_count || 0}</div><div class="exam-monitor-caption">Completed student attempts</div></div>
    <div class="admin-detail-card"><div class="exam-detail-label">Average Score</div><div class="exam-detail-value">${summary.average_score || 0}%</div><div class="exam-monitor-caption">Admin-only until release</div></div>
    <div class="admin-detail-card"><div class="exam-detail-label">Pass Rate</div><div class="exam-detail-value">${summary.pass_rate || 0}%</div><div class="exam-monitor-caption">Based on submitted attempts</div></div>
  `;
}

function renderExamLiveFeed(data) {
  const liveRoot = document.getElementById('sub-live-feed');
  if (!liveRoot) return;
  const active = (data.submissions || []).filter(item => item.status === 'in_progress' && !item.submitted_at);
  if (!active.length) {
    liveRoot.innerHTML = '<div class="governance-loading">No students are actively taking this exam right now.</div>';
    return;
  }
  liveRoot.innerHTML = active.map(item => `
    <button class="exam-live-card" onclick="selectExamSubmission(${item.id})">
      <div>
        <div class="exam-live-name">${adminEsc(item.student_name)}</div>
        <div class="exam-live-meta">${adminEsc(item.university || 'University')} • ${adminEsc(item.student_id || 'No ID')}</div>
      </div>
      <div style="text-align:right;">
        <div class="exam-live-progress">${item.progress_count}/${data.question_count}</div>
        <div class="exam-live-meta">${formatRelativeActivity(item.last_activity_at)}</div>
      </div>
    </button>
  `).join('');
}

function renderExamQuestionBreakdown(data) {
  const grid = document.getElementById('sub-question-grid');
  if (!grid) return;
  const questions = data.question_breakdown || [];
  if (!questions.length) {
    grid.innerHTML = '<div class="governance-loading">Question analytics will appear once the exam has questions.</div>';
    return;
  }
  grid.innerHTML = questions.map((question, index) => {
    const maxCount = Math.max(...question.options.map(option => option.count || 0), 1);
    return `
      <div class="exam-question-card">
        <div class="exam-question-title">Q${index + 1}. ${adminEsc(question.question)}</div>
        <div class="exam-question-meta">
          <span>Correct option: ${adminEsc(question.correct_option)}</span>
          <span>${question.correct_rate || 0}% correct</span>
          <span>${question.answered_count || 0} responses</span>
        </div>
        <div class="exam-option-bars">
          ${question.options.map(option => `
            <div class="exam-option-row">
              <span class="exam-option-label">${adminEsc(option.label)}</span>
              <div class="exam-option-track"><div class="exam-option-fill" style="width:${Math.round(((option.count || 0) / maxCount) * 100)}%;"></div></div>
              <span class="exam-option-count">${option.count || 0}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

async function openSubmissionsModal(examId) {
  ensureExamMonitoringShell();
  clearInterval(_examSubmissionPoller);
  currentSubExamId = examId;
  _currentExamSubmissionId = null;
  document.getElementById('submissionsModal').classList.add('active');
  document.getElementById('sub-exam-title').textContent = 'Loading…';
  document.getElementById('sub-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:var(--space-6);">Loading…</td></tr>';
  await loadExamSubmissions(examId);
  _examSubmissionPoller = setInterval(() => {
    if (document.getElementById('submissionsModal')?.classList.contains('active')) {
      loadExamSubmissions(examId);
    }
  }, 12000);
}
window.openSubmissionsModal = openSubmissionsModal;

async function loadExamSubmissions(examId) {
  try {
    ensureExamMonitoringShell();
    const data = await API.getExamSubmissions(examId);
    _currentExamSubmissionData = data;
    document.getElementById('sub-exam-title').textContent = data.exam_title;

    const bar = document.getElementById('sub-release-bar');
    const released = data.results_released;
    bar.style.background = released ? 'rgba(26,107,60,0.08)' : 'rgba(192,57,43,0.08)';
    bar.style.border = `1.5px solid ${released ? '#1a6b3c' : '#c0392b'}30`;
    bar.innerHTML = `
      <div>
        <span style="font-weight:700;color:${released ? '#1a6b3c' : '#c0392b'};">
          ${released ? '🟢 Results Released to Students' : '🔴 Results Hidden from Students'}
        </span>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
          ${released ? 'Students can now see their scores and completion outcome.' : 'Students remain blocked from scores until you approve and release them.'}
        </div>
      </div>
      <button class="btn ${released ? 'btn-ghost' : 'btn-primary'}" onclick="releaseExamResultsToggle(${examId})" style="flex-shrink:0;">
        ${released ? 'Hide Results' : 'Approve & Release'}
      </button>`;

    renderExamSummary(data);
    renderExamLiveFeed(data);
    renderExamQuestionBreakdown(data);

    const tbody = document.getElementById('sub-tbody');
    if (!data.submissions.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:var(--space-8);">No submissions yet.</td></tr>';
      document.getElementById('sub-detail-panel').innerHTML = '<div class="governance-loading">Student detail will appear here after the first attempt starts.</div>';
      return;
    }

    if (!_currentExamSubmissionId) {
      _currentExamSubmissionId = data.submissions[0].id;
    }

    tbody.innerHTML = data.submissions.map((s, i) => {
      const scoreTone = s.score !== null && s.score >= 60 ? '#1a6b3c' : '#c0392b';
      const score = s.score !== null ? `${s.score}%` : '';
      return `<tr data-submission-id="${s.id}" onclick="selectExamSubmission(${s.id})">
        <td style="font-weight:700;color:var(--text-muted);">${i+1}</td>
        <td><div class="table-primary">${adminEsc(s.student_name)}</div><div class="table-secondary">${adminEsc(s.student_id || 'No ID')}</div></td>
        <td>${examStatusBadge(s.status)}</td>
        <td><strong>${s.progress_count}/${data.question_count}</strong><div class="table-secondary">${s.progress_pct || 0}% complete</div></td>
        <td><strong style="font-size:1rem;color:${s.score !== null ? scoreTone : 'var(--text-muted)'}">${score}</strong></td>
        <td>${examReviewBadge(s.review_status)}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${formatRelativeActivity(s.last_activity_at)}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${formatExamTimestamp(s.submitted_at)}</td>
      </tr>`;
    }).join('');
    selectExamSubmission(_currentExamSubmissionId);
  } catch(err) {
    document.getElementById('sub-tbody').innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;">${err.message}</td></tr>`;
  }
}
window.loadExamSubmissions = loadExamSubmissions;

const previousAdminSectionSwitch = window.switchAdminSection;
window.switchAdminSection = function(section) {
  if (typeof previousAdminSectionSwitch === 'function') previousAdminSectionSwitch(section);
  if (section === 'voting') {
    ensureVotingWorkspaceShell();
  }
};

// --- Telegram Broadcast ---
async function broadcastToTelegram() {
  const textarea = document.getElementById('telegramBroadcastMessage');
  if (!textarea) return;
  const message = textarea.value.trim();
  
  if (!message) {
    showToast('Please enter a message to broadcast.', 'error');
    return;
  }
  
  if (!confirm('Are you sure you want to broadcast this message to the entire Telegram channel?')) {
    return;
  }
  
  try {
    const btn = event.target;
    const oldText = btn.innerHTML;
    btn.innerHTML = '⏳ Sending...';
    btn.disabled = true;
    
    const res = await fetch(API._apiBase + '/admin/telegram/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API.getToken()
      },
      body: JSON.stringify({ message: message })
    });
    
    const data = await res.json();
    btn.innerHTML = oldText;
    btn.disabled = false;
    
    if (res.ok) {
      showToast('Broadcast sent successfully!', 'success');
      textarea.value = '';
    } else {
      showToast(data.error || 'Failed to send broadcast.', 'error');
    }
  } catch (e) {
    console.error(e);
    showToast('Network error while broadcasting.', 'error');
    const btn = event.target;
    if (btn) {
      btn.innerHTML = '🚀 Send to Channel';
      btn.disabled = false;
    }
  }
}
window.broadcastToTelegram = broadcastToTelegram;



