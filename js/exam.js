// ════════════════════════════════════════════════
// EPSA SECURE EXAM ENGINE v2
// ════════════════════════════════════════════════

let examState = {
  examId: null, title: '', duration: 0, durationMins: 60,
  questions: [], answers: {}, startTime: null,
  timerInterval: null, tabSwitchCount: 0,
  maxTabSwitches: 3, submitted: false, hasStarted: false,
  lastCheatWarning: 0, heartbeatInterval: null,
  previewActive: false,
};

// ── START EXAM ────────────────────────────────
function startExamPlayer(examId, title, durationMins, questionsList, isLockedPreview = false, scheduledAt = null, remainingSecs = null, startDirect = false) {
  let shuffledQuestions = [...questionsList].sort(() => Math.random() - 0.5);
  shuffledQuestions.forEach(q => {
    let opts = [
      { text: q.option_a, origIdx: 0 },
      { text: q.option_b, origIdx: 1 },
      { text: q.option_c, origIdx: 2 }
    ];
    if (q.option_d) opts.push({ text: q.option_d, origIdx: 3 });
    opts.sort(() => Math.random() - 0.5);
    q.shuffledOptions = opts;
  });

  // Use server-provided remaining time or full duration
  const effectiveDuration = remainingSecs != null ? remainingSecs : durationMins * 60;

  examState = {
    examId, title,
    duration: effectiveDuration,
    durationMins: durationMins,
    questions: shuffledQuestions, answers: {},
    startTime: null, timerInterval: null,
    tabSwitchCount: 0, maxTabSwitches: 3,
    submitted: false, hasStarted: false,
    lastCheatWarning: 0, heartbeatInterval: null,
    previewActive: !startDirect && !isLockedPreview,
  };

  const overlay = document.getElementById('examOverlay'); if (!overlay) return;
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.getElementById('examPlayerTitle').textContent = title;
  if (startDirect) {
    disablePreviewProtection();
    examState.hasStarted = true;
    examState.startTime = Date.now();
    examState.previewActive = false;
    renderExamQuestions();
    startExamTimer();
    startExamHeartbeat();
    enableAntiCheat();
    syncExamProgress();
    showToast('Exam started. Good luck!', 'gold');
  } else {
    renderExamPreview(isLockedPreview, scheduledAt);
  }
}
window.startExamPlayer = startExamPlayer;

function beginExamNow() {
  if (typeof window.requireExamFaceThenStart === 'function') {
    window.requireExamFaceThenStart();
    return;
  }
  beginExamSessionAfterGate();
}
window.beginExamNow = beginExamNow;

function beginExamSessionAfterGate() {
  if (window._previewCountdownInterval) {
    clearInterval(window._previewCountdownInterval);
    window._previewCountdownInterval = null;
  }
  disablePreviewProtection();
  examState.hasStarted = true;
  examState.previewActive = false;
  examState.startTime = Date.now();
  renderExamQuestions();
  startExamTimer();
  startExamHeartbeat();
  enableAntiCheat();
  syncExamProgress();
  showToast('Exam started. Good luck!', 'gold');
}
window.beginExamSessionAfterGate = beginExamSessionAfterGate;

