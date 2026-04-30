// ════════════════════════════════════════════════
// EPSA STUDENT DASHBOARD — Main Controller
// ════════════════════════════════════════════════

let currentSection = 'overview';
let currentUser    = null;
let allStudents    = [];
let allTrainings   = [];
let selectedTrainingId = null;

function relocateDynamicDashboardSections() {
  const content = document.querySelector('.dash-content');
  if (!content) return;
  document.querySelectorAll('.dash-section[id^="section-"]').forEach((section) => {
    if (section.parentElement !== content) {
      content.appendChild(section);
    }
  });
}

function dashboardSectionTarget(section) {
  return document.getElementById(`sec-${section}`) || document.getElementById(`section-${section}`);
}

document.addEventListener('DOMContentLoaded', async () => {
  relocateDynamicDashboardSections();
  // Strict check: BOTH a token AND a cached user must exist.
  // getUser()-only means the token was cleared but user data wasn't — force re-login.
  const hasToken = !!API.getToken();
  const hasUser  = !!API.getUser();
  if (!hasToken || !hasUser) {
    API.clearToken(); // clean up any stale user data
    window.location.href = 'login.html';
    return;
  }
  currentUser = API.getUser();

  // Role guard — teachers have their own portal
  const role = currentUser.role;
  if (role === 'teacher') { window.location.href = 'teacher.html'; return; }
  if (role === 'admin' || role === 'super_admin') { window.location.href = 'admin/dashboard.html'; return; }
  populateUserUI(currentUser);
  await Promise.allSettled([loadProfile(), loadTrainings(), loadNetworkStudents(), loadConversations(), loadExams(), loadVoting()]);
  if (typeof loadEnhancedNetworking === 'function') {
    try { await loadEnhancedNetworking(); } catch (_) { /* optional */ }
  }
});

function populateUserUI(user) {
  const name = `${user.first_name || user.name || 'Student'} ${user.father_name || ''}`.trim();
  const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  s('welcomeName', user.first_name || user.name || 'Student');
  s('sidebarName', name);
  s('sidebarUni',  user.university || 'EPSA Member');
  s('profileFullName', name);
  s('pi-uni',    user.university    || '—');
  s('pi-program', user.program_type || '—');
  s('pi-year',   user.academic_year || '—');
  s('pi-field',  user.field_of_study|| '—');
  s('pi-id',     user.student_id    || `EPSA-${Date.now().toString().slice(-6)}`);
  s('pi-phone',  user.phone         || '—');
  s('pi-email',  user.email         || '—');
  s('profileUni', user.university   || '—');
  s('profileYear', user.academic_year ? `Year ${user.academic_year}` : '—');
  s('profileEmail', user.email       || '—');
  if (user.profile_photo) {
    const pUrl = API.resolveUploadUrl('profiles', user.profile_photo);
    const avatars = [document.getElementById('sidebarAvatar'), document.getElementById('profileAvatarImg')];
    avatars.forEach(img => {
      if (!img) return;
      // Prevent flicker by not re-assigning if already loaded or failed
      if (img.dataset.currentSrc === pUrl || img.dataset.currentSrc === 'error') return;
      
      img.src = pUrl;
      img.dataset.currentSrc = pUrl;
      
      img.onerror = () => {
        img.dataset.currentSrc = 'error';
        img.src = 'assets/president.jpg'; // Fallback to default
        img.onerror = null;
      };
    });
  }
}

function switchSection(section) {
  // Hide all sections — covers both sec-* and section-* IDs
  document.querySelectorAll('.dash-section').forEach(s => s.style.display = 'none');
  // Support both naming conventions
  const target = dashboardSectionTarget(section);
  if (target) target.style.display = 'block';
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.toggle('active', l.dataset.section === section));
  const titles = {
    overview:'Overview', profile:'My Profile', trainings:'Training Programs',
    voting:'Election & Voting', clubs:'Clubs & Associations',
    networking:'Student Network', messaging:'Messages',
    exams:'Examinations', 'mock-exams':'Mock Examinations',
  };
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = titles[section] || section;
  currentSection = section;
  if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.remove('open');

  if (section === 'clubs' && typeof loadMyClubs === 'function') loadMyClubs();
  if (section === 'exams' && typeof loadExams === 'function') loadExams();
  if (section === 'mock-exams' && typeof loadMockExams === 'function') loadMockExams();
  if (section === 'networking') {
    if (typeof loadEnhancedNetworking === 'function') {
      loadEnhancedNetworking();
    } else {
      loadFeed(true);
      loadSuggestedConnections();
      loadFeedClubsWidget();
    }
  }
}
window.switchSection = switchSection;

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
window.toggleSidebar = toggleSidebar;

