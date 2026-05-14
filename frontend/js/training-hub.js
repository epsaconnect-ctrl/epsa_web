/**
 * EPSA Training Hub — Tabbed interface with premium UI
 */
(function () {
  'use strict';

  let _tid = null, _data = null, _activeTab = 'overview', _selMod = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt(dt) {
    if (!dt) return 'TBA';
    try { return new Date(dt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch { return dt; }
  }

  function progressRingSVG(pct, r) {
    const c = 2 * Math.PI * r;
    const fill = (pct / 100) * c;
    return `<svg width="${r*2+8}" height="${r*2+8}" viewBox="0 0 ${r*2+8} ${r*2+8}">
      <circle cx="${r+4}" cy="${r+4}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="4"/>
      <circle cx="${r+4}" cy="${r+4}" r="${r}" fill="none" stroke="#1a6b3c" stroke-width="4"
        stroke-dasharray="${fill} ${c}" stroke-dashoffset="${c/4}" stroke-linecap="round"
        style="transition:stroke-dasharray 0.6s ease"/>
      <text x="${r+4}" y="${r+4}" text-anchor="middle" dominant-baseline="central"
        fill="#1a6b3c" font-size="${r < 22 ? 9 : 12}" font-weight="800">${pct}%</text>
    </svg>`;
  }

  function ensureShell() {
    let el = document.getElementById('trainingHubOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'trainingHubOverlay';
    el.className = '';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:100020;background:rgba(13,31,18,0.65);backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
    el.innerHTML = `
      <div id="trainingHubPanel" style="max-width:1160px;width:100%;margin:auto;background:#fff;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;max-height:96vh;box-shadow:0 32px 80px rgba(0,0,0,0.28);border:1px solid #e2e8f0;">
        <!-- Header -->
        <div class="th-header">
          <div class="th-header-icon" id="thHeaderIcon">🎓</div>
          <div class="th-title-block">
            <div class="th-title" id="thTitle">Training</div>
            <div class="th-subtitle" id="thSub">EPSA Professional Learning Hub</div>
          </div>
          <div class="th-progress-ring-wrap" id="thProgressRing"></div>
          <button type="button" id="thClose" class="btn btn-ghost btn-sm" style="border-radius:12px;flex-shrink:0;">✕ Close</button>
        </div>
        <!-- Tabs -->
        <div class="th-tabs" id="thTabs">
          <button class="th-tab active" data-tab="overview">📋 Overview</button>
          <button class="th-tab" data-tab="modules">📚 Modules</button>
          <button class="th-tab" data-tab="sessions">📅 Sessions</button>
          <button class="th-tab" data-tab="gallery">🖼 Gallery</button>
          <button class="th-tab" data-tab="discuss">💬 Discussion</button>
          <button class="th-tab" data-tab="cert">🏆 Certificate</button>
        </div>
        <!-- Body -->
        <div class="th-body" id="thBody">
          <div class="th-panel active" id="th-panel-overview"></div>
          <div class="th-panel" id="th-panel-modules"></div>
          <div class="th-panel" id="th-panel-sessions"></div>
          <div class="th-panel" id="th-panel-gallery"></div>
          <div class="th-panel" id="th-panel-discuss"></div>
          <div class="th-panel" id="th-panel-cert"></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) window.closeTrainingHub(); });
    document.getElementById('thClose').onclick = () => window.closeTrainingHub();
    document.getElementById('thTabs').querySelectorAll('.th-tab').forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });
    return el;
  }

  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.th-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.th-panel').forEach(p => p.classList.toggle('active', p.id === `th-panel-${tab}`));
    const renderers = {
      overview: renderOverview,
      modules: renderModules,
      sessions: renderSessions,
      gallery: renderGallery,
      discuss: renderDiscuss,
      cert: renderCert,
    };
    if (renderers[tab]) renderers[tab]();
  }

  function updateHeader() {
    if (!_data) return;
    const t = _data.training || {};
    const comp = _data.completion || {};
    document.getElementById('thTitle').textContent = t.title || 'Training';
    document.getElementById('thHeaderIcon').textContent = t.icon || '🎓';
    const pct = comp.module_total > 0 ? Math.round((comp.modules_completed / comp.module_total) * 100) : 0;
    document.getElementById('thProgressRing').innerHTML = progressRingSVG(pct, 22);

    // Cover image banner: show on hub header if available
    const coverUrl = t.cover_image_url || '';
    const headerEl = document.querySelector('#trainingHubPanel .th-header');
    if (headerEl) {
      if (coverUrl) {
        headerEl.style.backgroundImage = `url('${coverUrl}')`;
        headerEl.style.backgroundSize = 'cover';
        headerEl.style.backgroundPosition = 'center';
        headerEl.style.position = 'relative';
        headerEl.style.color = '#fff';
        if (!headerEl.querySelector('.th-header-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'th-header-overlay';
          overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,rgba(13,31,18,0.7),rgba(13,31,18,0.45));border-radius:inherit;z-index:0;';
          headerEl.insertBefore(overlay, headerEl.firstChild);
          headerEl.querySelectorAll(':scope > *:not(.th-header-overlay)').forEach(c => c.style.position = 'relative');
        }
        document.getElementById('thHeaderIcon').style.display = 'none';
      } else {
        headerEl.style.backgroundImage = '';
        document.getElementById('thHeaderIcon').style.display = '';
        document.getElementById('thHeaderIcon').textContent = t.icon || '🎓';
      }
    }
  }

  /* ─── OVERVIEW ─────────────────────────────── */
  function renderOverview() {
    const el = document.getElementById('th-panel-overview');
    if (!el || !_data) return;
    const t = _data.training || {};
    const comp = _data.completion || {};
    const pre = _data.pre_exam;
    const post = _data.post_exam;
    const ann = (_data.announcements || []).slice(0, 3);

    const examBtn = (label, ex) => {
      if (!ex || !ex.exam_id) return '';
      // Distinguish Exam Center vs Mock Exam
      const isRealExam = ex.exam_type === 'exam' || ex.exam_type === 'legacy';
      const isMock = ex.exam_type === 'mock';
      const st = ex.submission_status || ex.status || 'not_started';
      const stLabel = st === 'not_started' ? 'Not started' : st === 'submitted' ? 'Submitted' : st.replace('_',' ');
      const scoreChip = ex.score !== null && ex.score !== undefined
        ? `<span style="background:${ex.passed?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.10)'};color:${ex.passed?'#16a34a':'#dc2626'};padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:800;">${ex.passed?'✓ Passed':'✗ Below pass'} · ${ex.score.toFixed(1)}%</span>`
        : `<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:999px;font-size:0.72rem;font-weight:800;">${stLabel}</span>`;
      const examTypeTag = isRealExam
        ? `<span style="font-size:0.68rem;background:rgba(37,99,235,0.1);color:#2563eb;padding:2px 8px;border-radius:99px;font-weight:700;">📝 Exam Center</span>`
        : `<span style="font-size:0.68rem;background:rgba(245,158,11,0.12);color:#d97706;padding:2px 8px;border-radius:99px;font-weight:700;">🎯 Practice</span>`;
      return `<div class="th-exam-row">
        <div style="flex:1;">
          <div class="th-exam-label">${label} ${examTypeTag}</div>
          <div class="th-exam-status">${esc(ex.title||'Assessment')}</div>
          <div style="margin-top:5px;">${scoreChip}</div>
        </div>
        <button class="btn btn-primary btn-sm th-open-exam" data-eid="${ex.exam_id}" data-type="${isRealExam?'exam':'mock'}" data-title="${esc(ex.title||'Exam')}" style="border-radius:10px;flex-shrink:0;">Take ${st==='not_started'?'Exam':'Retake'} →</button>
      </div>`;
    };

    const pct = comp.module_total > 0 ? Math.round((comp.modules_completed / comp.module_total) * 100) : 0;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <!-- Left col -->
        <div style="display:flex;flex-direction:column;gap:14px;">
          <!-- Progress -->
          <div class="th-overview-card" style="background:linear-gradient(135deg,rgba(13,61,33,0.06),rgba(200,163,64,0.04));">
            <h4>Your Progress</h4>
            <div style="display:flex;align-items:center;gap:14px;">
              ${progressRingSVG(pct, 32)}
              <div>
                <div style="font-weight:800;font-size:1rem;">${comp.modules_completed||0} / ${comp.module_total||0} Modules</div>
                <div style="font-size:0.78rem;color:#64748b;margin-top:3px;">${comp.certificate_eligible ? '✅ Eligible for certificate' : 'Complete all modules to earn your certificate'}</div>
              </div>
            </div>
            <div class="training-progress-bar" style="margin-top:12px;">
              <div class="training-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <!-- Assessments -->
          <div class="th-overview-card">
            <h4>Assessments</h4>
            ${examBtn('Pre-test', pre) || '<div style="color:#94a3b8;font-size:0.82rem;">No pre-test linked.</div>'}
            ${examBtn('Post-test', post) || '<div style="color:#94a3b8;font-size:0.82rem;">No post-test linked.</div>'}
          </div>
          <!-- About -->
          <div class="th-overview-card">
            <h4>About This Training</h4>
            <p style="font-size:0.85rem;color:#475569;line-height:1.7;">${esc(t.description || 'No description provided.')}</p>
            ${t.instructor_display_name ? `<div style="margin-top:10px;font-size:0.8rem;"><strong>Instructor:</strong> ${esc(t.instructor_display_name)}</div>` : ''}
            ${t.format ? `<div style="font-size:0.8rem;margin-top:4px;"><strong>Format:</strong> ${esc(t.format)}</div>` : ''}
          </div>
        </div>
        <!-- Right col -->
        <div style="display:flex;flex-direction:column;gap:14px;">
          <!-- Announcements -->
          <div class="th-overview-card">
            <h4>Announcements</h4>
            ${ann.length ? ann.map(a => `
              <div style="padding:10px;background:white;border-radius:10px;border:1px solid #f1f5f9;margin-bottom:8px;">
                <div style="font-weight:700;font-size:0.85rem;">${a.pinned ? '📌 ' : ''}${esc(a.title)}</div>
                <div style="font-size:0.8rem;color:#475569;margin-top:3px;white-space:pre-wrap;">${esc(a.body||'')}</div>
              </div>`).join('') : '<div style="color:#94a3b8;font-size:0.82rem;">No announcements yet.</div>'}
          </div>
          <!-- Quick nav -->
          <div class="th-overview-card">
            <h4>Quick Navigation</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${[['modules','📚','Modules'],['sessions','📅','Sessions'],['gallery','🖼','Gallery'],['discuss','💬','Discuss']].map(([tab,icon,label])=>
                `<button class="btn btn-ghost btn-sm th-quick-nav" data-tab="${tab}" style="border:1px solid #e2e8f0;border-radius:12px;justify-content:flex-start;gap:8px;">${icon} ${label}</button>`
              ).join('')}
            </div>
          </div>
        </div>
      </div>`;

    el.querySelectorAll('.th-open-exam').forEach(b => {
      b.onclick = () => {
        const eid = parseInt(b.dataset.eid, 10);
        const title = b.dataset.title || 'Exam';
        const isRealExam = b.dataset.type === 'exam';
        window.closeTrainingHub();
        if (isRealExam) {
          // Route to Exam Center (the real exam section)
          if (typeof switchSection === 'function') switchSection('exams');
          setTimeout(() => {
            if (typeof takeExam === 'function') takeExam(eid, title, 60);
            else if (typeof showToast === 'function') showToast(`Opening exam: ${title}`, 'info');
          }, 300);
        } else {
          // Route to Mock Exams section
          if (typeof switchSection === 'function') switchSection('mock-exams');
          setTimeout(() => {
            if (typeof loadMockExams === 'function') loadMockExams();
            if (typeof showToast === 'function') showToast(`Opening practice: ${title}`, 'info');
          }, 300);
        }
      };
    });
    el.querySelectorAll('.th-quick-nav').forEach(b => {
      b.onclick = () => switchTab(b.dataset.tab);
    });
  }

  /* ─── MODULES ──────────────────────────────── */
  function renderModules() {
    const el = document.getElementById('th-panel-modules');
    if (!el || !_data) return;
    const mods = _data.modules || [];
    if (!mods.length) {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">No modules published yet.</div>';
      return;
    }
    el.innerHTML = `
      <div style="margin-bottom:14px;font-size:0.82rem;color:#64748b;">${mods.length} module${mods.length!==1?'s':''} · Click to study</div>
      <div class="th-module-list">${mods.map((m,i) => {
        const done = m.progress && m.progress.completed_at;
        return `<div class="th-module-item${done?' completed':''}" data-mid="${m.id}">
          <div class="th-module-num">${done ? '✓' : i+1}</div>
          <div class="th-module-info">
            <div class="th-module-title">${esc(m.title)}</div>
            <div class="th-module-meta">${m.estimated_mins ? m.estimated_mins+' min' : ''}${done ? ' · Completed' : ''}</div>
          </div>
          ${done ? '<span class="th-module-check">✅</span>' : '<span style="color:#cbd5e1;">›</span>'}
        </div>`;
      }).join('')}</div>`;
    el.querySelectorAll('.th-module-item').forEach(row => {
      row.onclick = () => {
        const mid = parseInt(row.dataset.mid, 10);
        const mod = mods.find(x => x.id === mid);
        if (mod) renderModuleViewer(mod);
      };
    });
  }

  async function renderModuleViewer(mod) {
    const el = document.getElementById('th-panel-modules');
    el.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;">Loading…</div>';
    try {
      const d = await API.getTrainingModule(_tid, mod.id);
      const m = d.module || {};
      const quiz = d.quiz;
      const prog = d.progress || {};
      let quizHtml = '';
      if (quiz && (quiz.questions||[]).length) {
        const qs = quiz.questions.map((q,qi) => `
          <div class="th-quiz-q">
            <div class="th-quiz-q-text">${qi+1}. ${esc(q.question)}</div>
            ${(q.options||[]).map((o,oi) => `<label class="th-quiz-option"><input type="radio" name="pq_${qi}" value="${oi}"/><span>${esc(o)}</span></label>`).join('')}
          </div>`).join('');
        quizHtml = `
          <div class="th-quiz-block">
            <div class="th-quiz-title">🧠 ${esc(quiz.title||'Knowledge Check')}</div>
            <div style="font-size:0.76rem;color:#64748b;margin-bottom:12px;">Pass ${quiz.pass_percent||70}% to complete this module.</div>
            ${qs}
            <button class="btn btn-primary" id="thQuizSubmit" style="margin-top:12px;">Submit Quiz</button>
            ${prog.quiz_score!=null?`<div style="margin-top:10px;font-size:0.82rem;">Last score: <strong>${prog.quiz_score}%</strong> ${prog.quiz_passed?'✅':'— retry'}</div>`:''}
          </div>`;
      }
      el.innerHTML = `
        <button class="th-module-back" id="thModBack">← All Modules</button>
        <h2 style="font-family:var(--font-display,'Outfit',sans-serif);font-size:1.3rem;font-weight:900;margin-bottom:8px;">${esc(m.title)}</h2>
        <p style="color:#64748b;font-size:0.88rem;margin-bottom:16px;">${esc(m.summary||'')}</p>
        ${m.video_url?`<div style="margin-bottom:16px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;"><iframe src="${esc(m.video_url)}" style="width:100%;height:220px;border:0;" allowfullscreen></iframe></div>`:''}
        <div class="th-module-content">${m.content_html||''}</div>
        ${quizHtml}
        <div style="margin-top:20px;display:flex;gap:10px;">
          <button class="btn btn-primary" id="thMarkComplete">✓ Mark Complete</button>
        </div>`;
      document.getElementById('thModBack').onclick = () => renderModules();
      const qsub = document.getElementById('thQuizSubmit');
      if (qsub) qsub.onclick = async () => {
        const answers = (quiz.questions||[]).map((_,qi) => {
          const p = el.querySelector(`input[name="pq_${qi}"]:checked`);
          return p ? parseInt(p.value,10) : -1;
        });
        try {
          const r = await API.submitTrainingPopQuiz(_tid, mod.id, answers);
          if (typeof showToast === 'function') showToast(`Quiz: ${r.score}% ${r.passed?'— Passed!':''}`, r.passed?'success':'gold');
          await refreshHub();
          renderModuleViewer(_data.modules.find(x=>x.id===mod.id));
        } catch(e) { if (typeof showToast==='function') showToast(e.message||'Failed','error'); }
      };
      document.getElementById('thMarkComplete').onclick = async () => {
        try {
          await API.completeTrainingModule(_tid, mod.id);
          if (typeof showToast==='function') showToast('Module completed!','success');
          await refreshHub();
          renderModuleViewer(_data.modules.find(x=>x.id===mod.id));
          updateHeader();
        } catch(e) { if (typeof showToast==='function') showToast(e.message||'Failed','error'); }
      };
    } catch(e) {
      el.innerHTML = `<button class="th-module-back" onclick="renderModules()">← Back</button><div style="color:#b91c1c;padding:20px;">${esc(e.message)}</div>`;
    }
  }

  /* ─── SESSIONS ─────────────────────────────── */
  function renderSessions() {
    const el = document.getElementById('th-panel-sessions');
    if (!el || !_data) return;
    const sess = _data.sessions || [];
    if (!sess.length) {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">No sessions scheduled yet.</div>';
      return;
    }
    const now = Date.now();
    el.innerHTML = sess.map(s => {
      const start = s.starts_at ? new Date(s.starts_at) : null;
      const isUpcoming = start && start.getTime() > now;
      const dotClass = isUpcoming ? 'upcoming' : 'past';
      return `<div class="th-session-card">
        <div class="th-session-dot ${dotClass}"></div>
        <div style="flex:1;">
          <div class="th-session-title">${esc(s.title)}</div>
          <div class="th-session-time">${fmt(s.starts_at)}${s.ends_at?' – '+fmt(s.ends_at):''} · ${esc(s.session_type||'live')}</div>
          ${s.notes ? `<div style="font-size:0.8rem;color:#64748b;margin-top:4px;">${esc(s.notes)}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${s.meet_url ? `<a href="${esc(s.meet_url)}" target="_blank" rel="noopener" class="th-session-meet">📹 Join Meeting</a>` : ''}
            ${s.recording_url ? `<a href="${esc(s.recording_url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#f1f5f9;color:#1e293b;border-radius:999px;font-size:0.78rem;font-weight:700;text-decoration:none;">▶ Recording</a>` : ''}
          </div>
        </div>
        ${isUpcoming ? '<span style="padding:4px 10px;background:rgba(37,99,235,0.1);color:#2563eb;border-radius:999px;font-size:0.7rem;font-weight:800;">UPCOMING</span>' : ''}
      </div>`;
    }).join('');
  }

  /* ─── GALLERY ──────────────────────────────── */
  function renderGallery() {
    const el = document.getElementById('th-panel-gallery');
    if (!el || !_data) return;
    const gal = _data.gallery || [];
    if (!gal.length) {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:#94a3b8;">No gallery items yet.</div>';
      return;
    }
    el.innerHTML = `<div class="th-gallery-grid">${gal.map(g => {
      const u = g.url || g.path || '';
      if (g.kind === 'video') return `<div class="th-gallery-item"><video src="${esc(u)}" controls style="width:100%;height:120px;object-fit:cover;border:0;"></video><div class="th-gallery-caption">${esc(g.caption||'Video')}</div></div>`;
      return `<div class="th-gallery-item"><img src="${esc(u)}" alt="${esc(g.caption||'')}"/><div class="th-gallery-caption">${esc(g.caption||g.description||'')}</div></div>`;
    }).join('')}</div>`;
  }

  /* ─── DISCUSSION ───────────────────────────── */
  async function renderDiscuss() {
    const el = document.getElementById('th-panel-discuss');
    if (!el) return;
    el.innerHTML = `
      <div class="th-discuss-list" id="thDiscussList"><div style="color:#94a3b8;font-size:0.82rem;padding:8px;">Loading…</div></div>
      <textarea id="thDiscussInput" class="form-input" rows="3" placeholder="Ask a question or share a reflection…" style="width:100%;box-sizing:border-box;margin-bottom:8px;margin-top:4px;"></textarea>
      <button class="btn btn-primary btn-sm" id="thDiscussPost">Post</button>`;
    await loadDiscuss();
    document.getElementById('thDiscussPost').onclick = async () => {
      const ta = document.getElementById('thDiscussInput');
      const txt = (ta?.value||'').trim();
      if (!txt) return;
      try {
        await API.postTrainingDiscussion(_tid, txt, null);
        ta.value = '';
        await loadDiscuss();
      } catch(e) { if(typeof showToast==='function') showToast(e.message||'Failed','error'); }
    };
  }

  async function loadDiscuss() {
    const box = document.getElementById('thDiscussList');
    if (!box) return;
    try {
      const d = await API.getTrainingDiscussions(_tid);
      const posts = d.posts || [];
      box.innerHTML = posts.length ? posts.map(p => `
        <div class="th-discuss-post">
          <div class="th-discuss-author">${esc(p.author_name)} <span class="th-discuss-time">${fmt(p.created_at)}</span></div>
          <div class="th-discuss-body">${esc(p.body)}</div>
        </div>`).join('') : '<div style="color:#94a3b8;font-size:0.82rem;padding:8px;">No posts yet — start the conversation.</div>';
    } catch { box.innerHTML = '<div style="color:#b91c1c;font-size:0.82rem;">Could not load discussion.</div>'; }
  }

  /* ─── CERTIFICATE ──────────────────────────── */
  function renderCert() {
    const el = document.getElementById('th-panel-cert');
    if (!el || !_data) return;
    const cert = _data.certificate;
    const comp = _data.completion || {};
    const t = _data.training || {};
    el.innerHTML = `
      <div class="th-cert-preview">
        <div class="th-cert-icon">🏆</div>
        <div class="th-cert-title">${esc(t.cert_title || 'Certificate of Completion')}</div>
        <div class="th-cert-subtitle">${esc(t.cert_desc || 'Ethiopian Psychology Students Association')}</div>
      </div>
      ${cert
        ? `<div style="text-align:center;">
            <div style="font-size:0.85rem;color:#059669;font-weight:700;margin-bottom:12px;">✅ Certificate issued · Code: ${esc(cert.cert_code)}</div>
            <button class="btn btn-primary" id="thDlCert">View / Print Certificate</button>
           </div>`
        : `<div style="text-align:center;padding:20px;">
            <div style="font-size:0.9rem;color:#64748b;margin-bottom:12px;">
              ${comp.certificate_eligible
                ? '✅ You meet the requirements. Your certificate is being processed.'
                : 'Complete all modules and required assessments to unlock your certificate.'}
            </div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
              <span style="padding:6px 14px;border-radius:999px;background:${comp.modules_completed===comp.module_total?'rgba(5,150,105,0.1)':'#f1f5f9'};color:${comp.modules_completed===comp.module_total?'#059669':'#64748b'};font-size:0.8rem;font-weight:700;">
                Modules ${comp.modules_completed||0}/${comp.module_total||0}
              </span>
            </div>
           </div>`}`;
    const dl = document.getElementById('thDlCert');
    if (dl) dl.onclick = async () => {
      try {
        const url = await API.getTrainingCertificateBlobUrl(_tid);
        window.open(url,'_blank','noopener');
      } catch(e) { if(typeof showToast==='function') showToast(e.message||'Certificate unavailable','error'); }
    };
  }

  async function refreshHub() {
    _data = await API.getTrainingLearn(_tid);
  }

  window.openTrainingHub = async function(tid) {
    _tid = tid;
    const shell = ensureShell();
    shell.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    try {
      await refreshHub();
      updateHeader();
      switchTab('overview');
    } catch(e) {
      if (typeof showToast==='function') showToast(e.message||'Could not open training','error');
      shell.style.display = 'none';
      document.body.style.overflow = '';
    }
  };

  window.closeTrainingHub = function() {
    const shell = document.getElementById('trainingHubOverlay');
    if (shell) shell.style.display = 'none';
    document.body.style.overflow = '';
    _tid = null; _data = null; _activeTab = 'overview'; _selMod = null;
  };
})();

/* ════════════════════════════════════════════════════════
   GLOBAL: Student Training Grid — Beautiful Card Renderer
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  let _allTrainings = [];

  window.filterTrainings = function(mode, btn) {
    document.querySelectorAll('.pill-tab').forEach(b => b.classList.toggle('active', b === btn));
    _renderGrid(mode === 'mine'
      ? _allTrainings.filter(t => t.status && t.status !== 'open')
      : mode === 'free'
      ? _allTrainings.filter(t => t.is_free || +t.price === 0)
      : _allTrainings);
  };

  window.searchTrainings = function(q) {
    const lq = (q || '').toLowerCase();
    _renderGrid(!lq ? _allTrainings : _allTrainings.filter(t =>
      (t.title || '').toLowerCase().includes(lq) ||
      (t.description || '').toLowerCase().includes(lq) ||
      (t.instructor_display_name || '').toLowerCase().includes(lq)
    ));
  };

  function _statusChip(status) {
    const map = {
      open:       ['Enroll',      '#f1f5f9', '#475569'],
      pending:    ['⏳ Pending',  'rgba(217,119,6,0.10)', '#d97706'],
      receipt:    ['🧾 Receipt',  'rgba(124,58,237,0.10)', '#7c3aed'],
      approved:   ['✅ Approved', 'rgba(5,150,105,0.10)', '#059669'],
      registered: ['🎓 Enrolled', 'rgba(26,107,60,0.12)', '#1a6b3c'],
      rejected:   ['✗ Rejected', 'rgba(220,38,38,0.08)', '#dc2626'],
    };
    const [label, bg, color] = map[status] || ['Unknown', '#f1f5f9', '#64748b'];
    return { label, bg, color };
  }

  function _renderGrid(list) {
    const grid = document.getElementById('trainingGrid');
    if (!grid) return;
    if (!list || !list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#94a3b8;">
        <div style="font-size:2.5rem;margin-bottom:12px;">🎓</div>
        <div style="font-size:1rem;font-weight:700;color:#475569;">No training programs found</div>
        <div style="font-size:0.85rem;margin-top:6px;">Check back soon for new programs.</div>
      </div>`;
      return;
    }
    grid.innerHTML = list.map(t => {
      const { label, bg, color } = _statusChip(t.status || 'open');
      const pct = t.module_count > 0 && t.modules_completed > 0
        ? Math.round((t.modules_completed / t.module_count) * 100) : 0;
      const canOpen = t.status === 'registered';
      const canApply = !t.status || t.status === 'open';
      const needsReceipt = t.status === 'approved' && !t.is_free && +t.price > 0;
      return `
        <div class="training-card" style="cursor:${canOpen?'pointer':'default'};"
          ${canOpen ? `onclick="window.openTrainingHub(${t.id})"` : ''}>
          <div class="training-card-banner" style="position:relative;">
            <div class="training-card-icon">${esc(t.icon || '🎓')}</div>
            <span class="training-card-status-badge" style="background:${bg};color:${color};">${label}</span>
          </div>
          <div class="training-card-body">
            <div class="training-card-title">${esc(t.title)}</div>
            ${t.instructor_display_name ? `<div style="font-size:0.76rem;color:#64748b;">👤 ${esc(t.instructor_display_name)}</div>` : ''}
            <p class="training-card-desc">${esc((t.description||'').slice(0,110))}${(t.description||'').length>110?'…':''}</p>
            <div class="training-card-meta">
              <span>${esc(t.format || 'online')}</span>
              <span>·</span>
              <span>${t.is_free || +t.price === 0 ? '🆓 Free' : 'ETB '+(+t.price||0).toLocaleString()}</span>
              ${t.module_count ? `<span>·</span><span>${t.module_count} modules</span>` : ''}
            </div>
            ${canOpen && t.module_count > 0 ? `
              <div>
                <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#64748b;margin-bottom:4px;">
                  <span>Progress</span><span>${pct}%</span>
                </div>
                <div class="training-progress-bar">
                  <div class="training-progress-fill" style="width:${pct}%;"></div>
                </div>
              </div>` : ''}
            <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
              ${canOpen ? `<button class="btn btn-primary btn-sm" style="border-radius:10px;flex:1;" onclick="event.stopPropagation();window.openTrainingHub(${t.id})">Open Learning Hub →</button>` : ''}
              ${canApply ? `<button class="btn btn-primary btn-sm" style="border-radius:10px;flex:1;" onclick="event.stopPropagation();applyTraining(${t.id})">Enroll Now</button>` : ''}
              ${needsReceipt ? `<button class="btn btn-sm" style="border-radius:10px;background:#7c3aed;color:white;border:none;flex:1;" onclick="event.stopPropagation();openReceiptUpload(${t.id},${t.application_id})">Upload Receipt</button>` : ''}
              ${t.status==='pending' ? `<span style="font-size:0.78rem;color:#d97706;align-self:center;">Under review…</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // Called by dashboard.js — override the global loadTrainings
  const _origLoad = window.loadTrainings;
  window.loadTrainings = async function() {
    if (_origLoad) { await _origLoad(); return; }
    try {
      const list = await API.getTrainings();
      _allTrainings = Array.isArray(list) ? list : [];
      _renderGrid(_allTrainings);
      // Update stats banner
      const enrolled = _allTrainings.filter(t => t.status === 'registered').length;
      const certs = _allTrainings.filter(t => t.has_certificate).length;
      const se = document.getElementById('th-stat-enrolled');
      const sc = document.getElementById('th-stat-certs');
      if (se) se.textContent = enrolled;
      if (sc) sc.textContent = certs;
    } catch(e) {
      const grid = document.getElementById('trainingGrid');
      if (grid) grid.innerHTML = `<div style="color:#dc2626;padding:24px;">${e.message||'Failed to load trainings'}</div>`;
    }
  };

  // Hook: when section switches to trainings, load them
  const _prevSwitch = window.switchSection;
  window.switchSection = function(name) {
    if (_prevSwitch) _prevSwitch(name);
    if (name === 'trainings') window.loadTrainings();
  };
})();