// ── RENDER PREVIEW ────────────────────────────
function renderExamPreview(isLockedPreview, scheduledAt) {
  const container = document.getElementById('examQuestions'); if (!container) return;
  const total = examState.questions.length;
  document.getElementById('examProgress').textContent = `0/${total}`;
  const display = document.getElementById('examTimerDisplay');
  if (display) display.textContent = '--:--';

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const formattedDate = scheduledDate ? scheduledDate.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '';

  let headerHtml;
  if (isLockedPreview) {
    headerHtml = `
      <div style="text-align:center;margin-bottom:var(--space-6);padding:var(--space-8) var(--space-6);
        background:linear-gradient(135deg,rgba(26,107,60,0.08),rgba(26,107,60,0.03));
        border:1px solid rgba(26,107,60,0.25);border-radius:var(--radius-xl);
        box-shadow:0 4px 24px rgba(26,107,60,0.08);">
        <div style="font-size:2.5rem;margin-bottom:var(--space-3);">🔒</div>
        <h2 style="font-family:var(--font-display);font-weight:800;color:var(--epsa-green);margin-bottom:var(--space-2);">Preview Mode</h2>
        <p style="color:var(--text-muted);font-size:0.9rem;max-width:480px;margin:0 auto var(--space-4);">
          Question wording stays hidden until the scheduled open time. After open, identity verification is required before the timed attempt begins.
        </p>
        ${scheduledDate ? `
        <div style="background:rgba(26,107,60,0.07);border-radius:var(--radius-lg);padding:var(--space-4) var(--space-5);margin:var(--space-4) auto;max-width:440px;">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:4px;">Exam Opens At</div>
          <div style="font-weight:700;color:var(--epsa-green);font-size:1rem;margin-bottom:var(--space-3);">📅 ${formattedDate}</div>
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:8px;">Countdown to Start</div>
          <div style="display:flex;justify-content:center;gap:var(--space-3);">
            <div class="countdown-unit"><span class="countdown-val" id="cd-days">--</span><span class="countdown-label">Days</span></div>
            <div class="countdown-unit"><span class="countdown-val" id="cd-hours">--</span><span class="countdown-label">Hrs</span></div>
            <div class="countdown-unit"><span class="countdown-val" id="cd-mins">--</span><span class="countdown-label">Min</span></div>
            <div class="countdown-unit"><span class="countdown-val" id="cd-secs">--</span><span class="countdown-label">Sec</span></div>
          </div>
        </div>` : ''}
        <button class="btn btn-lg" disabled style="margin-top:var(--space-4);font-size:1rem;padding:var(--space-3) var(--space-7);background:var(--light-200);color:var(--text-muted);cursor:not-allowed;border-radius:var(--radius-lg);">
          ⏰ Not Open Yet
        </button>
      </div>`;
  } else {
    headerHtml = `
      <div style="text-align:center;margin-bottom:var(--space-6);padding:var(--space-8);
        background:rgba(26,107,60,0.05);border:1px solid rgba(26,107,60,0.2);border-radius:var(--radius-xl);">
        <div style="font-size:2.5rem;margin-bottom:var(--space-3);">📋</div>
        <h2 style="font-family:var(--font-display);font-weight:800;color:var(--epsa-green);margin-bottom:var(--space-3);">Preview Mode</h2>
        <p style="color:var(--text-muted);font-size:0.9rem;max-width:500px;margin:0 auto var(--space-6);">
          Review structure below. Full content unlocks only after identity verification when you begin the exam.
        </p>
        <button type="button" class="btn btn-primary btn-lg" onclick="beginExamNow()"
          style="font-size:1.1rem;padding:var(--space-4) var(--space-8);box-shadow:0 12px 24px rgba(26,107,60,0.25);">
          Verify identity &amp; begin
        </button>
      </div>`;
  }

  container.innerHTML = headerHtml + buildQuestionsHTML(true);
  enablePreviewProtection();

  // Live countdown with auto-launch
  if (isLockedPreview && scheduledDate) {
    if (window._previewCountdownInterval) clearInterval(window._previewCountdownInterval);
    window._previewCountdownInterval = setInterval(() => {
      const diff = scheduledDate.getTime() - Date.now();
      if (diff <= 0) {
        clearInterval(window._previewCountdownInterval);
        window._previewCountdownInterval = null;
        ['cd-days','cd-hours','cd-mins','cd-secs'].forEach(id => {
          const el = document.getElementById(id); if (el) el.textContent = '00';
        });
        // ── "EXAM STARTING NOW" glow animation for 5 seconds ──
        showExamStartingBanner();
        return;
      }
      const days  = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      const secs  = Math.floor((diff % 60000) / 1000);
      const pad = n => String(n).padStart(2, '0');
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = pad(val); };
      set('cd-days', days); set('cd-hours', hours); set('cd-mins', mins); set('cd-secs', secs);
    }, 1000);
  }
}