async function loadProfile() {
  try {
    const data = await API.getProfile();
    currentUser = { ...currentUser, ...data };
    API.setUser(currentUser);
    populateUserUI(currentUser);
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('ws-trainings',   data.training_count   || 0);
    s('ws-connections', data.connection_count || 0);
    s('ws-exams',       data.exam_count       || 0);
    s('ps-trainings',   data.training_count   || 0);
    s('ps-certs',       data.cert_count       || 0);
    s('ps-connections', data.connection_count || 0);
    s('ps-exams',       data.exam_count       || 0);
  } catch (err) {
    showToast('Failed to load profile data', 'error');
  }
}

async function loadTrainings() {
  try {
    allTrainings = await API.getTrainings();
    renderTrainings(allTrainings);
  } catch(err) {
    const grid = document.getElementById('trainingGrid');
    if (grid) grid.innerHTML = `<div style="text-align:center;color:red;grid-column:1/-1;">Error loading trainings</div>`;
  }
}

function renderTrainings(trainings) {
  const grid = document.getElementById('trainingGrid');
  if (!grid) return;
  const statusMap = {
    open:       { label:'Apply Now',          btn:'btn-primary',      action:'applyTraining' },
    applied:    { label:'Upload Receipt',      btn:'btn-outline-green', action:'openPaymentModal' },
    receipt:    { label:'Receipt Submitted',   btn:'btn-ghost',        action:'' },
    verified:   { label:'✅ Verified',         btn:'btn-ghost',        action:'' },
    registered: { label:'📖 Enter Training',  btn:'btn-gold',         action:'enterTraining' },
  };
  const flowSteps   = ['Apply','Pending','Verified','Registered'];
  const flowIndexes = { open:0, applied:1, receipt:1, verified:2, registered:3 };

  grid.innerHTML = trainings.map(t => {
    const st = statusMap[t.status] || statusMap.open;
    const fi = flowIndexes[t.status] || 0;
    const desc = t.description || t.desc || '';
    const gUrl = t.graphic_design ? API.resolveUploadUrl('training_graphics', t.graphic_design) : '';
    const graphicBlock = gUrl
      ? `<div class="training-graphic-wrap" style="margin:0 0 12px;border-radius:14px;overflow:hidden;border:1px solid var(--light-200);">
           <img src="${gUrl}" alt="" style="width:100%;display:block;max-height:220px;object-fit:cover;" loading="lazy">
           ${t.graphic_caption ? `<p style="padding:10px 12px;font-size:0.8rem;color:var(--text-secondary);margin:0;line-height:1.5;">${t.graphic_caption}</p>` : ''}
         </div>`
      : '';
    return `<div class="training-card">
      <div class="training-card-banner" style="background:linear-gradient(135deg,${t.color||'#1a6b3c'}22,${t.color||'#1a6b3c'}44);">
        <span>${t.icon || '🎓'}</span>
        <span class="training-format-badge">${t.format==='online'?'💻 Online':'📍 In-Person'}</span>
      </div>
      ${graphicBlock}
      <div class="training-card-body">
        <h3 class="training-title">${t.title}</h3>
        <p class="training-desc">${desc}</p>
        <div class="training-meta">
          <div class="training-price ${t.price===0?'free':''}">${t.price===0?'🆓 Free':'ETB '+t.price.toLocaleString()}</div>
          <span class="badge ${t.status==='registered'?'badge-green':'badge-gray'}">${t.status.charAt(0).toUpperCase()+t.status.slice(1)}</span>
        </div>
      </div>
      <div class="training-status-bar">
        <div class="status-flow">
          ${flowSteps.map((step,i)=>`<span class="status-flow-step ${i<fi?'done':i===fi?'current':''}">${i<fi?'✓':step}</span>${i<flowSteps.length-1?'<span class="status-flow-arrow">›</span>':''}`).join('')}
        </div>
        ${st.action?`<button class="btn ${st.btn} btn-sm" onclick="${st.action}(${t.id})">${st.label}</button>`:`<span style="font-size:0.75rem;color:var(--text-muted);">${st.label}</span>`}
      </div>
    </div>`;
  }).join('');
}

