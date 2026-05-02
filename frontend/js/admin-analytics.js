/**
 * EPSA Intelligent Analytics Engine — Admin Frontend
 * Connects to /api/analytics/* endpoints and renders interactive insight panels.
 */

(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */
  const BASE = (() => {
    if (window.API && typeof API.getBaseOrigin === 'function') {
      return API.getBaseOrigin() || window.location.origin;
    }
    return window.location.origin;
  })();
  const tok  = () => localStorage.getItem('epsa_access_token') || '';
  const afetch = (url, opts = {}) =>
    fetch(BASE + url, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + tok(),
        'Content-Type':  'application/json',
        ...(opts.headers || {}),
      },
    });
  const pct  = v => `${Math.round((v || 0) * 100)}%`;
  const bar  = (rate, color) =>
    `<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-top:4px">
      <div style="height:100%;width:${pct(rate)};background:${color};border-radius:3px;transition:width .6s ease"></div>
    </div>`;
  const badge = (label, bg, color) =>
    `<span style="background:${bg};color:${color};padding:2px 9px;border-radius:20px;font-size:0.72rem;font-weight:700">${label}</span>`;
  const statusBadge = status => {
    if (status === 'strength') return badge('Strength', '#dcfce7', '#16a34a');
    if (status === 'weakness') return badge('Weakness', '#fee2e2', '#dc2626');
    return badge('Moderate', '#fef3c7', '#d97706');
  };

  /* ── STATE ──────────────────────────────────────────────── */
  let _activeExamId   = '';
  let _currentAtaTab  = 'cohort';
  let _atRiskData     = [];
  let _bloomData      = null;
  let _cohortData     = null;

  /* ═══════════════════════════════════════════════════════════
     MASTER LOADER — called when Analytics section is opened
  ═══════════════════════════════════════════════════════════ */
  async function loadAnalyticsDashboard() {
    try {
      await loadExamSelector();
      await loadCohortSummary();
      await loadBloomAnalysis();
      await loadAtRiskStudents();
      await loadQuestionPerformance();
      // Trigger Dynamic Engine load
      await loadEngineSection();
    } catch (e) {
      console.error('[Analytics] Load error:', e);
    }
  }
  window.loadAnalyticsDashboard = loadAnalyticsDashboard;

  /* ── EXAM SELECTOR ──────────────────────────────────────── */
  async function loadExamSelector() {
    const sel = document.getElementById('analyticsExamFilter');
    if (!sel) return;
    try {
      const res  = await afetch('/api/analytics/exams-overview');
      const data = await res.json();
      sel.innerHTML = '<option value="">All Exams (Combined)</option>' +
        (data.exams || []).map(e =>
          `<option value="${e.id}">${e.title} (${e.submissions} submissions)</option>`
        ).join('');
    } catch (e) { /* ignore */ }
  }

  /* ── COHORT SUMMARY ─────────────────────────────────────── */
  async function loadCohortSummary() {
    const container = document.getElementById('analyticsCohortPanel');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading cohort data…</div>';
    try {
      const qs   = _activeExamId ? `?exam_id=${_activeExamId}` : '';
      const res  = await afetch('/api/analytics/cohort-summary' + qs);
      const data = await res.json();
      _cohortData = data;

      const avgScore    = data.avg_score || 0;
      const dist        = data.score_distribution || {};
      const catPerf     = data.category_performance || [];
      const uniBreak    = data.university_breakdown || [];
      const passRate    = data.total_students > 0 ? data.pass_count / data.total_students : 0;

      const distColors  = {
        '90-100': '#16a34a', '80-89': '#22c55e', '70-79': '#84cc16',
        '60-69': '#eab308', '50-59': '#f97316', '40-49': '#ef4444', 'below_40': '#b91c1c'
      };
      const maxBucket   = Math.max(...Object.values(dist), 1);

      container.innerHTML = `
        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px">
          ${[
            { label: 'Students Tested', value: data.total_students || 0, color: '#1a6b3c', icon: '👥' },
            { label: 'Average Score',   value: `${avgScore.toFixed(1)}%`,  color: avgScore >= 60 ? '#16a34a' : '#dc2626', icon: '📊' },
            { label: 'Pass Rate',        value: pct(passRate),              color: passRate >= 0.5 ? '#16a34a' : '#dc2626', icon: '✅' },
            { label: 'Failed',           value: data.fail_count || 0,       color: '#dc2626', icon: '❌' },
          ].map(k => `
            <div style="background:white;border:1px solid var(--light-200);border-radius:18px;padding:18px;box-shadow:0 4px 12px rgba(0,0,0,0.04)">
              <div style="font-size:1.4rem;margin-bottom:8px">${k.icon}</div>
              <div style="font-size:1.6rem;font-weight:800;color:${k.color};line-height:1">${k.value}</div>
              <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);margin-top:6px;font-weight:700">${k.label}</div>
            </div>
          `).join('')}
        </div>

        <!-- Score Distribution -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px">
          <div style="background:white;border:1px solid var(--light-200);border-radius:18px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.04)">
            <div style="font-weight:800;margin-bottom:16px;font-size:0.95rem">📈 Score Distribution</div>
            ${Object.entries(dist).map(([range, count]) => `
              <div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
                  <span style="font-weight:600">${range}</span>
                  <span style="color:var(--text-muted)">${count} students</span>
                </div>
                <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(count/maxBucket*100)}%;background:${distColors[range]||'#94a3b8'};border-radius:4px;transition:width .6s"></div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Category Performance -->
          <div style="background:white;border:1px solid var(--light-200);border-radius:18px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.04)">
            <div style="font-weight:800;margin-bottom:16px;font-size:0.95rem">📚 Category Performance</div>
            ${catPerf.length === 0 ? '<div style="color:var(--text-muted);text-align:center;padding:20px">No data yet — run exams first.</div>' :
              catPerf.map(c => `
                <div style="margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;margin-bottom:3px">
                    <span style="font-weight:600">${c.category}</span>
                    ${statusBadge(c.status)}
                  </div>
                  ${bar(c.correctness_rate, c.status === 'strength' ? '#16a34a' : (c.status === 'weakness' ? '#dc2626' : '#d97706'))}
                  <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${pct(c.correctness_rate)} correct (${c.total_attempts} attempts)</div>
                </div>
              `).join('')
            }
          </div>
        </div>

        <!-- University Breakdown -->
        ${uniBreak.length ? `
        <div style="background:white;border:1px solid var(--light-200);border-radius:18px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.04)">
          <div style="font-weight:800;margin-bottom:12px;font-size:0.95rem">🏫 University Performance</div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc">
              <th style="padding:8px 12px;text-align:left;font-size:0.75rem;color:var(--text-muted);font-weight:700">University</th>
              <th style="padding:8px 12px;text-align:center;font-size:0.75rem;color:var(--text-muted);font-weight:700">Students</th>
              <th style="padding:8px 12px;text-align:left;font-size:0.75rem;color:var(--text-muted);font-weight:700">Avg Score</th>
            </tr></thead>
            <tbody>
              ${uniBreak.map((u, i) => `
                <tr style="border-top:1px solid var(--light-100)">
                  <td style="padding:8px 12px;font-weight:600;font-size:0.85rem">${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${u.university}</td>
                  <td style="padding:8px 12px;text-align:center;color:var(--text-muted);font-size:0.83rem">${u.count}</td>
                  <td style="padding:8px 12px">
                    <div style="display:flex;align-items:center;gap:8px">
                      <div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
                        <div style="height:100%;width:${u.avg_score}%;background:${u.avg_score>=60?'#16a34a':'#ef4444'};border-radius:3px"></div>
                      </div>
                      <span style="font-size:0.82rem;font-weight:700;color:${u.avg_score>=60?'#16a34a':'#ef4444'};min-width:36px">${u.avg_score}%</span>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>` : ''}
      `;
    } catch (e) {
      container.innerHTML = `<div style="color:#dc2626;padding:20px;text-align:center">Failed to load cohort data. ${e.message}</div>`;
    }
  }

  /* ── BLOOM'S ANALYSIS ───────────────────────────────────── */
  async function loadBloomAnalysis() {
    const container = document.getElementById('analyticsBloomPanel');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center">Loading…</div>';
    try {
      const qs   = _activeExamId ? `?exam_id=${_activeExamId}` : '';
      const res  = await afetch('/api/analytics/bloom-analysis' + qs);
      const data = await res.json();
      _bloomData  = data;

      const levels = data.bloom_levels || [];
      const COLORS  = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];
      const ICONS   = { Remembering: '📖', Understanding: '💡', Applying: '🔧', Analyzing: '🔬', Evaluating: '⚖️', Creating: '🎨' };
      const balMap  = {
        balanced:      { icon: '✅', text: 'Well Balanced', color: '#16a34a' },
        too_shallow:   { icon: '⚠️', text: 'Too Shallow (Mostly Low-Order)', color: '#d97706' },
        too_demanding: { icon: '⚠️', text: 'Too Demanding (Mostly High-Order)', color: '#7c3aed' },
        no_data:       { icon: 'ℹ️', text: 'No exam data yet', color: '#6b7280' },
      };
      const bal = balMap[data.cognitive_balance] || balMap.no_data;

      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px 18px;background:${bal.color}12;border:1.5px solid ${bal.color}30;border-radius:14px">
          <span style="font-size:1.4rem">${bal.icon}</span>
          <div>
            <div style="font-weight:800;color:${bal.color}">${bal.text}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${data.high_order_pct || 0}% high-order questions · ${data.levels_covered || 0} Bloom's levels covered</div>
          </div>
        </div>
        ${levels.length === 0 ? '<div style="color:var(--text-muted);text-align:center;padding:24px">No question analytics yet.</div>' :
          levels.map((lvl, i) => `
            <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--light-100)">
              <div style="width:38px;height:38px;border-radius:10px;background:${COLORS[i]||'#e2e8f0'};display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">${ICONS[lvl.level] || '📋'}</div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-weight:700;font-size:0.88rem">${lvl.level}</span>
                  <span style="font-size:0.82rem;color:var(--text-muted)">${pct(lvl.correctness_rate)} correct</span>
                </div>
                ${bar(lvl.correctness_rate, '#3b82f6')}
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${lvl.total_presented} presented · ${lvl.total_correct} correct</div>
              </div>
            </div>
          `).join('')
        }
      `;
    } catch (e) {
      container.innerHTML = `<div style="color:#dc2626;padding:20px">Could not load Bloom's data.</div>`;
    }
  }

  /* ── AT-RISK STUDENTS ───────────────────────────────────── */
  async function loadAtRiskStudents() {
    const container = document.getElementById('analyticsAtRiskPanel');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center">Scanning for at-risk students…</div>';
    try {
      const res  = await afetch('/api/analytics/at-risk-students?threshold=50&min_exams=1');
      const data = await res.json();
      _atRiskData = data.at_risk_students || [];

      if (_atRiskData.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:32px;color:#16a34a;font-weight:700">✅ No at-risk students detected — great performance!</div>`;
        return;
      }
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:12px;padding:10px 16px;display:flex;align-items:center;gap:8px">
            <span style="font-size:1.2rem">⚠️</span>
            <span style="font-weight:800;color:#dc2626">${_atRiskData.length} student${_atRiskData.length > 1 ? 's' : ''} below 50% average</span>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
            <thead><tr style="background:#fef2f2">
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#dc2626">Student</th>
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#dc2626">University</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:#dc2626">Exams</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:#dc2626">Avg</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:#dc2626">Risk</th>
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#dc2626">Last Active</th>
            </tr></thead>
            <tbody>
              ${_atRiskData.map(s => `
                <tr style="border-bottom:1px solid #fee2e2;cursor:pointer" onclick="showStudentProfile(${s.student_id},'${s.name.replace(/'/g,"\\'")}')">
                  <td style="padding:10px 12px">
                    <div style="font-weight:700">${s.name}</div>
                    <div style="font-size:0.76rem;color:var(--text-muted)">${s.email}</div>
                  </td>
                  <td style="padding:10px 12px;color:var(--text-secondary)">${s.university || '—'}</td>
                  <td style="padding:10px 12px;text-align:center">${s.exam_count}</td>
                  <td style="padding:10px 12px;text-align:center;font-weight:800;color:${s.avg_score>=40?'#dc2626':'#b91c1c'}">${s.avg_score.toFixed(1)}%</td>
                  <td style="padding:10px 12px;text-align:center">${s.risk_level === 'high' ? badge('🔴 High Risk','#fef2f2','#dc2626') : badge('🟡 Moderate','#fefce8','#d97706')}</td>
                  <td style="padding:10px 12px;font-size:0.78rem;color:var(--text-muted)">${s.last_exam ? new Date(s.last_exam).toLocaleDateString() : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div style="color:#dc2626;padding:20px">Could not load at-risk data.</div>`;
    }
  }

  /* ── QUESTION PERFORMANCE TABLE ─────────────────────────── */
  async function loadQuestionPerformance() {
    const container = document.getElementById('analyticsQuestionsPanel');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center">Analyzing questions…</div>';
    try {
      const qs   = _activeExamId ? `?exam_id=${_activeExamId}&limit=50` : '?limit=50';
      const res  = await afetch('/api/analytics/question-performance' + qs);
      const data = await res.json();
      const qs2  = data.questions || [];

      if (qs2.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:32px">No question analytics yet — activate an exam to generate data.</div>';
        return;
      }

      const flagBadge = flag => {
        const m = {
          too_easy:          ['💧 Too Easy',   '#dcfce7', '#16a34a'],
          too_hard:          ['🔥 Too Hard',    '#fee2e2', '#dc2626'],
          low_discrimination:['⚠️ Low Disc.',   '#fef3c7', '#d97706'],
        };
        const [label, bg, color] = m[flag] || [flag, '#e2e8f0', '#4b5563'];
        return badge(label, bg, color);
      };

      container.innerHTML = `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead><tr style="background:#f8fafc">
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:var(--text-muted)">Question</th>
              <th style="padding:10px 12px;font-weight:700;color:var(--text-muted)">Category</th>
              <th style="padding:10px 12px;font-weight:700;color:var(--text-muted)">Bloom's</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:var(--text-muted)">Presented</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:var(--text-muted)">Correct %</th>
              <th style="padding:10px 12px;text-align:center;font-weight:700;color:var(--text-muted)">Avg Time</th>
              <th style="padding:10px 12px;font-weight:700;color:var(--text-muted)">Flags</th>
            </tr></thead>
            <tbody>
              ${qs2.map(q => {
                const rate  = q.correctness_rate || 0;
                const color = rate >= 0.6 ? '#16a34a' : rate >= 0.3 ? '#d97706' : '#dc2626';
                return `<tr style="border-bottom:1px solid var(--light-100)">
                  <td style="padding:10px 12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${q.question_text}">${q.question_text}</td>
                  <td style="padding:10px 12px">${q.category || '—'}</td>
                  <td style="padding:10px 12px">${q.bloom_level || '—'}</td>
                  <td style="padding:10px 12px;text-align:center">${q.times_presented}</td>
                  <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color}">${pct(rate)}</td>
                  <td style="padding:10px 12px;text-align:center;color:var(--text-muted)">${q.avg_time_secs}s</td>
                  <td style="padding:10px 12px">${(q.quality_flags || []).map(f => flagBadge(f)).join(' ') || '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div style="color:#dc2626;padding:20px">Could not load question data.</div>`;
    }
  }

  /* ── STUDENT PROFILE MODAL ──────────────────────────────── */
  window.showStudentProfile = async function (studentId, name) {
    const modal = document.getElementById('analyticsStudentModal');
    const body  = document.getElementById('analyticsStudentBody');
    if (!modal || !body) return;
    modal.style.display = 'flex';
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading profile…</div>';
    try {
      const res  = await afetch(`/api/analytics/student-behavior/${studentId}`);
      const data = await res.json();
      const s    = data.student || {};
      const sum  = data.summary || {};
      const cats = data.category_analysis || [];
      const hist = data.exam_history || [];

      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid var(--light-200)">
          <div style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--epsa-green),#0f4d29);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.2rem;flex-shrink:0">
            ${(s.name || '?')[0]}
          </div>
          <div>
            <div style="font-size:1.1rem;font-weight:800">${s.name}</div>
            <div style="font-size:0.82rem;color:var(--text-muted)">${s.university} · ${s.email}</div>
            <div style="margin-top:6px">${sum.is_at_risk ? badge('⚠️ At Risk','#fef2f2','#dc2626') : badge('✅ On Track','#dcfce7','#16a34a')}</div>
          </div>
          <div style="margin-left:auto;text-align:right">
            <div style="font-size:2rem;font-weight:900;color:${sum.avg_score>=50?'#16a34a':'#dc2626'}">${(sum.avg_score||0).toFixed(1)}%</div>
            <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase">Overall Avg</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- Category Breakdown -->
          <div>
            <div style="font-weight:800;font-size:0.9rem;margin-bottom:12px">📚 Category Breakdown</div>
            ${cats.length === 0 ? '<div style="color:var(--text-muted)">No data</div>' :
              cats.map(c => `
                <div style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:0.82rem">
                    <span style="font-weight:600">${c.category}</span>
                    ${statusBadge(c.status)}
                  </div>
                  ${bar(c.rate, c.status === 'strong' ? '#16a34a' : (c.status === 'weak' ? '#dc2626' : '#d97706'))}
                  <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${c.correct}/${c.total} correct</div>
                </div>
              `).join('')
            }
          </div>

          <!-- Exam History -->
          <div>
            <div style="font-weight:800;font-size:0.9rem;margin-bottom:12px">📝 Exam History</div>
            ${hist.length === 0 ? '<div style="color:var(--text-muted)">No exams taken yet</div>' :
              hist.slice(0, 5).map(e => `
                <div style="padding:10px;background:#f8fafc;border-radius:10px;margin-bottom:8px;border:1px solid var(--light-200)">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:700;font-size:0.85rem">${e.exam_title}</span>
                    <span style="font-weight:900;font-size:1.1rem;color:${(e.score||0)>=50?'#16a34a':'#dc2626'}">${(e.score||0).toFixed(1)}%</span>
                  </div>
                  <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">
                    Avg ${e.avg_time_per_question}s/question
                    ${e.rapid_responses > 3 ? '· ⚡ Rapid responses detected' : ''}
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>
      `;
    } catch (e) {
      body.innerHTML = `<div style="color:#dc2626;padding:20px;text-align:center">Could not load profile: ${e.message}</div>`;
    }
  };

  /* ── EXAM FILTER CHANGE ─────────────────────────────────── */
  window.onAnalyticsExamChange = function (sel) {
    _activeExamId = sel.value;
    loadCohortSummary();
    loadBloomAnalysis();
    loadQuestionPerformance();
  };

  /* ── ANALYTICS TAB SWITCHER ─────────────────────────────── */
  window.switchAnalyticsTab = function (tab) {
    _currentAtaTab = tab;
    document.querySelectorAll('.ata-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ata-panel').forEach(p => p.style.display = 'none');
    const tabEl   = document.querySelector(`.ata-tab[data-tab="${tab}"]`);
    const panelEl = document.getElementById(`ata-panel-${tab}`);
    if (tabEl)   tabEl.classList.add('active');
    if (panelEl) panelEl.style.display = '';
  };

  /* ── REGISTER WITH ADMIN SECTION SWITCHER ───────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    if (window._adminSectionLoaders) {
      window._adminSectionLoaders['analytics'] = loadAnalyticsDashboard;
      window._adminSectionLoaders['engine'] = loadEngineSection;
    }
    if (window._ecoSections) {
      window._ecoSections['analytics'] = loadAnalyticsDashboard;
      window._ecoSections['engine'] = loadEngineSection;
    }
  });

  /* ═══════════════════════════════════════════════════════════
     DYNAMIC ANALYTIC ENGINE — New rendering functions
  ═══════════════════════════════════════════════════════════ */

  let _engineExamId = '';
  let _engineExams  = [];

  async function loadEngineSection() {
    try {
      await loadEngineExamList();
      await loadGlobalQuestionStats();
    } catch(e) { console.error('[Engine]', e); }
  }
  window.loadEngineSection = loadEngineSection;

  async function loadEngineExamList() {
    try {
      const res  = await afetch('/api/analytics/exams-overview');
      const data = await res.json();
      _engineExams = data.exams || [];
      ['engineExamSelect','engineFatigueSelect','engineDrillSelect'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">— Select Exam —</option>' +
          _engineExams.map(e => `<option value="${e.id}">${e.title}</option>`).join('');
      });
    } catch(e) {}
  }

  /* ── GLOBAL QUESTION STATS ── */
  async function loadGlobalQuestionStats() {
    const el = document.getElementById('engineGlobalPanel');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading question intelligence…</div>';
    try {
      const res  = await afetch('/api/analytics/global-question-stats');
      const data = await res.json();
      el.innerHTML = renderGlobalQuestionStats(data);
    } catch(e) {
      el.innerHTML = `<div style="color:#dc2626;padding:20px">Failed: ${e.message}</div>`;
    }
  }
  window.loadGlobalQuestionStats = loadGlobalQuestionStats;

  function renderGlobalQuestionStats(data) {
    const diffBadge = (orig, auto) => {
      if (!auto || auto === orig) return `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:12px;font-size:0.7rem">${orig}</span>`;
      return `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:12px;font-size:0.7rem" title="Auto-adjusted from ${orig}">📊 ${auto}</span>`;
    };
    const qRow = (q, rankBg) => `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:9px 12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.83rem" title="${q.question_text}">${q.question_text}</td>
        <td style="padding:9px 12px;font-size:0.78rem;color:#64748b">${q.category||'—'}</td>
        <td style="padding:9px 12px;text-align:center;font-weight:800;color:${rankBg}">${Math.round((q.correctness_rate||0)*100)}%</td>
        <td style="padding:9px 12px;text-align:center;font-size:0.8rem">${q.times_presented}</td>
        <td style="padding:9px 12px;text-align:center;font-size:0.8rem">${q.avg_time_secs}s</td>
        <td style="padding:9px 12px">${diffBadge(q.difficulty_original, q.difficulty_auto)}</td>
        <td style="padding:9px 12px;text-align:center">${q.doubt_count>=3?'<span style="color:#d97706" title="High Doubt">🤔</span>':''}${q.is_high_variance?'<span style="color:#dc2626" title="High Variance">⚠️</span>':''}${q.distractor_warning?'<span style="color:#7c3aed" title="Dominant distractor attracting wrong answers">🎯</span>':''}</td>
      </tr>`;
    const thead = `<thead><tr style="background:#f8fafc">
      <th style="padding:9px 12px;text-align:left;font-size:0.75rem;font-weight:700;color:#64748b">Question</th>
      <th style="padding:9px 12px;font-size:0.75rem;font-weight:700;color:#64748b">Category</th>
      <th style="padding:9px 12px;text-align:center;font-size:0.75rem;font-weight:700;color:#64748b">Accuracy</th>
      <th style="padding:9px 12px;text-align:center;font-size:0.75rem;font-weight:700;color:#64748b">Shown</th>
      <th style="padding:9px 12px;text-align:center;font-size:0.75rem;font-weight:700;color:#64748b">Avg Time</th>
      <th style="padding:9px 12px;font-size:0.75rem;font-weight:700;color:#64748b">Difficulty</th>
      <th style="padding:9px 12px;text-align:center;font-size:0.75rem;font-weight:700;color:#64748b">Flags</th>
    </tr></thead>`;

    const corrData = data.accuracy_correlation || [];
    const maxTime  = Math.max(...corrData.map(q => Math.max(q.avg_time_correct||0, q.avg_time_incorrect||0)), 1);

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px">
        <!-- Top 10 Most Missed -->
        <div style="background:white;border:1px solid #fee2e2;border-radius:16px;padding:20px">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:14px;color:#dc2626">🔴 Top 10 Most Missed</div>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${thead}<tbody>
            ${(data.top10_missed||[]).map(q => qRow(q,'#dc2626')).join('')}
          </tbody></table></div>
        </div>
        <!-- Top 10 Most Correct -->
        <div style="background:white;border:1px solid #dcfce7;border-radius:16px;padding:20px">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:14px;color:#16a34a">🟢 Top 10 Most Correct</div>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">${thead}<tbody>
            ${(data.top10_correct||[]).map(q => qRow(q,'#16a34a')).join('')}
          </tbody></table></div>
        </div>
      </div>

      <!-- Accuracy Correlation Chart -->
      <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-bottom:18px">
        <div style="font-weight:800;font-size:0.95rem;margin-bottom:4px">⏱ Accuracy–Time Correlation</div>
        <div style="font-size:0.8rem;color:#64748b;margin-bottom:16px">Average focus time: correct vs incorrect answers (top 30 questions by exposure)</div>
        ${corrData.length === 0
          ? '<div style="color:#64748b;padding:20px;text-align:center">No time data yet — run exams with focus tracking enabled.</div>'
          : corrData.map(q => {
              const c = Math.min(100, Math.round((q.avg_time_correct||0)/maxTime*100));
              const i = Math.min(100, Math.round((q.avg_time_incorrect||0)/maxTime*100));
              const rate = Math.round((q.correctness_rate||0)*100);
              return `<div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:3px">
                  <span style="font-weight:600;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.question_text}</span>
                  <span style="color:#64748b">${rate}% accuracy</span>
                </div>
                <div style="display:flex;gap:4px;align-items:center">
                  <span style="font-size:0.7rem;width:52px;color:#16a34a;font-weight:700">✓ ${q.avg_time_correct||0}s</span>
                  <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                    <div style="height:100%;width:${c}%;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:4px"></div>
                  </div>
                </div>
                <div style="display:flex;gap:4px;align-items:center;margin-top:3px">
                  <span style="font-size:0.7rem;width:52px;color:#dc2626;font-weight:700">✗ ${q.avg_time_incorrect||0}s</span>
                  <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                    <div style="height:100%;width:${i}%;background:linear-gradient(90deg,#f87171,#dc2626);border-radius:4px"></div>
                  </div>
                </div>
              </div>`;
            }).join('')}
      </div>

      <!-- High Variance / Doubt -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div style="background:white;border:1px solid #fef3c7;border-radius:16px;padding:20px">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:12px;color:#d97706">⚠️ High Variance Questions (IDI &lt; 0.2)</div>
          ${(data.high_variance||[]).length === 0
            ? '<div style="color:#64748b;text-align:center;padding:16px;font-size:0.85rem">No high-variance questions detected yet.</div>'
            : (data.high_variance||[]).slice(0,10).map(q => `
              <div style="padding:10px;border-radius:10px;background:#fffbeb;border:1px solid #fef3c7;margin-bottom:8px;font-size:0.83rem">
                <div style="font-weight:700;margin-bottom:2px">${q.question_text}</div>
                <div style="color:#64748b">${q.category||'—'} · ${Math.round((q.correctness_rate||0)*100)}% accuracy · Score: ${q.difficulty_score}</div>
              </div>`).join('')}
        </div>
        <div style="background:white;border:1px solid #e0e7ff;border-radius:16px;padding:20px">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:12px;color:#6366f1">🤔 High-Doubt Questions (≥3 answer changes)</div>
          ${(data.high_doubt||[]).length === 0
            ? '<div style="color:#64748b;text-align:center;padding:16px;font-size:0.85rem">No high-doubt patterns detected yet.</div>'
            : (data.high_doubt||[]).slice(0,10).map(q => `
              <div style="padding:10px;border-radius:10px;background:#eef2ff;border:1px solid #e0e7ff;margin-bottom:8px;font-size:0.83rem">
                <div style="font-weight:700;margin-bottom:2px">${q.question_text}</div>
                <div style="color:#64748b">${q.category||'—'} · ${q.doubt_count} doubt interactions · ${Math.round((q.correctness_rate||0)*100)}% accuracy</div>
              </div>`).join('')}
        </div>
        <div style="background:white;border:1px solid #ede9fe;border-radius:16px;padding:20px">
          <div style="font-weight:800;font-size:0.95rem;margin-bottom:12px;color:#7c3aed">🎯 Distractor Warnings</div>
          ${(data.distractor_warnings||[]).length === 0
            ? '<div style="color:#64748b;text-align:center;padding:16px;font-size:0.85rem">No dominant distractor patterns detected yet.</div>'
            : (data.distractor_warnings||[]).slice(0,10).map(q => `
              <div style="padding:10px;border-radius:10px;background:#f5f3ff;border:1px solid #ddd6fe;margin-bottom:8px;font-size:0.83rem">
                <div style="font-weight:700;margin-bottom:2px">${q.question_text}</div>
                <div style="color:#64748b">${q.category||'—'} · Option ${q.dominant_distractor} draws ${Math.round((q.dominant_distractor_rate||0)*100)}% of wrong answers</div>
              </div>`).join('')}
        </div>
      </div>`;
  }

  /* ── UNIVERSITY BENCHMARKING ── */
  async function loadUniversityBenchmarking() {
    const el = document.getElementById('engineUniPanel');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading university data…</div>';
    try {
      const examId = document.getElementById('engineExamSelect')?.value || '';
      const res  = await afetch(`/api/analytics/university-benchmarking${examId ? '?exam_id='+examId : ''}`);
      const data = await res.json();
      const unis = data.universities || [];
      if (!unis.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b">No submission data yet.</div>'; return; }
      el.innerHTML = `
        <div style="overflow-x:auto;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
            <thead><tr style="background:#f8fafc">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#64748b">University</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#64748b">Students</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#64748b">Avg Score</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#64748b">Pass Rate</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#64748b">Strength</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#64748b">Weakness</th>
            </tr></thead>
            <tbody>
              ${unis.map((u,i) => `<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onclick="toggleUniSkillGap('uni-sg-${i}')">
                <td style="padding:10px 14px;font-weight:700">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} ${u.university}</td>
                <td style="padding:10px 14px;text-align:center">${u.student_count}</td>
                <td style="padding:10px 14px;text-align:center;font-weight:800;color:${u.avg_score>=50?'#16a34a':'#dc2626'}">${u.avg_score}%</td>
                <td style="padding:10px 14px;text-align:center;color:${u.pass_rate>=50?'#16a34a':'#dc2626'}">${u.pass_rate}%</td>
                <td style="padding:10px 14px;font-size:0.78rem;color:#16a34a">${u.top_strength||'—'}</td>
                <td style="padding:10px 14px;font-size:0.78rem;color:#dc2626">${u.top_weakness||'—'}</td>
              </tr>
              <tr id="uni-sg-${i}" style="display:none">
                <td colspan="6" style="padding:0 14px 12px">
                  <div style="background:#f8fafc;border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
                    ${(u.category_performance||[]).map(c => `
                      <div style="padding:8px 12px;border-radius:8px;background:white;border:1px solid #e2e8f0;font-size:0.78rem">
                        <div style="font-weight:700;margin-bottom:4px">${c.category}</div>
                        <div style="height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;margin-bottom:3px">
                          <div style="height:100%;width:${Math.round(c.rate*100)}%;background:${c.status==='strength'?'#22c55e':c.status==='weakness'?'#ef4444':'#f59e0b'}"></div>
                        </div>
                        <span style="color:${c.status==='strength'?'#16a34a':c.status==='weakness'?'#dc2626':'#d97706'};font-weight:700">${Math.round(c.rate*100)}%</span>
                      </div>`).join('')}
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch(e) { el.innerHTML = `<div style="color:#dc2626;padding:20px">Failed: ${e.message}</div>`; }
  }
  window.loadUniversityBenchmarking = loadUniversityBenchmarking;
  window.toggleUniSkillGap = id => {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  };

  /* ── FATIGUE ALERT ── */
  async function loadFatigueAlert() {
    const el = document.getElementById('engineFatiguePanel');
    if (!el) return;
    const examId = document.getElementById('engineFatigueSelect')?.value;
    if (!examId) { el.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b">Select an exam above to view fatigue data.</div>'; return; }
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Analyzing performance patterns…</div>';
    try {
      const res  = await afetch(`/api/analytics/fatigue-alert/${examId}`);
      const data = await res.json();
      const buckets = data.buckets || [];
      const maxRate = Math.max(...buckets.map(b => b.correctness_rate), 0.01);
      el.innerHTML = `
        ${data.alert ? `<div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:14px;padding:16px 20px;margin-bottom:18px;display:flex;gap:12px;align-items:flex-start">
          <span style="font-size:1.4rem">⚠️</span>
          <div><div style="font-weight:800;color:#dc2626;margin-bottom:4px">Fatigue Alert Detected — ${data.drop_pct}% accuracy drop</div>
          <div style="font-size:0.85rem;color:#991b1b">${data.recommendation}</div></div>
        </div>` : `<div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;padding:14px 18px;margin-bottom:18px;color:#16a34a;font-weight:700">✅ No significant fatigue detected in ${data.exam_title}</div>`}
        <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:20px">
          <div style="font-weight:800;margin-bottom:16px">📉 Accuracy by Question Position</div>
          ${buckets.length === 0 ? '<div style="color:#64748b;text-align:center;padding:20px">No data available.</div>' :
            buckets.map(b => `<div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:4px">
                <span style="font-weight:700">Questions ${b.label}</span>
                <span style="font-weight:800;color:${b.correctness_rate>=0.6?'#16a34a':b.correctness_rate>=0.4?'#d97706':'#dc2626'}">${Math.round(b.correctness_rate*100)}%</span>
              </div>
              <div style="height:14px;background:#f1f5f9;border-radius:7px;overflow:hidden">
                <div style="height:100%;width:${Math.round(b.correctness_rate/maxRate*100)}%;background:${b.correctness_rate>=0.6?'linear-gradient(90deg,#22c55e,#16a34a)':b.correctness_rate>=0.4?'linear-gradient(90deg,#fbbf24,#d97706)':'linear-gradient(90deg,#f87171,#dc2626)'};border-radius:7px;transition:width .6s ease"></div>
              </div>
              <div style="font-size:0.72rem;color:#94a3b8;margin-top:2px">Avg ${b.avg_time_secs}s/question · ${b.total_answers} answers</div>
            </div>`).join('')}
        </div>`;
    } catch(e) { el.innerHTML = `<div style="color:#dc2626;padding:20px">Failed: ${e.message}</div>`; }
  }
  window.loadFatigueAlert = loadFatigueAlert;

  /* ── AUTO-CALIBRATION STATUS ── */
  async function loadAutocalibration() {
    const el = document.getElementById('engineCalibPanel');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading calibration data…</div>';
    try {
      const res  = await afetch('/api/analytics/global-question-stats');
      const data = await res.json();
      const all  = [...(data.top10_missed||[]), ...(data.top10_correct||[]),
                    ...(data.high_variance||[]), ...(data.high_doubt||[])];
      const seen = new Set();
      const uniq = all.filter(q => { if (seen.has(q.question_id)) return false; seen.add(q.question_id); return true; });
      const adjusted = uniq.filter(q => q.data_adjusted);

      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
          ${[['📊','Questions Analyzed',data.total_questions||0,'#1e40af'],
             ['🔄','Auto-Reclassified',adjusted.length,'#d97706'],
             ['⚠️','High Variance',( data.high_variance||[]).length,'#dc2626']
            ].map(([icon,label,val,color]) => `
            <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center">
              <div style="font-size:1.5rem">${icon}</div>
              <div style="font-size:1.6rem;font-weight:900;color:${color};line-height:1.1;margin:6px 0">${val}</div>
              <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;font-weight:700">${label}</div>
            </div>`).join('')}
        </div>
        ${adjusted.length === 0
          ? '<div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:32px;text-align:center;color:#64748b">No auto-reclassified questions yet. Needs ≥5 submissions per question.</div>'
          : `<div style="background:white;border:1px solid #e2e8f0;border-radius:16px;padding:20px">
              <div style="font-weight:800;margin-bottom:14px">🔄 Auto-Reclassified Questions</div>
              <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">
                <thead><tr style="background:#f8fafc">
                  <th style="padding:9px 12px;text-align:left;font-weight:700;color:#64748b">Question</th>
                  <th style="padding:9px 12px;text-align:center;font-weight:700;color:#64748b">Teacher Set</th>
                  <th style="padding:9px 12px;text-align:center;font-weight:700;color:#64748b">System Score</th>
                  <th style="padding:9px 12px;text-align:center;font-weight:700;color:#64748b">Auto-Adjusted To</th>
                  <th style="padding:9px 12px;text-align:center;font-weight:700;color:#64748b">Accuracy</th>
                  <th style="padding:9px 12px;text-align:center;font-weight:700;color:#64748b">Avg Time</th>
                </tr></thead>
                <tbody>${adjusted.map(q => {
                  const dColor = {easy:'#16a34a',medium:'#d97706',hard:'#dc2626'};
                  return `<tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:9px 12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${q.question_text}">${q.question_text}</td>
                    <td style="padding:9px 12px;text-align:center"><span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:10px;font-size:0.7rem;text-transform:capitalize">${q.difficulty_original}</span></td>
                    <td style="padding:9px 12px;text-align:center;font-size:0.8rem;font-weight:700">${q.difficulty_score}</td>
                    <td style="padding:9px 12px;text-align:center"><span style="background:${dColor[q.difficulty_auto]||'#f1f5f9'}18;color:${dColor[q.difficulty_auto]||'#475569'};border:1px solid ${dColor[q.difficulty_auto]||'#e2e8f0'}40;padding:2px 9px;border-radius:10px;font-size:0.72rem;font-weight:700;text-transform:capitalize">📊 ${q.difficulty_auto}</span></td>
                    <td style="padding:9px 12px;text-align:center;font-weight:700;color:${q.correctness_rate>=0.6?'#16a34a':q.correctness_rate>=0.3?'#d97706':'#dc2626'}">${Math.round(q.correctness_rate*100)}%</td>
                    <td style="padding:9px 12px;text-align:center;color:#64748b">${q.avg_time_secs}s</td>
                  </tr>`;
                }).join('')}</tbody>
              </table></div>
            </div>`}`;
    } catch(e) { el.innerHTML = `<div style="color:#dc2626;padding:20px">Failed: ${e.message}</div>`; }
  }
  window.loadAutocalibration = loadAutocalibration;

  /* ── ENGINE TAB SWITCHER ── */
  window.switchEngineTab = function(tab) {
    document.querySelectorAll('.engine-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.engine-panel').forEach(p => p.style.display = 'none');
    const tabEl = document.querySelector(`.engine-tab[data-tab="${tab}"]`);
    const panelEl = document.getElementById(`engine-panel-${tab}`);
    if (tabEl) tabEl.classList.add('active');
    if (panelEl) panelEl.style.display = '';
    if (tab === 'global')  loadGlobalQuestionStats();
    if (tab === 'uni')     loadUniversityBenchmarking();
    if (tab === 'fatigue') loadFatigueAlert();
    if (tab === 'calib')   loadAutocalibration();
  };

})();