function showExamStartingBanner() {
  const container = document.getElementById('examQuestions'); if (!container) return;
  disablePreviewProtection();

  // Inject keyframe animation into the page if not already present
  if (!document.getElementById('examGlowStyle')) {
    const style = document.createElement('style');
    style.id = 'examGlowStyle';
    style.textContent = `
      @keyframes examGlowPulse {
        0%,100% { opacity:1; box-shadow: 0 0 30px rgba(26,107,60,0.6), 0 0 80px rgba(26,107,60,0.3); }
        50%      { opacity:0.55; box-shadow: 0 0 60px rgba(26,107,60,0.9), 0 0 120px rgba(26,107,60,0.5); }
      }
    `;
    document.head.appendChild(style);
  }

  container.innerHTML = `
    <div id="examStartingBanner" style="
      text-align:center; padding:var(--space-12) var(--space-8);
      background:linear-gradient(135deg,#0a3d1f,#1a6b3c);
      border-radius:var(--radius-xl);
      animation: examGlowPulse 1s ease-in-out infinite;
      color:white;">
      <div style="font-size:4rem;margin-bottom:var(--space-4);">🚀</div>
      <h1 style="font-family:var(--font-display);font-size:2.5rem;font-weight:900;
        color:#c8a340;margin-bottom:var(--space-3);letter-spacing:-0.02em;">
        EXAM STARTING NOW
      </h1>
      <p style="color:rgba(255,255,255,0.75);font-size:1rem;">Good luck! The exam will begin in a moment…</p>
    </div>
  `;

  // Auto-launch the exam after 5 seconds
  setTimeout(() => {
    beginExamNow();
  }, 5000);
}

// ── RENDER QUESTIONS ──────────────────────────
function renderExamQuestions() {
  const container = document.getElementById('examQuestions'); if (!container) return;
  container.innerHTML = buildQuestionsHTML(false);
}