function filterTrainings(filter, el) {
  document.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  if (filter==='all')  renderTrainings(allTrainings);
  if (filter==='mine') renderTrainings(allTrainings.filter(t=>t.status!=='open'));
  if (filter==='free') renderTrainings(allTrainings.filter(t=>t.price===0));
}
window.filterTrainings = filterTrainings;

async function applyTraining(id) {
  const t = allTrainings.find(t=>t.id===id);
  if (!t) return;
  if (t.price>0) { openPaymentModal(id); return; }
  try {
    await API.applyTraining(id);
    t.status = 'registered';
    renderTrainings(allTrainings);
    showToast(`🎉 Enrolled in "${t.title}"!`,'success');
  } catch(e) { showToast('Error enrolling: ' + e.message, 'error'); }
}
window.applyTraining = applyTraining;

function openPaymentModal(id) {
  selectedTrainingId = id;
  const t = allTrainings.find(t=>t.id===id);
  if (!t) return;
  const el = (i) => document.getElementById(i);
  if (el('payModalTitle')) el('payModalTitle').textContent = t.title;
  if (el('payAmount')) el('payAmount').textContent = t.price>0 ? `ETB ${t.price.toLocaleString()}` : 'Free';
  el('paymentModal').classList.add('active');
}
window.openPaymentModal = openPaymentModal;

function closePaymentModal() {
  document.getElementById('paymentModal').classList.remove('active');
  selectedTrainingId = null;
}
window.closePaymentModal = closePaymentModal;

function previewReceipt(input) {
  const file = input.files[0]; if (!file) return;
  document.getElementById('receiptPreview').classList.add('visible');
  document.getElementById('receiptName').textContent = file.name;
}
window.previewReceipt = previewReceipt;

function clearReceipt() { document.getElementById('receiptInput').value=''; document.getElementById('receiptPreview').classList.remove('visible'); }
window.clearReceipt = clearReceipt;

async function submitReceipt() {
  const file = document.getElementById('receiptInput').files[0];
  if (!file) { showToast('Please upload your payment receipt','error'); return; }
  const t = allTrainings.find(t=>t.id===selectedTrainingId);
  if (!t) return;
  try { const fd=new FormData(); fd.append('receipt',file); await API.uploadReceipt(selectedTrainingId,fd); } catch(_){}
  t.status='receipt';
  renderTrainings(allTrainings);
  closePaymentModal();
  showToast('✅ Receipt submitted! Awaiting admin verification.','success');
}
window.submitReceipt = submitReceipt;

function enterTraining(id) { showToast('📖 Opening training materials…','gold'); }
window.enterTraining = enterTraining;

async function loadNetworkStudents() {
  try {
    allStudents = await API.getStudents();
    const filter = document.getElementById('networkFilter');
    if (filter) { 
      filter.innerHTML = '<option value="">All Universities</option>';
      const unis=[...new Set(allStudents.map(s=>s.university))]; 
      unis.forEach(u=>{const o=document.createElement('option');o.value=u;o.textContent=u;filter.appendChild(o);}); 
    }
    renderStudents(allStudents);
  } catch(e) {
    const grid = document.getElementById('studentGrid');
    if (grid) grid.innerHTML = `<div style="text-align:center;color:red;grid-column:1/-1;">Error loading network</div>`;
  }
}

