"""Inject Mock Exam section into dashboard.html and admin dashboard."""
import sys, re
sys.stdout.reconfigure(encoding='utf-8')

# ── 1. STUDENT DASHBOARD ──────────────────────────────────────────────────────
path = r'c:\Users\dawit\Desktop\EPSA WEB\dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add Mock Exams nav item after Exams nav item
OLD_NAV = 'data-section="exams"      onclick="switchSection(\'exams\')">'
OLD_NAV_FULL = OLD_NAV + '<span class="sidebar-link-icon">📝</span> Exams</button>'

if OLD_NAV_FULL in content:
    content = content.replace(
        OLD_NAV_FULL,
        OLD_NAV_FULL +
        '\n      <button class="sidebar-link" data-section="mock-exams" onclick="switchSection(\'mock-exams\')">'
        '<span class="sidebar-link-icon">🎯</span> Mock Exams</button>'
    )
    print('SUCCESS: mock-exams nav item added')
else:
    print('NAV item not found exactly — searching...')
    idx = content.find('data-section="exams"')
    print(repr(content[idx:idx+200]))

# Inject Mock Exam section HTML before </body>
MOCK_SECTION = '''
  <!-- ══ MOCK EXAMS SECTION ══ -->
  <div id="section-mock-exams" class="dash-section" style="display:none">
    <div class="section-header">
      <h2>🎯 Mock Examinations</h2>
      <p class="section-desc">Practice with randomized questions from the national question bank. Results are released after the exam window closes.</p>
    </div>

    <!-- Exam cards list -->
    <div id="mockExamCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px;margin-bottom:28px">
      <div style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1">Loading exams…</div>
    </div>
  </div>

  <!-- ══ MOCK EXAM FULLSCREEN UI ══ -->
  <div id="mockExamFullscreen" style="display:none;position:fixed;inset:0;background:#071f10;z-index:9000;flex-direction:column;font-family:Outfit,sans-serif">
    <!-- Header bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:rgba(0,0,0,.4);border-bottom:1px solid rgba(34,197,94,.15);flex-shrink:0">
      <div>
        <div id="meExamTitle" style="font-weight:800;font-size:1.05rem;color:#f0fdf4"></div>
        <div id="meProgress" style="font-size:.8rem;color:#86efac;margin-top:2px"></div>
      </div>
      <div id="meTimer" style="font-size:1.4rem;font-weight:800;color:#22c55e;font-variant-numeric:tabular-nums;background:rgba(34,197,94,.1);padding:8px 18px;border-radius:10px;border:1px solid rgba(34,197,94,.2)">00:00</div>
      <button onclick="confirmSubmitExam()" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-size:.9rem;font-weight:700;cursor:pointer">Submit Exam</button>
    </div>

    <!-- Question navigator -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;padding:12px 24px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(34,197,94,.08);flex-shrink:0;overflow-y:auto;max-height:90px" id="meQNav"></div>

    <!-- Question area -->
    <div style="flex:1;overflow-y:auto;padding:32px 24px;max-width:860px;margin:0 auto;width:100%">
      <div id="meQuestionArea">
        <div style="color:#86efac;text-align:center;padding:60px">Loading question…</div>
      </div>
    </div>

    <!-- Bottom nav -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:rgba(0,0,0,.4);border-top:1px solid rgba(34,197,94,.08);flex-shrink:0">
      <button id="mePrevBtn" onclick="meNavigate(-1)" style="background:rgba(255,255,255,.07);color:#86efac;border:1px solid rgba(34,197,94,.2);padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-weight:600;cursor:pointer">← Prev</button>
      <span id="meQLabel" style="color:#86efac;font-size:.9rem"></span>
      <button id="meNextBtn" onclick="meNavigate(1)" style="background:rgba(255,255,255,.07);color:#86efac;border:1px solid rgba(34,197,94,.2);padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-weight:600;cursor:pointer">Next →</button>
    </div>
  </div>

  <!-- ══ MOCK EXAM RESULTS MODAL ══ -->
  <div id="mockResultsModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9500;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto">
    <div style="background:#0a2e18;border:1px solid rgba(34,197,94,.2);border-radius:20px;padding:32px;width:100%;max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="font-size:1.3rem;font-weight:800;color:#f0fdf4">📊 Exam Results</h2>
        <button onclick="document.getElementById('mockResultsModal').style.display='none'" style="background:rgba(255,255,255,.07);border:1px solid rgba(34,197,94,.15);color:#86efac;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.1rem">✕</button>
      </div>
      <div id="mockResultsContent" style="color:#86efac;text-align:center;padding:40px">Loading…</div>
    </div>
  </div>

  <script>
  // ══════════════════════════════════════════
  //   MOCK EXAM ENGINE
  // ══════════════════════════════════════════
  const ME = {
    examId: null, submissionId: null, questions: [], answers: {},
    timesPerQ: {}, currentIdx: 0, timerInterval: null, totalSecs: 0,
    elapsedSecs: 0, qStartTime: null, saveInterval: null,
  };

  // Load and render exam cards
  async function loadMockExams() {
    const container = document.getElementById('mockExamCards');
    if (!container) return;
    try {
      const data = await API.listMockExams();
      const exams = data.exams || [];
      if (!exams.length) {
        container.innerHTML = '<div style="text-align:center;color:#86efac;padding:60px;grid-column:1/-1;opacity:.6"><div style="font-size:2.5rem;margin-bottom:12px">📭</div><div style="font-weight:700">No mock exams available right now</div><div style="font-size:.85rem;margin-top:6px">Check back when an exam window opens.</div></div>';
        return;
      }
      container.innerHTML = exams.map(e => renderMockExamCard(e)).join('');
    } catch(err) {
      container.innerHTML = '<div style="text-align:center;color:#f87171;padding:40px;grid-column:1/-1">' + (err.message || 'Failed to load exams') + '</div>';
    }
  }

  function renderMockExamCard(e) {
    const statusColor = e.is_open ? '#22c55e' : (e.is_submitted ? '#3b82f6' : '#f59e0b');
    const statusLabel = e.is_submitted ? 'Submitted' : (e.is_open ? 'Open Now' : 'Scheduled');
    const btnHtml = e.can_start
      ? `<button onclick="startMockExam(${e.id})" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-weight:700;cursor:pointer;width:100%;margin-top:16px">🎯 Start Exam</button>`
      : e.can_continue
      ? `<button onclick="startMockExam(${e.id})" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-weight:700;cursor:pointer;width:100%;margin-top:16px">▶️ Continue Exam</button>`
      : e.results_viewable
      ? `<button onclick="viewMockResults(${e.id})" style="background:rgba(59,130,246,.15);color:#3b82f6;border:1px solid rgba(59,130,246,.3);padding:10px 20px;border-radius:10px;font-family:Outfit,sans-serif;font-weight:700;cursor:pointer;width:100%;margin-top:16px">📊 View My Results</button>`
      : e.is_submitted
      ? `<div style="text-align:center;color:#86efac;margin-top:16px;font-size:.85rem">✅ Submitted — Results pending release</div>`
      : `<div style="text-align:center;color:#86efac;margin-top:16px;font-size:.85rem">⏳ Exam not yet open</div>`;

    return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(34,197,94,.16);border-radius:16px;padding:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <h3 style="font-size:1rem;font-weight:700;color:#f0fdf4;line-height:1.3">${escHtml(e.title)}</h3>
        <span style="background:rgba(0,0,0,.3);color:${statusColor};border:1px solid ${statusColor}44;font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;margin-left:8px">${statusLabel}</span>
      </div>
      ${e.description ? `<p style="font-size:.83rem;color:#86efac;margin-bottom:12px">${escHtml(e.description)}</p>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.8rem;color:#86efac">
        <div>📝 ${e.question_count} questions</div>
        <div>⏱️ ${e.duration_mins} minutes</div>
        ${e.my_score != null ? `<div style="grid-column:1/-1;color:#22c55e;font-weight:700">Your score: ${e.my_score}%</div>` : ''}
      </div>
      ${btnHtml}
    </div>`;
  }

  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Start or resume exam
  async function startMockExam(examId) {
    try {
      showToast('Preparing exam…', 'info');
      const data = await API.startMockExam(examId);
      ME.examId = examId;
      ME.submissionId = data.submission_id;
      ME.questions = data.questions || [];
      ME.answers = data.answers || {};
      ME.timesPerQ = {};
      ME.currentIdx = 0;
      ME.totalSecs = (data.duration_mins || 120) * 60;
      ME.elapsedSecs = data.elapsed_secs || 0;
      ME.qStartTime = Date.now();
      openExamFullscreen(data);
    } catch(err) {
      showToast(err.message || 'Could not start exam', 'error');
    }
  }

  function openExamFullscreen(data) {
    const fs = document.getElementById('mockExamFullscreen');
    fs.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('meExamTitle').textContent = 'EPSA Mock Exam';
    buildQNav();
    renderMeQuestion(0);
    startMeTimer();
    // Auto-save every 30s
    ME.saveInterval = setInterval(saveProgress, 30000);
  }

  function buildQNav() {
    const nav = document.getElementById('meQNav');
    nav.innerHTML = ME.questions.map((q, i) => {
      const answered = ME.answers[String(q.id)] !== undefined;
      return `<button id="meQBtn${i}" onclick="meGoTo(${i})" style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(34,197,94,${answered?'.5':'.15'});background:${answered?'rgba(34,197,94,.2)':'rgba(255,255,255,.04)'};color:${answered?'#22c55e':'#86efac'};font-size:.78rem;font-weight:700;cursor:pointer;transition:.15s">${i+1}</button>`;
    }).join('');
  }

  function renderMeQuestion(idx) {
    ME.currentIdx = idx;
    const q = ME.questions[idx];
    if (!q) return;
    const total = ME.questions.length;
    const answeredCount = Object.keys(ME.answers).length;
    document.getElementById('meProgress').textContent = `Question ${idx+1} of ${total} · ${answeredCount} answered`;
    document.getElementById('meQLabel').textContent = `${idx+1} / ${total}`;
    document.getElementById('mePrevBtn').disabled = idx === 0;
    document.getElementById('meNextBtn').disabled = idx === total - 1;
    document.getElementById('meNextBtn').textContent = idx === total - 1 ? 'Last Question' : 'Next →';

    const selected = ME.answers[String(q.id)];
    const optLetters = ['A','B','C','D'];
    document.getElementById('meQuestionArea').innerHTML = `
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(34,197,94,.12);border-radius:14px;padding:24px;margin-bottom:20px">
        <div style="font-size:.78rem;color:#86efac;margin-bottom:10px;font-weight:600">QUESTION ${idx+1}</div>
        <div style="font-size:1.05rem;font-weight:600;line-height:1.6;color:#f0fdf4">${escHtml(q.question_text)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${q.options.map((opt, oi) => `
          <button onclick="meSelectAnswer(${q.id}, ${oi})" style="text-align:left;padding:14px 18px;border-radius:12px;border:1px solid ${selected===oi?'rgba(34,197,94,.6)':'rgba(34,197,94,.15)'};background:${selected===oi?'rgba(34,197,94,.15)':'rgba(255,255,255,.035)'};color:${selected===oi?'#22c55e':'#f0fdf4'};font-family:Outfit,sans-serif;font-size:.93rem;cursor:pointer;transition:.18s;display:flex;align-items:flex-start;gap:12px">
            <span style="width:24px;height:24px;border-radius:50%;background:${selected===oi?'rgba(34,197,94,.3)':'rgba(255,255,255,.08)'};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.78rem;flex-shrink:0">${optLetters[oi]}</span>
            ${escHtml(opt)}
          </button>`).join('')}
      </div>`;
    ME.qStartTime = Date.now();
  }

  function meSelectAnswer(qid, optIdx) {
    // Track time on question
    const elapsed = Math.round((Date.now() - ME.qStartTime) / 1000);
    ME.timesPerQ[String(qid)] = (ME.timesPerQ[String(qid)] || 0) + elapsed;
    ME.answers[String(qid)] = optIdx;
    ME.qStartTime = Date.now();
    buildQNav();
    renderMeQuestion(ME.currentIdx);
  }

  function meNavigate(dir) {
    const newIdx = ME.currentIdx + dir;
    if (newIdx >= 0 && newIdx < ME.questions.length) {
      ME.qStartTime = Date.now();
      renderMeQuestion(newIdx);
    }
  }

  function meGoTo(idx) {
    ME.qStartTime = Date.now();
    renderMeQuestion(idx);
  }

  function startMeTimer() {
    clearInterval(ME.timerInterval);
    let remaining = ME.totalSecs - ME.elapsedSecs;
    const el = document.getElementById('meTimer');
    ME.timerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(ME.timerInterval);
        el.textContent = '00:00';
        el.style.color = '#f87171';
        autoSubmitExam();
        return;
      }
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      el.textContent = m + ':' + s;
      if (remaining < 300) el.style.color = '#f87171';
      else if (remaining < 600) el.style.color = '#f59e0b';
    }, 1000);
  }

  async function saveProgress() {
    if (!ME.examId) return;
    try {
      await API.saveMockProgress(ME.examId, { answers: ME.answers, time_per_question: ME.timesPerQ });
    } catch(e) {}
  }

  function confirmSubmitExam() {
    if (!confirm('Submit your exam now? You cannot change answers after submission.')) return;
    submitExam(false);
  }
  async function autoSubmitExam() {
    showToast('Time is up! Your exam is being auto-submitted…', 'gold');
    await submitExam(true);
  }

  async function submitExam(auto = false) {
    clearInterval(ME.timerInterval);
    clearInterval(ME.saveInterval);
    ME.timerInterval = null;
    ME.saveInterval = null;
    try {
      const result = await API.submitMockExam(ME.examId, {
        answers: ME.answers,
        time_per_question: ME.timesPerQ,
        auto_submit: auto,
      });
      closeExamFullscreen();
      showToast(`Exam submitted! Score: ${result.score}% (${result.correct}/${result.total})`, 'success');
      loadMockExams();
    } catch(err) {
      showToast(err.message || 'Submit failed', 'error');
    }
  }

  function closeExamFullscreen() {
    document.getElementById('mockExamFullscreen').style.display = 'none';
    document.body.style.overflow = '';
    ME.examId = null;
    ME.questions = [];
    ME.answers = {};
  }

  // View results
  async function viewMockResults(examId) {
    const modal = document.getElementById('mockResultsModal');
    const content = document.getElementById('mockResultsContent');
    modal.style.display = 'flex';
    content.innerHTML = '<div style="color:#86efac;padding:40px;text-align:center">Loading…</div>';
    try {
      const data = await API.getMockResults(examId);
      const pct = data.score || 0;
      const color = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#f87171';
      content.innerHTML = `
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:3rem;font-weight:800;color:${color}">${pct}%</div>
          <div style="color:#86efac;font-size:.9rem;margin-top:6px">${data.correct} correct out of ${data.total} questions</div>
          <div style="color:#86efac;font-size:.8rem;margin-top:4px">${data.exam_title}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto">
          ${(data.breakdown || []).map((b, i) => `
            <div style="background:rgba(${b.correct?'34,197,94':'248,113,113'},.07);border:1px solid rgba(${b.correct?'34,197,94':'248,113,113'},.2);border-radius:10px;padding:14px">
              <div style="font-size:.82rem;font-weight:600;color:#f0fdf4;margin-bottom:6px">${i+1}. ${escHtml(b.question_text)}</div>
              <div style="font-size:.78rem;color:${b.correct?'#22c55e':'#f87171'}">${b.correct?'✅ Correct':'❌ Incorrect'}</div>
              ${b.explanation ? `<div style="font-size:.75rem;color:#86efac;margin-top:6px;font-style:italic">${escHtml(b.explanation)}</div>` : ''}
            </div>`).join('')}
        </div>`;
    } catch(err) {
      content.innerHTML = '<div style="color:#f87171;padding:40px;text-align:center">' + (err.message || 'Failed to load results') + '</div>';
    }
  }

  // Hook into the existing switchSection function
  const _origSwitchSection = typeof switchSection === 'function' ? switchSection : null;
  function switchSection(name) {
    // Hide mock exam fullscreen if switching away
    if (name !== 'mock-exams') {
      // don't close fullscreen mid-exam
    }
    if (_origSwitchSection) {
      _origSwitchSection(name);
    } else {
      document.querySelectorAll('.dash-section').forEach(s => s.style.display='none');
      const target = document.getElementById('section-' + name);
      if (target) target.style.display = 'block';
    }
    if (name === 'mock-exams') loadMockExams();
    // Update active nav
    document.querySelectorAll('.sidebar-link').forEach(b => b.classList.remove('active'));
    const nb = document.querySelector('.sidebar-link[data-section="' + name + '"]');
    if (nb) nb.classList.add('active');
  }
  window.switchSection = switchSection;
  </script>
'''

if '</body>' in content:
    content = content.replace('</body>', MOCK_SECTION + '\n</body>', 1)
    print('SUCCESS: Mock exam section injected into dashboard.html')
else:
    print('ERROR: </body> not found in dashboard.html')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