function buildQuestionsHTML(isPreview) {
  const secureCls = isPreview ? 'exam-secure-preview' : 'exam-secure-live';
  return examState.questions.map((q, qi) => `
    <div class="question-block ${secureCls}" id="qblock-${q.id}" style="background:white;border-radius:var(--radius-xl);padding:var(--space-7);border:1px solid var(--light-200);box-shadow:var(--shadow-sm);user-select:none;-webkit-user-select:none;">
      <div style="display:flex;align-items:flex-start;gap:var(--space-4);margin-bottom:var(--space-6);">
        <span style="width:32px;height:32px;border-radius:50%;background:var(--epsa-green);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0;">${qi+1}</span>
        <p class="exam-qtext" style="font-size:1rem;font-weight:600;color:var(--text-primary);line-height:1.6;margin:0;">${isPreview ? '— Question text hidden until exam start —' : q.question}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${q.shuffledOptions.map((opt, oi) => `
          <div class="exam-option" id="opt-${q.id}-${oi}"
               style="padding:14px 18px;border:2px solid var(--light-200);border-radius:var(--radius-lg);cursor:${isPreview ? 'not-allowed' : 'pointer'};transition:all 0.15s;position:relative;user-select:none;-webkit-user-select:none;"
               ${!isPreview ? `onmouseenter="revealOption(this)" onmouseleave="blurOption(this,'${q.id}','${opt.origIdx}')" onclick="selectAnswer('${q.id}',${oi},${opt.origIdx},this)"` : ''}>
            <div style="display:flex;align-items:center;gap:var(--space-3);">
              <span style="width:28px;height:28px;border-radius:50%;background:var(--light-100);border:1.5px solid var(--light-200);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8rem;flex-shrink:0;">${String.fromCharCode(65+oi)}</span>
              <span class="option-text" style="font-size:0.9rem;">${isPreview ? '— Hidden until start —' : opt.text}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function revealOption(el) {
  if (!examState.hasStarted) return;
  if (!el.classList.contains('selected')) el.style.borderColor = 'var(--epsa-green)';
}

function blurOption(el, qid, origIdx) {
  if (!examState.hasStarted) return;
  if (examState.answers[qid] !== undefined && examState.answers[qid] == origIdx) return;
  if (!el.classList.contains('selected')) el.style.borderColor = 'var(--light-200)';
}

function selectAnswer(qid, uiIdx, origIdx, el) {
  if (!examState.hasStarted) return;
  examState.answers[qid] = origIdx;
  examState.questions.forEach(q => {
    if (String(q.id) !== String(qid)) return;
    q.shuffledOptions.forEach((_, i) => {
      const opt = document.getElementById(`opt-${qid}-${i}`);
      if (!opt) return;
      opt.classList.remove('selected');
      opt.style.borderColor = 'var(--light-200)';
      opt.style.background  = 'white';
    });
  });
  el.classList.add('selected');
  el.style.borderColor = 'var(--epsa-green)';
  el.style.background  = 'rgba(26,107,60,0.05)';
  const answered = Object.keys(examState.answers).length;
  const prog = document.getElementById('examProgress');
  if (prog) prog.textContent = `${answered}/${examState.questions.length}`;
  syncExamProgress();
}
window.selectAnswer = selectAnswer;

function syncExamProgress() {
  if (!examState.examId || !examState.hasStarted || examState.submitted) return;
  API.updateExamProgress(examState.examId, examState.answers, Object.keys(examState.answers).length).catch(() => {});
}

function startExamHeartbeat() {
  clearInterval(examState.heartbeatInterval);
  examState.heartbeatInterval = setInterval(() => {
    syncExamProgress();
  }, 15000);
}

// ── TIMER (server-based) ──────────────────────
function startExamTimer() {
  const display = document.getElementById('examTimerDisplay');
  // remaining seconds at start comes from examState.duration (server-authorised)
  let remaining = examState.duration;
  examState.startTime = Date.now();

  const tick = () => {
    const elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
    const left = remaining - elapsed;
    if (left <= 0) { clearInterval(examState.timerInterval); autoSubmitExam(); return; }
    const m = Math.floor(left / 60).toString().padStart(2, '0');
    const s = (left % 60).toString().padStart(2, '0');
    if (display) {
      display.textContent = `${m}:${s}`;
      display.style.color = left <= 300 ? '#f87171' : 'var(--epsa-gold-light)';
    }
  };
  tick();
  examState.timerInterval = setInterval(tick, 1000);
}

// ── ANTI-CHEAT ────────────────────────────────
function enableAntiCheat() {
  document.addEventListener('copy',         blockEvent);
  document.addEventListener('paste',        blockEvent);
  document.addEventListener('cut',          blockEvent);
  document.addEventListener('contextmenu',  blockEvent);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur',           handleWindowBlur);
  document.addEventListener('keydown',      blockDevTools);
  document.addEventListener('selectstart',  blockSelection);
  document.addEventListener('dragstart',    blockDrag);
}

function previewBlockEvent(e) {
  if (!examState.previewActive) return;
  const t = e.target;
  if (t && t.closest && t.closest('#examOverlay')) {
    e.preventDefault();
  }
}

function enablePreviewProtection() {
  examState.previewActive = true;
  document.addEventListener('copy', previewBlockEvent, true);
  document.addEventListener('cut', previewBlockEvent, true);
  document.addEventListener('contextmenu', previewBlockEvent, true);
  document.addEventListener('selectstart', previewBlockEvent, true);
}

function disablePreviewProtection() {
  examState.previewActive = false;
  document.removeEventListener('copy', previewBlockEvent, true);
  document.removeEventListener('cut', previewBlockEvent, true);
  document.removeEventListener('contextmenu', previewBlockEvent, true);
  document.removeEventListener('selectstart', previewBlockEvent, true);
}

function blockSelection(e) {
  // Allow text selection for form inputs but block exam content selection
  if (examState.hasStarted && !e.target.closest('input, textarea')) {
    e.preventDefault();
    showToast('Text selection is not allowed during exams', 'warning');
  }
}

function blockDrag(e) {
  if (examState.hasStarted) {
    e.preventDefault();
    showToast('Dragging content is not allowed during exams', 'warning');
  }
}

function blockEvent(e) {
  if (examState.submitted || !isExamActive()) return;
  e.preventDefault();
  showToast('⚠ Action disabled during exam', 'error');
}

function blockDevTools(e) {
  if (!isExamActive()) return;
  // Block dev tool shortcuts
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key)) || (e.ctrlKey && e.key === 'U')) {
    e.preventDefault();
    showToast('⚠ Developer tools are blocked', 'error');
    return;
  }
  // PrintScreen → auto disqualify
  if (e.key === 'PrintScreen') {
    e.preventDefault();
    navigator.clipboard.writeText('').catch(() => {});
    autoDisqualify('📸 Screenshot attempt detected! You have been automatically disqualified.');
  }
}