function renderStudents(students) {
  const grid = document.getElementById('studentGrid'); if (!grid) return;
  grid.innerHTML = students.map(s=>`
    <div class="student-card">
      <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.2rem;margin:0 auto var(--space-3);">${(s.first_name?.[0]||'')+(s.father_name?.[0]||'')}</div>
      <div class="student-card-name">${s.first_name} ${s.father_name}</div>
      <div class="student-card-uni">${s.university}</div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:var(--space-4);">${s.academic_year?'Year '+s.academic_year:'—'} · ${s.program_type||'Psychology'}</div>
      <div style="display:flex;gap:var(--space-2);justify-content:center;">
        ${s.connected
          ? `<span class="badge badge-green">✓ Connected</span><button class="btn btn-ghost btn-sm" onclick="openMessageWith(${s.id},'${s.name}')">Message</button>`
          : `<button class="btn btn-outline-green btn-sm" onclick="connectStudent(${s.id},this)">+ Connect</button>`}
      </div>
    </div>`).join('');
}

function filterStudents() {
  const q  =(document.getElementById('networkSearch')?.value||'').toLowerCase();
  const uni= document.getElementById('networkFilter')?.value||'';
  renderStudents(allStudents.filter(s=>(!q||`${s.first_name} ${s.father_name}`.toLowerCase().includes(q)||s.university.toLowerCase().includes(q))&&(!uni||s.university===uni)));
}
window.filterStudents = filterStudents;

async function connectStudent(id,btn) { 
  try {
    await API.connectStudent(id);
    const s=allStudents.find(s=>s.id===id); if(s) s.connected=true; 
    if(btn){btn.textContent='✓ Connected';btn.className='btn btn-ghost btn-sm';btn.disabled=true;} 
    showToast('Connected!','success'); 
  } catch(e) {
    showToast('Error connecting: ' + e.message, 'error');
  }
}
window.connectStudent = connectStudent;

function openMessageWith(id,name) { switchSection('messaging'); setTimeout(()=>openConversation(id,name),300); }
window.openMessageWith = openMessageWith;

function openEditModal() { const bio=document.getElementById('profileBio')?.textContent||''; if(document.getElementById('editBio')) document.getElementById('editBio').value=bio; document.getElementById('editProfileModal').classList.add('active'); }
window.openEditModal = openEditModal;
function openEditBio() { openEditModal(); }
window.openEditBio = openEditBio;

async function saveProfile() {
  const bio=document.getElementById('editBio')?.value||'';
  const field=document.getElementById('editField')?.value||'';
  try { await API.updateProfile({bio,field_of_study:field}); } catch(_){}
  const bioEl=document.getElementById('profileBio'); if(bioEl&&bio) bioEl.textContent=bio;
  document.getElementById('editProfileModal').classList.remove('active');
  showToast('✅ Profile updated!','success');
}
window.saveProfile = saveProfile;

function previewProfilePhoto(input) {
  const file=input.files[0]; if(!file) return;
  const r=new FileReader(); r.onload=e=>{ ['profileAvatarImg','sidebarAvatar'].forEach(id=>{const img=document.getElementById(id);if(img) img.src=e.target.result;}); }; r.readAsDataURL(file);
  showToast('📷 Photo updated','gold');
}
window.previewProfilePhoto = previewProfilePhoto;

function parseExamScheduledMs(raw, serverTimeMs) {
  if (raw == null || raw === '') return serverTimeMs;
  const d = new Date(raw);
  const t = d.getTime();
  if (Number.isNaN(t)) {
    const alt = new Date(String(raw).replace(' ', 'T'));
    const t2 = alt.getTime();
    return Number.isNaN(t2) ? serverTimeMs : t2;
  }
  return t;
}

