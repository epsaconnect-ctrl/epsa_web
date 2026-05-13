/**
 * EPSA Training Hub — Khan-style module viewer, pop quizzes, pre/post exam links, discussions.
 */
(function () {
  'use strict';

  let _tid = null;
  let _data = null;
  let _selMod = null;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureShell() {
    let el = document.getElementById('trainingHubOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'trainingHubOverlay';
    el.style.cssText =
      'display:none;position:fixed;inset:0;z-index:100020;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);align-items:stretch;justify-content:center;padding:12px;box-sizing:border-box;';
    el.innerHTML = `
      <div id="trainingHubPanel" style="max-width:1100px;width:100%;margin:auto;background:var(--surface,#fff);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;max-height:96vh;box-shadow:0 24px 80px rgba(0,0,0,.2);border:1px solid var(--light-200,#e2e8f0);">
        <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--light-200,#e2e8f0);background:linear-gradient(135deg,rgba(26,107,60,.08),transparent);">
          <div style="flex:1;min-width:0;">
            <div id="thTitle" style="font-family:var(--font-display,system-ui);font-weight:900;font-size:1.1rem;color:#0f172a;">Training</div>
            <div id="thSub" style="font-size:.78rem;color:var(--text-muted,#64748b);margin-top:2px;"></div>
          </div>
          <button type="button" id="thClose" class="btn btn-ghost btn-sm" style="border-radius:10px;">✕ Close</button>
        </div>
        <div style="display:flex;flex:1;min-height:0;">
          <aside id="thSidebar" style="width:280px;min-width:220px;border-right:1px solid var(--light-200,#e2e8f0);overflow-y:auto;background:#f8fafc;padding:10px;"></aside>
          <main id="thMain" style="flex:1;overflow-y:auto;padding:16px 18px;min-width:0;"></main>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el) window.closeTrainingHub();
    });
    document.getElementById('thClose').onclick = () => window.closeTrainingHub();
    return el;
  }

  async function renderModule(mod) {
    _selMod = mod;
    const main = document.getElementById('thMain');
    if (!main || !mod) return;
    main.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b">Loading module…</div>';
    try {
      const d = await API.getTrainingModule(_tid, mod.id);
      const m = d.module || {};
      const quiz = d.quiz;
      const prog = d.progress || {};
      const html = m.content_html || '';
      let quizBlock = '';
      if (quiz && quiz.questions && quiz.questions.length) {
        const qs = quiz.questions
          .map((q, qi) => {
            const opts = (q.options || [])
              .map(
                (o, oi) =>
                  `<label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer;font-size:.88rem;">
              <input type="radio" name="pq_${qi}" value="${oi}"/>
              <span>${esc(o)}</span>
            </label>`
              )
              .join('');
            return `<div style="margin-bottom:16px;padding:12px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;">
            <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">${esc(q.question)}</div>${opts}</div>`;
          })
          .join('');
        quizBlock = `
          <div style="margin-top:20px;padding:16px;border-radius:16px;border:1px solid rgba(26,107,60,.25);background:rgba(26,107,60,.04);">
            <div style="font-weight:900;margin-bottom:10px;color:#14532d;">🧠 ${esc(quiz.title || 'Knowledge check')}</div>
            <div style="font-size:.78rem;color:#64748b;margin-bottom:12px;">Score at least ${quiz.pass_percent || 70}% to mark this module complete.</div>
            ${qs}
            <button type="button" class="btn btn-primary" id="thQuizSubmit" style="margin-top:12px;">Submit quiz</button>
            ${
              prog.quiz_score != null
                ? `<div style="margin-top:10px;font-size:.85rem;">Last attempt: <strong>${prog.quiz_score}%</strong> ${
                    prog.quiz_passed ? '✅ Passed' : '— retry if needed'
                  }</div>`
                : ''
            }
          </div>`;
      }
      main.innerHTML = `
        <h2 style="margin:0 0 8px;font-size:1.25rem;font-weight:900;color:#0f172a;">${esc(m.title)}</h2>
        <p style="color:#475569;font-size:.9rem;line-height:1.6;margin:0 0 16px;">${esc(m.summary || '')}</p>
        ${m.video_url ? `<div style="margin-bottom:16px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;"><iframe src="${esc(m.video_url)}" style="width:100%;height:220px;border:0;" allowfullscreen></iframe></div>` : ''}
        <article class="th-content" style="font-size:.95rem;line-height:1.75;color:#1e293b;">${html}</article>
        ${quizBlock}
        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-gold" id="thMarkComplete">Mark module complete</button>
        </div>`;
      const qsub = document.getElementById('thQuizSubmit');
      if (qsub) {
        qsub.onclick = async () => {
          const answers = [];
          (quiz.questions || []).forEach((_, qi) => {
            const picked = main.querySelector(`input[name="pq_${qi}"]:checked`);
            answers.push(picked ? parseInt(picked.value, 10) : -1);
          });
          try {
            const r = await API.submitTrainingPopQuiz(_tid, mod.id, answers);
            if (typeof showToast === 'function') showToast(`Quiz: ${r.score}% ${r.passed ? '— passed' : ''}`, r.passed ? 'success' : 'gold');
            await refreshHub();
            await renderModule(_data.modules.find((x) => x.id === mod.id));
          } catch (e) {
            if (typeof showToast === 'function') showToast(e.message || 'Quiz failed', 'error');
          }
        };
      }
      document.getElementById('thMarkComplete').onclick = async () => {
        try {
          await API.completeTrainingModule(_tid, mod.id);
          if (typeof showToast === 'function') showToast('Module marked complete', 'success');
          await refreshHub();
          renderSidebar();
          await renderModule(_data.modules.find((x) => x.id === mod.id));
        } catch (e) {
          if (typeof showToast === 'function') showToast(e.message || 'Could not complete', 'error');
        }
      };
    } catch (e) {
      main.innerHTML = `<div style="color:#b91c1c;padding:20px;">${esc(e.message)}</div>`;
    }
  }

  function renderSidebar() {
    const sb = document.getElementById('thSidebar');
    if (!sb || !_data) return;
    const mods = _data.modules || [];
    const comp = _data.completion || {};
    sb.innerHTML = `
      <button type="button" id="thNavOverview" style="width:100%;text-align:left;padding:10px 12px;margin-bottom:8px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;font:inherit;font-weight:800;cursor:pointer;">📋 Overview & schedule</button>
      <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:#64748b;letter-spacing:.08em;padding:6px 8px;">Modules</div>
      ${mods
        .map((m) => {
          const done = m.progress && m.progress.completed_at;
          return `<button type="button" class="th-mod-btn" data-mid="${m.id}" style="width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border-radius:12px;border:1px solid ${done ? 'rgba(34,197,94,.35)' : '#e2e8f0'};background:${done ? 'rgba(34,197,94,.08)' : '#fff'};cursor:pointer;font:inherit;">
          <div style="font-weight:800;font-size:.86rem;color:#0f172a;">${done ? '✓ ' : ''}${esc(m.title)}</div>
          <div style="font-size:.72rem;color:#64748b;margin-top:4px;">${m.estimated_mins ? m.estimated_mins + ' min' : ''}</div>
        </button>`;
        })
        .join('')}
      <div style="margin-top:14px;padding:10px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;font-size:.78rem;color:#9a3412;">
        Progress: <strong>${comp.modules_completed || 0}</strong> / <strong>${comp.module_total || 0}</strong> modules
      </div>`;
    sb.querySelectorAll('.th-mod-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = parseInt(btn.getAttribute('data-mid'), 10);
        const mod = mods.find((x) => x.id === id);
        renderModule(mod);
      };
    });
    const ov = document.getElementById('thNavOverview');
    if (ov) ov.onclick = () => renderOverview();
  }

  function renderOverview() {
    const main = document.getElementById('thMain');
    if (!main || !_data) return;
    const t = _data.training || {};
    const ann = _data.announcements || [];
    const sess = _data.sessions || [];
    const gal = _data.gallery || [];
    const pre = _data.pre_exam;
    const post = _data.post_exam;
    const cert = _data.certificate;
    const comp = _data.completion || {};

    const examBtn = (label, ex) => {
      if (!ex || !ex.exam_id) return '';
      const title = esc(ex.title || 'Assessment');
      const st = ex.submission_status || 'not_started';
      return `<div style="padding:12px;border-radius:14px;border:1px solid #e2e8f0;margin-bottom:10px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;">
        <div><div style="font-weight:800;">${label}</div><div style="font-size:.78rem;color:#64748b;">${title} · ${st.replace('_', ' ')}</div></div>
        <button type="button" class="btn btn-primary btn-sm th-open-exam" data-eid="${ex.exam_id}" data-title="${title}">Open in Exams →</button>
      </div>`;
    };

    main.innerHTML = `
      <div style="display:grid;gap:14px;">
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Assessments (EPSA Exams)</h3>
          ${examBtn('Pre-test', pre)}
          ${examBtn('Post-test', post)}
        </section>
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Live schedule & sessions</h3>
          ${
            sess.length
              ? sess
                  .map(
                    (s) => `<div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:8px;font-size:.86rem;">
              <strong>${esc(s.title)}</strong> · ${esc(s.session_type || '')}<br/>
              <span style="color:#64748b;">${esc(s.starts_at || 'TBA')} ${s.ends_at ? '– ' + esc(s.ends_at) : ''}</span><br/>
              ${s.meet_url ? `<a href="${esc(s.meet_url)}" target="_blank" rel="noopener" style="color:#2563eb;font-weight:700;">Google Meet / join link</a>` : ''}
              ${s.recording_url ? `<div style="margin-top:6px;"><a href="${esc(s.recording_url)}" target="_blank" rel="noopener">Recording</a></div>` : ''}
            </div>`
                  )
                  .join('')
              : '<p style="color:#64748b;font-size:.88rem;">Sessions will appear here when published.</p>'
          }
        </section>
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Announcements</h3>
          ${
            ann.length
              ? ann
                  .map(
                    (a) => `<div style="padding:10px 12px;background:#f8fafc;border-radius:12px;margin-bottom:8px;">
              <div style="font-weight:800;">${esc(a.title)}</div>
              <div style="font-size:.85rem;color:#475569;white-space:pre-wrap;">${esc(a.body || '')}</div>
            </div>`
                  )
                  .join('')
              : '<p style="color:#64748b;font-size:.88rem;">No announcements yet.</p>'
          }
        </section>
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Gallery</h3>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${gal
              .map((g) => {
                const u = g.url || '';
                if ((g.kind || '') === 'video')
                  return `<div style="width:200px;"><div style="font-size:.72rem;font-weight:700;margin-bottom:4px;">${esc(g.caption || 'Video')}</div><video src="${esc(u)}" controls style="width:100%;border-radius:12px;max-height:140px;background:#000;"></video></div>`;
                return `<div style="width:140px;"><img src="${esc(u)}" alt="" style="width:100%;height:100px;object-fit:cover;border-radius:12px;border:1px solid #e2e8f0;"/><div style="font-size:.7rem;color:#64748b;margin-top:4px;">${esc(g.description || g.caption || '')}</div></div>`;
              })
              .join('') || '<span style="color:#64748b;font-size:.88rem;">No media yet.</span>'}
          </div>
        </section>
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Certificate</h3>
          <p style="font-size:.85rem;color:#475569;">${comp.certificate_eligible ? 'You have met completion requirements.' : 'Complete modules and required exams to unlock your certificate.'}</p>
          ${
            cert
              ? `<button type="button" class="btn btn-outline-green" id="thDlCert">View / print certificate</button>`
              : ''
          }
        </section>
        <section>
          <h3 style="margin:0 0 10px;font-size:1rem;font-weight:900;">Discussion</h3>
          <div id="thDiscussList" style="max-height:200px;overflow:auto;margin-bottom:10px;border:1px solid #e2e8f0;border-radius:12px;padding:8px;background:#fafafa;"></div>
          <textarea id="thDiscussInput" class="form-input" rows="2" placeholder="Ask a question or share a reflection…" style="width:100%;box-sizing:border-box;margin-bottom:8px;"></textarea>
          <button type="button" class="btn btn-primary btn-sm" id="thDiscussSend">Post</button>
        </section>
      </div>`;
    main.querySelectorAll('.th-open-exam').forEach((b) => {
      b.onclick = () => {
        const eid = parseInt(b.getAttribute('data-eid'), 10);
        const title = b.getAttribute('data-title') || 'Exam';
        window.closeTrainingHub();
        if (typeof switchSection === 'function') switchSection('exams');
        if (typeof takeExam === 'function') takeExam(eid, title, 60);
      };
    });
    const dl = document.getElementById('thDlCert');
    if (dl) {
      dl.onclick = async () => {
        try {
          const url = await API.getTrainingCertificateBlobUrl(_tid);
          window.open(url, '_blank', 'noopener');
        } catch (e) {
          if (typeof showToast === 'function') showToast(e.message || 'Certificate unavailable', 'error');
        }
      };
    }
    loadDiscuss();
    const send = document.getElementById('thDiscussSend');
    if (send) {
      send.onclick = async () => {
        const ta = document.getElementById('thDiscussInput');
        const txt = (ta && ta.value) || '';
        if (!txt.trim()) return;
        try {
          await API.postTrainingDiscussion(_tid, txt.trim(), null);
          ta.value = '';
          await loadDiscuss();
        } catch (e) {
          if (typeof showToast === 'function') showToast(e.message || 'Failed to post', 'error');
        }
      };
    }
  }

  async function loadDiscuss() {
    const box = document.getElementById('thDiscussList');
    if (!box) return;
    try {
      const d = await API.getTrainingDiscussions(_tid);
      const posts = d.posts || [];
      box.innerHTML = posts.length
        ? posts
            .map(
              (p) => `<div style="padding:8px;border-bottom:1px solid #eee;font-size:.82rem;">
          <div style="font-weight:800;color:#0f172a;">${esc(p.author_name)} <span style="font-weight:500;color:#94a3b8;">${esc(
                p.created_at || ''
              )}</span></div>
          <div style="white-space:pre-wrap;color:#334155;">${esc(p.body)}</div>
        </div>`
            )
            .join('')
        : '<div style="color:#94a3b8;font-size:.82rem;padding:8px;">No posts yet — start the conversation.</div>';
    } catch (_) {
      box.innerHTML = '<div style="color:#b91c1c;font-size:.82rem;">Could not load discussion.</div>';
    }
  }

  async function refreshHub() {
    _data = await API.getTrainingLearn(_tid);
  }

  window.openTrainingHub = async function (tid) {
    _tid = tid;
    const shell = ensureShell();
    shell.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    try {
      await refreshHub();
      document.getElementById('thTitle').textContent = _data.training.title || 'Training';
      document.getElementById('thSub').textContent = 'Professional learning hub · EPSA';
      renderSidebar();
      renderOverview();
      const ov = document.getElementById('thNavOverview');
      if (ov) ov.focus();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || 'Could not open training', 'error');
      shell.style.display = 'none';
      document.body.style.overflow = '';
    }
  };

  window.closeTrainingHub = function () {
    const shell = document.getElementById('trainingHubOverlay');
    if (shell) shell.style.display = 'none';
    document.body.style.overflow = '';
    _tid = null;
    _data = null;
    _selMod = null;
  };
})();