function isExamActive() {
  const overlay = document.getElementById('examOverlay');
  return overlay && overlay.style.display !== 'none' && examState.hasStarted && !examState.submitted;
}

function handleVisibilityChange() {
  if (!isExamActive()) return;
  if (document.hidden) triggerCheatWarning();
}

function handleWindowBlur() {
  if (!isExamActive()) return;
  triggerCheatWarning();
}

function triggerCheatWarning() {
  // Debounce: both blur & visibilitychange fire together; only count once per 2s
  if (Date.now() - examState.lastCheatWarning < 2000) return;
  examState.lastCheatWarning = Date.now();
  examState.tabSwitchCount++;

  if (examState.tabSwitchCount > examState.maxTabSwitches) {
    autoDisqualify('🚫 Too many tab switches. You have been disqualified.');
    return;
  }

  // 19-second warning countdown
  showTabSwitchWarning(examState.tabSwitchCount, examState.maxTabSwitches);
}

function showTabSwitchWarning(count, max) {
  // Remove existing warnings
  const existing = document.getElementById('examTabWarning');
  if (existing) existing.remove();
  if (window._tabWarningTimer) clearInterval(window._tabWarningTimer);

  const warn = document.createElement('div');
  warn.id = 'examTabWarning';
  warn.style.cssText = `
    position:fixed;inset:0;background:rgba(5,14,7,0.96);z-index:99999;
    display:flex;align-items:center;justify-content:center;flex-direction:column;
    color:white;text-align:center;padding:var(--space-8);
  `;
  let secs = 19;
  warn.innerHTML = getTabWarnHTML(count, max, secs);
  document.body.appendChild(warn);

  window._tabWarningTimer = setInterval(() => {
    secs--;
    const el = document.getElementById('tabWarnCountdown');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      clearInterval(window._tabWarningTimer);
      warn.remove();
      // If they still haven't returned (document still hidden), escalate
      if (document.hidden) {
        examState.tabSwitchCount = examState.maxTabSwitches + 1;
        autoDisqualify('🚫 You did not return in time. You have been disqualified.');
      }
    }
  }, 1000);
}

function getTabWarnHTML(count, max, secs) {
  return `
    <div style="background:rgba(200,60,60,0.12);border:2px solid rgba(200,60,60,0.4);
      border-radius:var(--radius-xl);padding:var(--space-10) var(--space-8);max-width:480px;width:100%;">
      <div style="font-size:3rem;margin-bottom:var(--space-4);">⚠️</div>
      <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:900;color:#f87171;margin-bottom:var(--space-3);">
        Focus Violation!
      </h2>
      <p style="color:rgba(255,255,255,0.75);font-size:1rem;line-height:1.7;margin-bottom:var(--space-5);">
        You left the exam window.<br>
        <strong style="color:white;">Warning ${count} of ${max}</strong> — return immediately or your exam will be cancelled.
      </p>
      <div style="font-size:3.5rem;font-family:var(--font-display);font-weight:900;color:#f87171;margin-bottom:var(--space-3);" id="tabWarnCountdown">${secs}</div>
      <p style="font-size:0.8rem;color:rgba(255,255,255,0.45);margin-bottom:var(--space-6);">seconds to return</p>
      <button onclick="dismissTabWarning()" style="
        padding:12px 36px;background:var(--epsa-green);color:white;border:none;
        border-radius:9999px;font-weight:700;cursor:pointer;font-size:1rem;
        box-shadow:0 4px 16px rgba(26,107,60,0.4);">
        ✅ I'm Back — Continue Exam
      </button>
    </div>`;
}

function dismissTabWarning() {
  if (window._tabWarningTimer) clearInterval(window._tabWarningTimer);
  const warn = document.getElementById('examTabWarning');
  if (warn) warn.remove();
}
window.dismissTabWarning = dismissTabWarning;