async function loadExams() {
  const list=document.getElementById('examList'); if(!list) return;
  try {
    const payload = await API.getExams();
    const serverTime = payload.server_time ? new Date(payload.server_time).getTime() : Date.now();
    const exams = payload.exams || []; // Ensure we have an array

    if (!exams.length) {
      list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:var(--space-8);">
        <div style="font-size:2rem;margin-bottom:12px;">📝</div>
        <div style="font-weight:600;margin-bottom:8px;">No exams currently available</div>
        <div style="font-size:0.875rem;">Check back later for new exam announcements</div>
      </div>`;
      return;
    }
    list.innerHTML=exams.map(e => {
      let status = 'upcoming';
      const scheduled = parseExamScheduledMs(e.scheduled_at, serverTime);

      if (e.my_submission && e.my_submission.submitted_at) {
        status = 'completed';
      } else if (scheduled <= serverTime) {
        status = 'open';
      }

      const resultReleased = !!e.results_released && e.my_submission && e.my_submission.score !== null;
      const faceReady = !!e.face_registered;
      const passLabel = e.my_submission && e.my_submission.passed === false ? 'Below passing mark' : (e.my_submission && e.my_submission.passed ? 'Passed' : '');
      const completedMarkup = resultReleased
        ? `<div><div style="font-family:var(--font-display);font-size:1.8rem;font-weight:900;color:var(--epsa-green);">${e.my_submission.score}%</div><div style="font-size:0.72rem;color:var(--text-muted);">Score${passLabel ? ` · ${passLabel}` : ''}</div></div>`
        : `<div><div style="font-weight:800;color:var(--epsa-gold-dark);font-size:0.88rem;">Awaiting Release</div><div style="font-size:0.72rem;color:var(--text-muted);">Admin review in progress</div></div>`;

      return `
      <div class="exam-card">
        <div class="exam-icon-block">📝</div>
        <div class="exam-info">
          <div class="exam-title">${e.title}</div>
          <div class="exam-meta">
            <span>⏱ ${e.duration_mins} min</span>
            <span>📋 ${e.question_count} questions</span>
            <span>📅 ${(() => {
              let d = e.scheduled_at;
              if (d && !d.includes('T')) d = d.replace(' ', 'T');
              if (d && !d.endsWith('Z')) d += 'Z';
              return new Date(d).toLocaleString();
            })()}</span>
          </div>
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">${e.description || 'No description provided.'}</p>
          <p style="font-size:0.74rem;color:${faceReady ? 'var(--epsa-green)' : '#b45309'};margin-top:6px;font-weight:700;">
            ${faceReady ? 'Face verification enabled for secure exam entry.' : 'Registration face profile missing. Contact admin before starting this exam.'}
          </p>
        </div>
        <div style="flex-shrink:0;text-align:center;">
          ${status==='open' ? `<button class="btn btn-primary" ${faceReady ? '' : 'disabled style="opacity:0.6;cursor:not-allowed;"'} onclick="${faceReady ? `takeExam(${e.id},'${e.title.replace(/'/g, "\\'")}',${e.duration_mins})` : 'return false;'}">Start Exam →</button>` : ''}
          ${status==='upcoming' ? `<button class="btn-exam-preview" onclick="previewExam(${e.id},'${e.title.replace(/'/g, "\\'")}',${e.duration_mins},'${e.scheduled_at}')">👁 Preview Exam</button><br><span class="badge badge-gold" style="margin-top:6px;">⏰ Scheduled</span>` : ''}
          ${status==='completed' ? completedMarkup : ''}
        </div>
      </div>`;
    }).join('');
  } catch(err) {
    console.error(err);
    list.innerHTML = `<div style="text-align:center;color:red;padding:var(--space-8);">Failed to load exams. Please try again.</div>`;
  }
}
window.loadExams = loadExams;

async function takeExam(eid, title, duration) {
  try {
    const profile = await API.getProfile();
    if (!profile.face_registered) {
      showToast('Face verification required. Complete registration face enrollment first.', 'error');
      return;
    }
    openExamFaceModal({ eid, title, duration });
  } catch (err) {
    showToast('Failed to prepare exam: ' + err.message, 'error');
  }
}
window.takeExam = takeExam;

window.requireExamFaceThenStart = async function requireExamFaceThenStart() {
  const examState = typeof window.getExamState === 'function' ? window.getExamState() : {};
  const id = examState.examId;
  const title = examState.title;
  const duration = examState.durationMins || Math.max(1, Math.round((examState.duration || 3600) / 60));
  if (!id) {
    showToast('Exam session not ready.', 'error');
    return;
  }
  try {
    const profile = await API.getProfile();
    if (!profile.face_registered) {
      showToast('Face verification required. Complete registration face enrollment first.', 'error');
      return;
    }
  } catch (err) {
    showToast(err.message || 'Could not verify your profile', 'error');
    return;
  }
  openExamFaceModal({ eid: id, title, duration });
};

async function previewExam(eid, title, duration, scheduledAt) {
  try {
    const res = await API.startExam(eid, { preview: true });
    startExamPlayer(eid, title, duration, res.questions, true, scheduledAt);
  } catch (err) {
    showToast('Failed to load preview: ' + err.message, 'error');
  }
}
window.previewExam = previewExam;

const examFaceGate = {
  stream: null,
  currentExam: null,
};

function ensureExamFaceModal() {
  if (document.getElementById('examFaceModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="examFaceModal" style="display:none;">
      <div class="modal" style="max-width:720px;width:95vw;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px;">
          <div>
            <h3 style="font-family:var(--font-display);font-weight:800;margin-bottom:4px;">Exam Identity Verification</h3>
            <p id="examFaceSubtitle" style="font-size:0.82rem;color:var(--text-muted);margin:0;">Complete a live face scan before the timed exam session opens.</p>
          </div>
          <button class="btn btn-ghost" onclick="closeExamFaceModal()">Close</button>
        </div>
        <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:20px;align-items:start;">
          <div>
            <div style="border-radius:20px;overflow:hidden;background:#0f172a;min-height:320px;position:relative;">
              <video id="examFaceVideo" autoplay playsinline muted style="width:100%;height:320px;object-fit:cover;"></video>
              <canvas id="examFaceCanvas" width="640" height="480" style="display:none;"></canvas>
              <div id="examFaceFallback" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;color:white;padding:24px;background:rgba(15,23,42,0.92);">
                Camera access is required to verify identity before the exam starts.
              </div>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
              <button class="btn btn-primary" onclick="captureExamFaceAndStart()">Verify & Start Exam</button>
              <button class="btn btn-ghost" onclick="restartExamFaceCamera()">Restart Camera</button>
            </div>
          </div>
          <div style="background:var(--light-50);border:1px solid var(--light-200);border-radius:18px;padding:18px;">
            <div style="font-weight:700;margin-bottom:10px;">Secure entry checklist</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.8;">
              <div>1. Face the camera directly.</div>
              <div>2. Use clear lighting and remove heavy backlight.</div>
              <div>3. Keep only one face in frame.</div>
              <div>4. Verification remains valid for a short window before exam launch.</div>
            </div>
            <div id="examFaceStatus" style="margin-top:16px;padding:14px 16px;border-radius:14px;background:white;border:1px solid var(--light-200);font-size:0.8rem;color:var(--text-secondary);line-height:1.7;">
              Live exam verification has not started yet.
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function updateExamFaceStatus(message, tone = 'neutral') {
  const box = document.getElementById('examFaceStatus');
  if (!box) return;
  const palettes = {
    neutral: { background: 'white', border: '1px solid var(--light-200)', color: 'var(--text-secondary)' },
    info: { background: 'rgba(26,107,60,0.08)', border: '1px solid rgba(26,107,60,0.22)', color: 'var(--epsa-green)' },
    success: { background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534' },
    error: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.24)', color: '#991b1b' },
  };
  const palette = palettes[tone] || palettes.neutral;
  box.style.background = palette.background;
  box.style.border = palette.border;
  box.style.color = palette.color;
  box.textContent = message;
}

async function openExamFaceModal(exam) {
  ensureExamFaceModal();
  examFaceGate.currentExam = exam;
  const modal = document.getElementById('examFaceModal');
  const subtitle = document.getElementById('examFaceSubtitle');
  subtitle.textContent = `Complete live face verification for "${exam.title}" before the timed session begins.`;
  modal.style.display = 'flex';
  await startExamFaceCamera();
}
window.openExamFaceModal = openExamFaceModal;

function closeExamFaceModal() {
  const modal = document.getElementById('examFaceModal');
  if (modal) modal.style.display = 'none';
  stopExamFaceCamera();
  examFaceGate.currentExam = null;
}
window.closeExamFaceModal = closeExamFaceModal;

async function startExamFaceCamera() {
  const video = document.getElementById('examFaceVideo');
  const fallback = document.getElementById('examFaceFallback');
  if (!video) return;
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      } 
    });
    video.srcObject = stream;
    examFaceGate.stream = stream;
    if (fallback) fallback.style.display = 'none';
    updateExamFaceStatus('Camera ready. Position your face clearly in the frame.', 'info');
  } catch (err) {
    console.error('Camera error:', err);
    if (fallback) fallback.style.display = 'flex';
    updateExamFaceStatus('Camera access denied or not available.', 'error');
  }
}

function stopExamFaceCamera() {
  if (examFaceGate.stream) {
    examFaceGate.stream.getTracks().forEach(track => track.stop());
    examFaceGate.stream = null;
  }
  const video = document.getElementById('examFaceVideo');
  if (video) video.srcObject = null;
}

async function restartExamFaceCamera() {
  stopExamFaceCamera();
  updateExamFaceStatus('Restarting camera...', 'info');
  await startExamFaceCamera();
}
window.restartExamFaceCamera = restartExamFaceCamera;

async function captureExamFaceAndStart() {
  if (!examFaceGate.currentExam) {
    showToast('No exam selected', 'error');
    return;
  }
  
  const video = document.getElementById('examFaceVideo');
  const canvas = document.getElementById('examFaceCanvas');
  if (!video || !canvas || !examFaceGate.stream) {
    showToast('Camera not ready', 'error');
    return;
  }
  
  updateExamFaceStatus('Capturing face...', 'info');
  
  // Capture frame
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  
  // Get image data
  const imageData = canvas.toDataURL('image/jpeg', 0.9);
  
  try {
    // Send to backend for verification
    const response = await API.verifyExamFace(examFaceGate.currentExam.eid, imageData);
    
    if (response.verified) {
      updateExamFaceStatus('Face verified successfully! Starting exam...', 'success');
      closeExamFaceModal();

      const res = await API.startExam(examFaceGate.currentExam.eid);
      startExamPlayer(
        examFaceGate.currentExam.eid,
        examFaceGate.currentExam.title,
        examFaceGate.currentExam.duration,
        res.questions,
        false,
        null,
        res.remaining_secs,
        true
      );
    } else {
      updateExamFaceStatus('Face verification failed. Please try again.', 'error');
    }
  } catch (err) {
    updateExamFaceStatus('Verification error: ' + err.message, 'error');
  }
}
window.captureExamFaceAndStart = captureExamFaceAndStart;

// Backward-compatible fallback for layouts that expect #networkStudentsList.
async function loadNetworkStudentsFallback() {
  const list = document.getElementById('networkStudentsList');
  if (!list) return;
  try {
    const students = await API.getStudents();
    if (!students.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:var(--space-6);">No network students found</div>';
      return;
    }
    list.innerHTML = students.map((student) => `
      <div class="network-student-card">
        <div class="student-avatar">${((student.first_name || '')[0] || '') + ((student.father_name || '')[0] || '')}</div>
        <div class="student-info">
          <div class="student-name">${student.first_name || ''} ${student.father_name || ''}</div>
          <div class="student-details">${student.university || ''} ${student.academic_year ? '· Year ' + student.academic_year : ''}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="connectWithStudent(${student.id})">Connect</button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div style="text-align:center;color:red;padding:var(--space-6);">Failed to load students</div>';
  }
}
if (document.getElementById('networkStudentsList')) {
  window.loadNetworkStudents = loadNetworkStudentsFallback;
}

async function connectWithStudent(studentId) {
  try {
    await API.connectStudent(studentId);
    showToast('Connected!', 'success');
    if (typeof window.loadNetworkStudents === 'function') {
      window.loadNetworkStudents();
    }
  } catch (err) {
    showToast(err.message || 'Could not connect', 'error');
  }
}
window.connectWithStudent = connectWithStudent;