function autoDisqualify(reason) {
  examState.submitted = true;
  clearInterval(examState.timerInterval);
  clearInterval(examState.heartbeatInterval);
  if (window._tabWarningTimer) clearInterval(window._tabWarningTimer);
  disableAntiCheat();

  // Try to record the submission with score 0
  try { API.submitExam(examState.examId, examState.answers); } catch(_) {}

  const overlay = document.getElementById('examOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div style="max-width:500px;margin:80px auto;text-align:center;padding:var(--space-8);">
        <div style="font-size:4rem;margin-bottom:var(--space-5);">🚫</div>
        <h2 style="font-family:var(--font-display);font-size:2rem;font-weight:900;color:#f87171;margin-bottom:var(--space-4);">
          Disqualified
        </h2>
        <p style="color:var(--text-muted);font-size:1rem;line-height:1.8;margin-bottom:var(--space-8);">
          ${reason}<br><br>
          Your session has been logged. Please contact your EPSA administrator if you believe this was an error.
        </p>
        <button class="btn btn-primary btn-lg" onclick="closeExam()">← Back to Dashboard</button>
      </div>`;
  }
  document.body.style.overflow = '';
}

// ── SUBMIT EXAM ───────────────────────────────
async function submitExam() {
  if (examState.submitted) return;
  const answered = Object.keys(examState.answers).length;
  const total    = examState.questions.length;
  if (answered < total) {
    const confirmed = window.confirm(`You have answered ${answered}/${total} questions. Submit anyway?`);
    if (!confirmed) return;
  }
  await doSubmitExam();
}
window.submitExam = submitExam;

async function autoSubmitExam() {
  showToast('⏰ Time is up! Auto-submitting…', 'error');
  await doSubmitExam();
}

async function doSubmitExam() {
  examState.submitted = true;
  clearInterval(examState.timerInterval);
  clearInterval(examState.heartbeatInterval);
  disableAntiCheat();

  try {
    await API.submitExam(examState.examId, examState.answers);
  } catch(err) {
    showToast('Failed to submit: ' + err.message, 'error');
  }

  const overlay = document.getElementById('examOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div style="max-width:500px;margin:100px auto;text-align:center;padding:var(--space-8);">
        <div style="width:100px;height:100px;border-radius:50%;background:rgba(26,107,60,0.1);display:flex;align-items:center;justify-content:center;font-size:2.5rem;margin:0 auto var(--space-6);">
          📨
        </div>
        <h2 style="font-family:var(--font-display);font-size:2rem;font-weight:900;margin-bottom:var(--space-3);">Exam Submitted!</h2>
        <div style="font-family:var(--font-display);font-size:2.3rem;font-weight:900;color:var(--epsa-green);margin-bottom:var(--space-3);">Awaiting Admin Review</div>
        <p style="color:var(--text-muted);margin-bottom:var(--space-4);line-height:1.8;">
          Your answers have been saved successfully.<br>
          You answered <strong>${Object.keys(examState.answers).length}</strong> of <strong>${examState.questions.length}</strong> questions.
        </p>
        <p style="color:var(--text-secondary);font-weight:700;margin-bottom:var(--space-8);line-height:1.7;">
          Results stay hidden until the EPSA admin approves and releases them to students.
        </p>
        <button class="btn btn-primary btn-lg" onclick="closeExam()">← Back to Dashboard</button>
      </div>`;
  }
  document.body.style.overflow = '';
}

function closeExam() {
  disablePreviewProtection();
  if (window._previewCountdownInterval) { clearInterval(window._previewCountdownInterval); window._previewCountdownInterval = null; }
  if (window._tabWarningTimer) { clearInterval(window._tabWarningTimer); window._tabWarningTimer = null; }
  if (examState.heartbeatInterval) { clearInterval(examState.heartbeatInterval); examState.heartbeatInterval = null; }
  const overlay = document.getElementById('examOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  disableAntiCheat();
}
window.closeExam = closeExam;

window.getExamState = function getExamState() {
  return examState;
};

function disableAntiCheat() {
  document.removeEventListener('copy',         blockEvent);
  document.removeEventListener('paste',        blockEvent);
  document.removeEventListener('cut',          blockEvent);
  document.removeEventListener('contextmenu',  blockEvent);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur',           handleWindowBlur);
  document.removeEventListener('keydown',      blockDevTools);
  document.removeEventListener('selectstart',  blockSelection);
  document.removeEventListener('dragstart',    blockDrag);
  disablePreviewProtection();
}
