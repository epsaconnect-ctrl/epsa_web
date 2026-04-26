(function () {
  if (!/admin\/dashboard\.html$/i.test(window.location.pathname.replace(/\\/g, '/'))) return;

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function injectAdminModals() {
    if (!byId('clubRosterModal')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="clubRosterModal" onclick="if(event.target===this)this.classList.remove('active')">
          <div class="modal" style="max-width:860px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <h3 id="clubRosterTitle" style="font-family:var(--font-display);font-weight:800;margin:0;">Club Roster</h3>
              <button class="btn btn-ghost btn-sm" onclick="document.getElementById('clubRosterModal').classList.remove('active')">Close</button>
            </div>
            <div id="clubRosterBody"></div>
          </div>
        </div>
      `);
    }
  }

  function enhancePartnerForm() {
    const grid = byId('partnerForm')?.querySelector('.admin-form-grid');
    if (!grid || byId('cp-type')) return;
    grid.insertAdjacentHTML('beforeend', `
      <div class="form-group"><label class="form-label">Partnership Type</label>
        <select id="cp-type" class="form-select">
          <option value="Strategic">Strategic</option>
          <option value="Academic">Academic</option>
          <option value="Clinical">Clinical</option>
          <option value="Grant">Grant</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Visibility</label>
        <select id="cp-active" class="form-select">
          <option value="1">Active</option>
          <option value="0">Hidden</option>
        </select>
      </div>
      <div class="form-group" style="grid-column:1/-1;"><label class="form-label">What They Do</label><textarea id="cp-what" class="form-input" rows="2" placeholder="Clinical services, training, research collaboration, policy work, community programs..."></textarea></div>
      <div class="glass-inline-card" style="grid-column:1/-1;padding:14px 16px;background:rgba(26,107,60,0.06);border-color:rgba(26,107,60,0.12);">
        <div style="font-weight:800;margin-bottom:8px;">Partner form guide</div>
        <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.7;">
          <strong>Category</strong> = what kind of organization this is.<br>
          <strong>Partnership type</strong> = how they support EPSA, such as strategic, academic, clinical, or grant support.<br>
          <strong>Visibility</strong> = whether the organization appears on the public partners page right now.
        </div>
      </div>
    `);
  }

  async function loadBudgetOverviewCard() {
    const grantsSection = byId('asec-grants-admin');
    if (!grantsSection || byId('budgetOverviewCard')) return;
    grantsSection.insertAdjacentHTML('afterbegin', `
      <div id="budgetOverviewCard" class="glass-inline-card" style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div style="font-family:var(--font-display);font-weight:800;font-size:1.08rem;">Grant Pool Control</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Track the real grant pool, donor-backed funding sources, allocations to clubs, and verification status across all funded projects.</div>
          </div>
          <div id="budgetOverviewMetrics" style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;flex:1;"></div>
        </div>
        <div id="grantDefinitions" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px;"></div>
        <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:16px;margin-top:18px;">
          <div class="admin-detail-card">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
              <div>
                <div style="font-weight:800;">Grant Sources</div>
                <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">Partners and individuals that financially support EPSA's national grant pool.</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="toggleGrantSourceForm()">+ Add Grant</button>
            </div>
            <div id="grantSourceFormWrap" style="display:none;background:var(--light-50);border:1px solid var(--light-200);border-radius:18px;padding:14px;margin-bottom:14px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <input id="gs-title" class="form-input" placeholder="Grant title">
                <select id="gs-sponsor-type" class="form-select">
                  <option value="partner">Partner</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <select id="gs-partner" class="form-select"><option value="">Select partner (optional)</option></select>
                <input id="gs-sponsor-name" class="form-input" placeholder="Sponsor or donor name">
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                <input id="gs-committed" type="number" min="0" class="form-input" placeholder="Committed amount">
                <input id="gs-received" type="number" min="0" class="form-input" placeholder="Available amount">
                <select id="gs-status" class="form-select">
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="pledged">Pledged</option>
                </select>
              </div>
              <textarea id="gs-notes" class="form-input" rows="2" placeholder="Notes, MoU details, disbursement conditions, or verification remarks"></textarea>
              <div id="grantFormGuidance" class="glass-inline-card" style="padding:12px 14px;margin-top:10px;background:rgba(37,99,235,0.05);border-color:rgba(37,99,235,0.12);">
                <div style="font-weight:800;margin-bottom:6px;">How to record a grant</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.65;">
                  <strong>Committed amount</strong> is the full value promised to EPSA.<br>
                  <strong>Available amount</strong> is the portion still not assigned to a club project.<br>
                  <strong>Active</strong> means the source can fund clubs now. <strong>Pledged</strong> means promised but not fully ready to allocate. <strong>Completed</strong> means closed or fully used.
                </div>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleGrantSourceForm(false)">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="submitGrantSource()">Save Grant</button>
              </div>
            </div>
            <div id="grantSourcesList" class="support-request-stack"></div>
          </div>
          <div id="supportRequestsAdmin" style="margin-top:0;"></div>
        </div>
      </div>
    `);
    await populateGrantPartnerOptions();
    await refreshGrantSummary();
  }

  async function refreshGrantSummary() {
    const metrics = byId('budgetOverviewMetrics');
    const supportBox = byId('supportRequestsAdmin');
    const grantBox = byId('grantSourcesList');
    const defsBox = byId('grantDefinitions');
    if (!metrics || !supportBox) return;
    try {
      const [budget, supports, grants] = await Promise.all([
        API.getBudgetOverview(),
        API.getSupportRequests('all'),
        API.getGrantSources('all')
      ]);
      const defs = budget.term_definitions || {};
      metrics.innerHTML = `
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Grant Pool</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.35rem;">ETB ${(budget.total_pool || 0).toLocaleString()}</div><div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;">Committed support recorded for EPSA.</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Allocated</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.35rem;">ETB ${(budget.total_funded || 0).toLocaleString()}</div><div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;">Already awarded to approved club projects.</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Available</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.35rem;">ETB ${(budget.available_grants || 0).toLocaleString()}</div><div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;">Still free to allocate to new projects.</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Funded Clubs</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.35rem;">${budget.clubs_funded || 0}</div><div style="font-size:0.74rem;color:var(--text-secondary);margin-top:6px;">Distinct clubs that already received funding.</div></div>
      `;
      if (defsBox) {
        defsBox.innerHTML = `
          <div class="glass-inline-card" style="padding:12px 14px;"><div style="font-weight:800;font-size:0.78rem;margin-bottom:6px;">Grant Pool</div><div style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${esc(defs.grant_pool || 'All committed grant money recorded for EPSA.')}</div></div>
          <div class="glass-inline-card" style="padding:12px 14px;"><div style="font-weight:800;font-size:0.78rem;margin-bottom:6px;">Allocated</div><div style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${esc(defs.allocated || 'Amount already awarded to club projects.')}</div></div>
          <div class="glass-inline-card" style="padding:12px 14px;"><div style="font-weight:800;font-size:0.78rem;margin-bottom:6px;">Available</div><div style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${esc(defs.available || 'Amount still available for future grant allocations.')}</div></div>
          <div class="glass-inline-card" style="padding:12px 14px;"><div style="font-weight:800;font-size:0.78rem;margin-bottom:6px;">Verified Spend</div><div style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${esc(defs.verified_spend || 'Amount supported by checked financial reports and receipts.')}</div></div>
        `;
      }
      if (grantBox) {
        grantBox.innerHTML = grants.length ? grants.map(item => `
          <div class="glass-inline-card" style="padding:14px;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <strong>${esc(item.title)}</strong>
                  <span class="soft-badge ${item.sponsor_type === 'partner' ? 'blue' : 'gold'}">${esc(item.sponsor_type)}</span>
                  <span class="soft-badge ${item.status === 'completed' ? 'green' : item.status === 'pledged' ? 'gold' : 'blue'}">${esc(item.status)}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:5px;">Sponsor: ${esc(item.partner_name || item.sponsor_name)}${item.partner_category ? ` Â· ${esc(item.partner_category)}` : ''}</div>
                <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;line-height:1.7;">Committed ETB ${(item.amount_committed || 0).toLocaleString()} Â· Available ETB ${(item.amount_received || 0).toLocaleString()}</div>
                ${item.notes ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:6px;">${esc(item.notes)}</div>` : ''}
              </div>
              <button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="removeGrantSource(${item.id})">Remove</button>
            </div>
          </div>
        `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No grant sources have been logged yet.</div>';
      }
      supportBox.innerHTML = `
        <div class="admin-detail-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="font-weight:800;">Club Support Requests</div>
          <span class="soft-badge gold">${supports.filter(item => item.status === 'pending').length} pending</span>
        </div>
        <div class="support-request-stack">
          ${supports.slice(0, 4).map(item => `
            <div class="glass-inline-card" style="padding:14px;">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                <div>
                  <div style="font-weight:700;">${esc(item.club_name)} Â· ${esc(item.title)}</div>
                  <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">${esc(item.request_type)} Â· ${esc(item.status)}</div>
                  <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:8px;line-height:1.6;">${esc(item.description || '')}</div>
                </div>
                <button class="btn btn-primary btn-sm" onclick="respondToSupport(${item.id})">Respond</button>
              </div>
            </div>
          `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No support requests submitted yet.</div>'}
        </div>
        </div>
      `;
    } catch (err) {
      metrics.innerHTML = `<div style="color:#b91c1c;">${esc(err.message || 'Unable to load budget overview')}</div>`;
      supportBox.innerHTML = '';
    }
  }
  window.refreshGrantSummary = refreshGrantSummary;

  function toggleGrantSourceForm(forceState) {
    const wrap = byId('grantSourceFormWrap');
    if (!wrap) return;
    const shouldOpen = typeof forceState === 'boolean' ? forceState : wrap.style.display === 'none';
    wrap.style.display = shouldOpen ? '' : 'none';
  }
  window.toggleGrantSourceForm = toggleGrantSourceForm;

  async function populateGrantPartnerOptions() {
    const select = byId('gs-partner');
    if (!select) return;
    try {
      const partners = await API.getAdminPartners();
      select.innerHTML = '<option value="">Select partner (optional)</option>' + partners.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
    } catch (_) {}
  }

  async function submitGrantSource() {
    const title = byId('gs-title')?.value.trim();
    const sponsor_type = byId('gs-sponsor-type')?.value || 'individual';
    const partner_id = byId('gs-partner')?.value || null;
    const sponsor_name = byId('gs-sponsor-name')?.value.trim();
    const amount_committed = Number(byId('gs-committed')?.value || 0);
    const amount_received = Number(byId('gs-received')?.value || 0);
    const status = byId('gs-status')?.value || 'active';
    const notes = byId('gs-notes')?.value.trim();
    if (!title || (!partner_id && !sponsor_name)) {
      showToast('Grant title and sponsor are required', 'error');
      return;
    }
    try {
      const res = await API.createGrantSource({ title, sponsor_type, partner_id, sponsor_name, amount_committed, amount_received, status, notes });
      showToast(res.message || 'Grant source added');
      ['gs-title','gs-sponsor-name','gs-committed','gs-received','gs-notes'].forEach(id => { if (byId(id)) byId(id).value = ''; });
      if (byId('gs-partner')) byId('gs-partner').value = '';
      if (byId('gs-status')) byId('gs-status').value = 'active';
      toggleGrantSourceForm(false);
      await refreshGrantSummary();
    } catch (err) {
      showToast(err.message || 'Unable to save grant source', 'error');
    }
  }
  window.submitGrantSource = submitGrantSource;

  async function removeGrantSource(id) {
    if (!confirm('Remove this grant source?')) return;
    try {
      const res = await API.deleteGrantSource(id);
      showToast(res.message || 'Grant source removed');
      await refreshGrantSummary();
    } catch (err) {
      showToast(err.message || 'Unable to remove grant source', 'error');
    }
  }
  window.removeGrantSource = removeGrantSource;

  async function respondToSupport(id) {
    const response = prompt('Write the response for this club support request:');
    if (!response) return;
    try {
      const res = await API.respondSupportRequest(id, { status: 'responded', response });
      showToast(res.message || 'Support request updated');
      await refreshGrantSummary();
    } catch (err) {
      showToast(err.message || 'Unable to respond', 'error');
    }
  }
  window.respondToSupport = respondToSupport;

  async function viewClubMembers(id, name) {
    const modal = byId('clubRosterModal');
    const title = byId('clubRosterTitle');
    const body = byId('clubRosterBody');
    if (!modal || !title || !body) return;
    title.textContent = `${name} Roster & Activity`;
    body.innerHTML = '<div style="padding:24px;color:var(--text-muted);">Loading club roster...</div>';
    modal.classList.add('active');
    try {
      const [members, activities] = await Promise.all([
        API.getAdminClubMembers(id),
        API.getAdminClubActivities(id).catch(() => [])
      ]);
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:16px;">
          <div class="admin-detail-card">
            <h4 style="margin-bottom:10px;">Members (${members.length})</h4>
            <div class="admin-grid-stack">
              ${members.map(member => `
                <div style="padding:12px 14px;border:1px solid var(--light-200);border-radius:14px;background:var(--light-50);">
                  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
                    <strong>${esc(member.name)}</strong>
                    <span class="soft-badge ${/president/i.test(member.role) ? 'green' : /secretary|vice/i.test(member.role) ? 'gold' : 'blue'}">${esc(member.role)}</span>
                  </div>
                  <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">${esc(member.student_id || 'No EPSA ID')} Â· ${esc(member.university || '')}</div>
                  <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:4px;">${esc(member.email || '')}</div>
                </div>
              `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No members found.</div>'}
            </div>
          </div>
          <div class="admin-detail-card">
            <h4 style="margin-bottom:10px;">Recent Activity</h4>
            <div class="club-activity-stack">
              ${activities.length ? activities.slice(0, 6).map(activity => `
                <div style="padding:12px 14px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                    <strong style="font-size:0.84rem;">${esc(activity.title)}</strong>
                    <span class="soft-badge ${activity.activity_type === 'report' ? 'green' : activity.activity_type === 'event' ? 'blue' : 'gold'}">${esc(activity.activity_type)}</span>
                  </div>
                  <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:8px;line-height:1.6;">${esc(activity.content || '')}</div>
                </div>
              `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No recent activity has been posted.</div>'}
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div style="padding:24px;color:#b91c1c;">${esc(err.message || 'Unable to load club details')}</div>`;
    }
  }
  window.viewClubMembers = viewClubMembers;

  function patchProposalActions() {
    window.adminActProposal = async function (id, action) {
      const body = {};
      if (action === 'reject') body.reason = prompt('Rejection reason:') || 'Does not meet funding criteria';
      if (action === 'approve') body.notes = prompt('Notes for club (optional):') || '';
      if (action === 'fund') {
        const amount = prompt('Allocated amount (ETB):');
        if (amount === null) return;
        body.funded_amount = Number(amount) || 0;
        try {
          const grants = await API.getGrantSources('all');
          const usable = grants.filter(item => Number(item.amount_received || 0) > 0);
          if (usable.length) {
            const promptText = usable.map(item => `${item.id}: ${item.title} â€” ${item.sponsor_name} (ETB ${(item.amount_received || 0).toLocaleString()} available)`).join('\n');
            const selected = prompt(`Optional: choose a grant source ID for this allocation.\n\n${promptText}`);
            if (selected) body.grant_source_id = Number(selected);
          }
        } catch (_) {}
      }
      try {
        const path = `/admin/proposals/${id}/${action}`;
        const res = await API.request(path, { method: 'POST', body });
        showToast(res.message || 'Proposal updated');
        await Promise.all([loadAdminProposals(), refreshGrantSummary()]);
      } catch (err) {
        showToast(err.message || 'Unable to update proposal', 'error');
      }
    };
  }

  function patchFinancialReports() {
    window.loadFinancialReports = async function () {
      const tbody = byId('finReportsTbody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Loadingâ€¦</td></tr>';
      try {
        const data = await API.getAdminFinancialReports();
        if (!data.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No reports yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.map(item => `
          <tr>
            <td style="font-weight:600;">${esc(item.club_name)}</td>
            <td style="font-size:0.82rem;">${esc(item.proposal_title)}</td>
            <td style="font-weight:700;color:var(--epsa-green);">ETB ${(item.total_spent || 0).toLocaleString()}</td>
            <td>${item.receipt_path ? `<a href="${API.resolveUploadUrl('fin_receipts', item.receipt_path)}" target="_blank" class="btn btn-ghost btn-sm">View</a>` : 'â€”'}</td>
            <td><span class="soft-badge ${item.status === 'verified' ? 'green' : item.status === 'flagged' ? 'red' : 'gold'}">${esc(item.status)}</span></td>
            <td style="font-size:0.78rem;color:var(--text-muted);">${item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : 'â€”'}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${item.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="verifyFinancial(${item.id})">Verify</button>` : ''}
                ${item.status !== 'verified' ? `<button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="flagFinancial(${item.id})">Flag</button>` : ''}
              </div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px;">${esc(err.message || 'Unable to load reports')}</td></tr>`;
      }
    };

    window.verifyFinancial = async function (id) {
      try {
        const res = await API.verifyFinancialReport(id);
        showToast(res.message || 'Financial report verified');
        await Promise.all([loadFinancialReports(), refreshGrantSummary()]);
      } catch (err) {
        showToast(err.message || 'Unable to verify report', 'error');
      }
    };

    window.flagFinancial = async function (id) {
      const reason = prompt('Why are you flagging this report?');
      if (!reason) return;
      try {
        const res = await API.flagFinancialReport(id, reason);
        showToast(res.message || 'Financial report flagged');
        await loadFinancialReports();
      } catch (err) {
        showToast(err.message || 'Unable to flag report', 'error');
      }
    };
  }

  function patchPartnerCrud() {
    window.submitCreatePartner = async function (event) {
      event.preventDefault();
      const fd = new FormData();
      fd.append('name', byId('cp-name').value);
      fd.append('category', byId('cp-cat').value);
      fd.append('partnership_type', byId('cp-type')?.value || 'Strategic');
      fd.append('what_they_do', byId('cp-what')?.value || '');
      fd.append('description', byId('cp-desc').value);
      fd.append('website', byId('cp-website').value);
      fd.append('is_active', byId('cp-active')?.value || '1');
      const logo = byId('cp-logo').files[0];
      if (logo) fd.append('logo', logo);
      try {
        const token = API.getToken();
        const resp = await fetch(${API.getApiBases()[0]}/admin/partners, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Unable to create partner');
        showToast(data.message || 'Partner created');
        byId('createPartnerModal').classList.remove('active');
        byId('partnerForm').reset();
        await loadAdminPartners();
      } catch (err) {
        showToast(err.message || 'Unable to create partner', 'error');
      }
    };

    window.loadAdminPartners = async function () {
      const section = byId('asec-partners-admin');
      const tbody = byId('partnersAdminTbody');
      if (!tbody) return;
      if (section && !byId('partnerControlInsights')) {
        const header = section.querySelector('.data-table-card');
        header?.insertAdjacentHTML('beforebegin', `
          <div id="partnerControlInsights" style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;margin-bottom:16px;">
            <div id="partnerSummaryCards" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;"></div>
            <div class="glass-inline-card" style="padding:14px 16px;min-width:280px;">
              <div style="font-weight:800;margin-bottom:8px;">Partner control guide</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.68;">
                Use <strong>Active</strong> when the organization should appear publicly. Use <strong>Hidden</strong> for draft or paused partnerships.
                Partnership type shows how the organization supports EPSA, while category shows what kind of institution it is.
              </div>
              <input id="partnerControlSearch" class="form-input" placeholder="Search partners, categories, or support roles" style="margin-top:12px;">
            </div>
          </div>
        `);
        byId('partnerControlSearch')?.addEventListener('input', (event) => {
          const query = (event.target.value || '').toLowerCase();
          tbody.querySelectorAll('tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
          });
        });
      }
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">Loadingâ€¦</td></tr>';
      try {
        const data = await API.getAdminPartners();
        const summary = byId('partnerSummaryCards');
        if (summary) {
          const active = data.filter(item => item.is_active).length;
          const hidden = data.filter(item => !item.is_active).length;
          const galleries = data.reduce((sum, item) => sum + Number(item.gallery_count || 0), 0);
          const grantLinked = data.filter(item => Number(item.grant_source_count || 0) > 0).length;
          summary.innerHTML = `
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Active Partners</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${active}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Hidden</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${hidden}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Gallery Items</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${galleries}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Grant-linked</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${grantLinked}</div></div>
          `;
        }
        if (!data.length) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">No partners yet. Add your first one.</td></tr>';
          return;
        }
        tbody.innerHTML = data.map(item => `
          <tr>
            <td>${item.logo_url ? `<img src="${API.toAbsoluteUrl(esc(item.logo_url))}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;">` : '<div style="width:36px;height:36px;background:var(--light-100);border-radius:8px;"></div>'}</td>
            <td style="font-weight:700;">${esc(item.name)}<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${esc(item.partnership_type || 'Strategic')} Â· ${Number(item.grant_source_count || 0)} grant source(s)</div></td>
            <td><span class="soft-badge blue">${esc(item.category)}</span></td>
            <td>${item.website ? `<a href="${esc(item.website)}" target="_blank" rel="noreferrer">Website</a>` : 'â€”'}<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${esc(item.what_they_do || 'No public description added yet.')}</div><div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Gallery items: ${Number(item.gallery_count || 0)}</div></td>
            <td><span class="soft-badge ${item.is_active ? 'green' : 'red'}">${item.is_active ? 'Active' : 'Hidden'}</span></td>
            <td><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" onclick="togglePartnerState(${item.id})">${item.is_active ? 'Hide' : 'Activate'}</button>${item.website ? `<a class="btn btn-ghost btn-sm" href="${esc(item.website)}" target="_blank" rel="noreferrer">Open</a>` : ''}<button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="adminDeletePartner(${item.id}, '${esc(item.name)}')">Remove</button></div></td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:24px;">${esc(err.message || 'Unable to load partners')}</td></tr>`;
      }
    };

    window.togglePartnerState = async function (id) {
      try {
        const res = await API.request(`/admin/partners/${id}/toggle`, { method: 'POST' });
        showToast(res.message || 'Partner status updated');
        await loadAdminPartners();
      } catch (err) {
        showToast(err.message || 'Unable to update partner', 'error');
      }
    };
  }

  function patchClubOversight() {
    window.loadAdminClubs = async function (status = 'all', tabEl = null) {
      const section = byId('asec-clubs-admin');
      if (tabEl) {
        document.querySelectorAll('#clubStatusTabs .pill-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
      }
      const tbody = byId('clubsAdminTbody');
      if (!tbody) return;
      if (section && !byId('clubOversightInsights')) {
        const tableCard = section.querySelector('.data-table-card');
        tableCard?.insertAdjacentHTML('beforebegin', `
          <div id="clubOversightInsights" style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;margin-bottom:16px;">
            <div id="clubOversightCards" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;"></div>
            <div class="glass-inline-card" style="padding:14px 16px;min-width:280px;">
              <div style="font-weight:800;margin-bottom:8px;">Oversight guide</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.68;">
                Use this section to approve new chapters, spot inactive clubs, review roster strength, and monitor recent activity before issues grow.
              </div>
              <input id="clubOversightSearch" class="form-input" placeholder="Search clubs, universities, presidents" style="margin-top:12px;">
            </div>
          </div>
        `);
        byId('clubOversightSearch')?.addEventListener('input', (event) => {
          const query = (event.target.value || '').toLowerCase();
          tbody.querySelectorAll('tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(query) ? '' : 'none';
          });
        });
      }
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Loadingâ€¦</td></tr>';
      try {
        const data = await API.getAdminClubs(status);
        const pending = data.filter(c => c.status === 'pending').length;
        const badge = byId('clubsBadge');
        if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
        if (!data.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No clubs found.</td></tr>';
          return;
        }
        const rows = await Promise.all(data.map(async club => {
          let activities = [];
          try { activities = await API.getAdminClubActivities(club.id); } catch (_) {}
          return { ...club, activities };
        }));
        const cards = byId('clubOversightCards');
        if (cards) {
          const approved = rows.filter(item => item.status === 'approved').length;
          const active = rows.filter(item => item.activities.length > 0).length;
          const supportFlags = rows.reduce((sum, item) => sum + Number(item.pending_support_requests || 0), 0);
          cards.innerHTML = `
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Pending Approval</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${pending}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Approved Clubs</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${approved}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Recently Active</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${active}</div></div>
            <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Support Flags</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${supportFlags}</div></div>
          `;
        }
        tbody.innerHTML = rows.map(c => `
          <tr>
            <td>
              <div style="font-weight:700;">${c.logo_url ? `<img src="${API.toAbsoluteUrl(c.logo_url)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:8px;">` : ''}${esc(c.name)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${c.activities.length ? esc(c.activities[0].title) : 'No activity posted yet'}</div>
            </td>
            <td style="font-size:0.82rem;">${esc(c.university)}</td>
            <td style="font-size:0.82rem;">${esc(c.president_name || 'â€”')}<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${esc(c.president_email || '')}</div></td>
            <td style="text-align:center;">${c.member_count_live || 0}<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">${c.activities.length} activities Â· ${Number(c.pending_support_requests || 0)} support requests</div></td>
            <td><span class="soft-badge ${c.status === 'approved' ? 'green' : c.status === 'pending' ? 'gold' : 'red'}">${esc(c.status)}</span></td>
            <td style="font-size:0.78rem;color:var(--text-muted);">${c.created_at ? new Date(c.created_at).toLocaleDateString() : 'â€”'}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${c.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="adminApproveClub(${c.id})">Approve</button><button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="adminRejectClub(${c.id})">Reject</button>` : ''}
                <button class="btn btn-ghost btn-sm" onclick="viewClubMembers(${c.id}, '${esc(c.name)}')">Roster</button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#b91c1c;padding:24px;">${esc(err.message || 'Error loading clubs')}</td></tr>`;
      }
    };
  }

  function injectExecutiveGovernanceUI() {
    const nav = document.querySelector('.admin-nav');
    if (nav && !nav.querySelector('[data-sec="executive"]')) {
      const votingBtn = nav.querySelector('[data-sec="voting"]');
      votingBtn?.insertAdjacentHTML('afterend', `
        <button class="admin-nav-link" data-sec="executive" onclick="switchAdminSection('executive')"><span class="admin-nav-icon">Govern</span> Executive Committee</button>
      `);
    }
    if (nav && !nav.querySelector('[data-sec="nrc"]')) {
      const executiveBtn = nav.querySelector('[data-sec="executive"]') || nav.querySelector('[data-sec="voting"]');
      executiveBtn?.insertAdjacentHTML('afterend', `
        <button class="admin-nav-link" data-sec="nrc" onclick="switchAdminSection('nrc')"><span class="admin-nav-icon">NRC</span> NRC Management</button>
      `);
    }
    const content = document.querySelector('.admin-content');
    if (content && !byId('asec-executive')) {
      const examsSection = byId('asec-exams');
      const markup = `
        <section id="asec-executive" class="admin-section" style="display:none;">
          <div style="margin-bottom:var(--space-5);">
            <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.4rem;">Executive Committee Management Dashboard</h3>
            <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Govern post-election executive formation, NEB-directed assignments, removals, vacancy workflows, term monitoring, and audit visibility.</p>
          </div>
          <div id="executiveDashboardRoot">
            <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading executive governance workspaceâ€¦</div>
          </div>
        </section>
      `;
      if (examsSection) examsSection.insertAdjacentHTML('beforebegin', markup);
      else content.insertAdjacentHTML('beforeend', markup);
    }
    if (content && !byId('asec-nrc')) {
      const executiveSection = byId('asec-executive');
      const markup = `
        <section id="asec-nrc" class="admin-section" style="display:none;">
          <div style="margin-bottom:var(--space-5);">
            <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.4rem;">NRC Management Dashboard</h3>
            <p style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">Manage University Representatives as a national body, enforce term and election rules, track activity, and coordinate replacements and accountability.</p>
          </div>
          <div id="nrcDashboardRoot">
            <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading NRC management workspaceâ€¦</div>
          </div>
        </section>
      `;
      if (executiveSection) executiveSection.insertAdjacentHTML('afterend', markup);
      else content.insertAdjacentHTML('beforeend', markup);
    }
  }

  function renderNRCDashboard(data) {
    const root = byId('nrcDashboardRoot');
    if (!root) return;
    const members = data.members || [];
    const summary = data.summary || {};
    const docs = data.documents || [];
    const cycles = data.cycles || [];
    root.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:16px;">
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Active</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.active || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Inactive</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.inactive || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Suspended</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.suspended || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Removed</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.removed || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Mid-term Due</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.midterm_due || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Inactivity Flags</div><div style="font-family:var(--font-display);font-size:1.35rem;font-weight:900;">${summary.flagged_inactivity || 0}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:16px;margin-bottom:16px;">
        <div class="glass-inline-card" style="padding:18px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
            <div>
              <div style="font-family:var(--font-display);font-weight:800;font-size:1.04rem;">National Representatives Council</div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Sync university representatives into the NRC, enforce one-year terms, and automatically surface mid-term and end-term governance checkpoints.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="syncNRCMembership()">Sync NRC</button>
              <button class="btn btn-ghost btn-sm" onclick="loadNRCDashboard()">Refresh</button>
            </div>
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.75;">
            ${(data.guidelines || []).map(item => `â€¢ ${esc(item)}`).join('<br>')}
          </div>
        </div>
        <div class="glass-inline-card" style="padding:18px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1.02rem;margin-bottom:10px;">Replacement & Graduation Actions</div>
          <div style="display:grid;gap:10px;">
            <input id="nrcMemberId" class="form-input" placeholder="Representative record ID">
            <input id="nrcReferenceCode" class="form-input" placeholder="Reference / memo ID">
            <input id="nrcReplacementUserId" class="form-input" placeholder="Replacement student user ID (optional)">
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm" onclick="runNRCAction('graduated')">Mark Graduated</button>
              <button class="btn btn-ghost btn-sm" onclick="runNRCAction('suspend')">Suspend</button>
              <button class="btn btn-ghost btn-sm" onclick="runNRCAction('activate')">Activate</button>
              <button class="btn btn-primary btn-sm" onclick="runNRCAction('replace')">Replace</button>
            </div>
          </div>
        </div>
      </div>

      <div class="data-table-card" style="margin-bottom:16px;">
        <div class="table-header">
          <div class="table-title">University Representatives</div>
          <input id="nrcSearchInput" class="table-search-input" placeholder="Search universities, names, IDs">
        </div>
        <table class="data-table">
          <thead><tr><th>Representative</th><th>University</th><th>Term</th><th>Status</th><th>Eligibility</th><th>Monitoring</th><th>Actions</th></tr></thead>
          <tbody id="nrcMembersTbody">
            ${members.length ? members.map(item => `
              <tr>
                <td><div style="font-weight:700;">${esc(item.name)}</div><div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${esc(item.student_id || 'â€”')} â€¢ ${esc(item.email || '')}</div></td>
                <td style="font-size:0.82rem;">${esc(item.university)}</td>
                <td style="font-size:0.8rem;">${item.term_start ? new Date(item.term_start).toLocaleDateString() : 'â€”'}<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Ends ${item.term_end ? new Date(item.term_end).toLocaleDateString() : 'TBD'}</div></td>
                <td>${executiveStatusBadge(item.status)}</td>
                <td><span class="soft-badge ${item.eligibility_status === 'eligible' ? 'green' : 'red'}">${esc(item.eligibility_status || 'eligible')}</span><div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Mid-term: ${esc(item.midterm_status || 'pending')}</div></td>
                <td style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${esc(item.inactivity_flag || 'No active flags')}<br>${item.last_activity_at ? `Last active ${new Date(item.last_activity_at).toLocaleDateString()}` : ''}</td>
                <td><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" onclick="quickNRCStatus(${item.id}, 'active')">Activate</button><button class="btn btn-ghost btn-sm" onclick="quickNRCStatus(${item.id}, 'suspended')">Suspend</button><button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="quickNRCStatus(${item.id}, 'removed')">Remove</button></div></td>
              </tr>
            `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No NRC records yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="glass-inline-card" style="padding:18px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Election Cycles</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${cycles.length ? cycles.slice(0, 8).map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                <div style="font-weight:700;">${esc(item.cycle_type)} â€¢ ${esc(item.scope_value || item.scope_type)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${esc(item.status)} â€¢ ${item.triggered_at ? new Date(item.triggered_at).toLocaleDateString() : ''}</div>
              </div>
            `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No NRC cycles triggered yet.</div>'}
          </div>
        </div>
        <div class="glass-inline-card" style="padding:18px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Representative Documents</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${docs.length ? docs.slice(0, 8).map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:rgba(26,107,60,0.05);border:1px solid rgba(26,107,60,0.1);">
                <div style="font-weight:700;">${esc(item.title)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${esc(item.representative_name || '')} â€¢ ${esc(item.university || '')}</div>
              </div>
            `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No representative documents submitted yet.</div>'}
          </div>
        </div>
      </div>
    `;
    byId('nrcSearchInput')?.addEventListener('input', (event) => {
      const q = String(event.target.value || '').toLowerCase();
      byId('nrcMembersTbody')?.querySelectorAll('tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  window.loadNRCDashboard = async function () {
    const root = byId('nrcDashboardRoot');
    if (!root) return;
    root.innerHTML = `<div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading NRC management workspaceâ€¦</div>`;
    try {
      const data = await API.getNRCDashboard();
      window._nrcDashboardData = data;
      renderNRCDashboard(data);
    } catch (err) {
      root.innerHTML = `<div class="glass-inline-card" style="padding:24px;text-align:center;color:#b91c1c;">${esc(err.message || 'Unable to load NRC dashboard')}</div>`;
    }
  };

  window.syncNRCMembership = async function () {
    const reference_code = prompt('Reference code for NRC sync:', 'AUTO-UR-ACTIVATION');
    if (reference_code === null) return;
    try {
      const res = await API.syncNRCMembers({ reference_code });
      showToast(res.message || 'NRC synchronized');
      await window.loadNRCDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to sync NRC records', 'error');
    }
  };

  window.quickNRCStatus = async function (id, status) {
    const reason = status === 'removed' || status === 'suspended' ? prompt(`Reason for ${status}:`, '') || '' : '';
    try {
      const res = await API.updateNRCStatus(id, { status, reason });
      showToast(res.message || 'Representative status updated');
      await window.loadNRCDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to update status', 'error');
    }
  };

  window.runNRCAction = async function (action) {
    const memberId = byId('nrcMemberId')?.value.trim();
    const reference = byId('nrcReferenceCode')?.value.trim();
    const replacement = byId('nrcReplacementUserId')?.value.trim();
    if (!memberId) {
      showToast('Representative record ID is required', 'error');
      return;
    }
    try {
      let res;
      if (action === 'graduated') {
        res = await API.verifyNRCGraduation(memberId, { graduation_status: 'graduated' });
      } else if (action === 'replace') {
        if (!replacement) {
          showToast('Replacement student user ID is required', 'error');
          return;
        }
        res = await API.replaceNRCMember(memberId, { replacement_user_id: replacement, reference_code: reference || 'INTERIM-REPLACEMENT' });
      } else {
        res = await API.updateNRCStatus(memberId, { status: action === 'activate' ? 'active' : 'suspended', reason: reference || '' });
      }
      showToast(res.message || 'NRC action completed');
      await window.loadNRCDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to complete NRC action', 'error');
    }
  };

  function executiveStatusBadge(status) {
    const tone = status === 'removed' ? 'red' : status === 'reassigned' ? 'gold' : status === 'standby' ? 'blue' : 'green';
    return `<span class="soft-badge ${tone}">${esc(status || 'active')}</span>`;
  }

  function renderExecutiveDashboard(data) {
    const root = byId('executiveDashboardRoot');
    if (!root) return;
    const members = data.members || [];
    const summary = data.summary || {};
    const termAlerts = data.term_alerts || [];
    const vacancies = data.vacancies || [];
    const decisions = data.decisions || [];
    const audit = data.audit || [];
    const cycles = data.cycles || [];
    const ranking = data.phase_two_ranking || [];
    const activePool = data.active_member_pool || [];
    root.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px;">
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Active Members</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.4rem;">${summary.active_members || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Awaiting Role</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.4rem;">${summary.awaiting_assignment || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Removed</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.4rem;">${summary.removed_members || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Open Vacancies</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.4rem;">${summary.open_vacancies || 0}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Term Alerts</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.4rem;">${summary.expiring_soon || 0}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1.15fr 0.85fr;gap:16px;margin-bottom:16px;">
        <div class="glass-inline-card" style="padding:18px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;">
            <div>
              <div style="font-family:var(--font-display);font-weight:800;font-size:1.04rem;">Election-to-Executive Automation</div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Form the executive committee from Phase 2 candidates, with the top three roles locked by vote ranking.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="formExecutiveCommittee()">Sync From Phase 2</button>
              <button class="btn btn-ghost btn-sm" onclick="loadExecutiveDashboard()">Refresh</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="admin-detail-card">
              <div style="font-weight:800;margin-bottom:10px;">Current Vote Ranking</div>
              <div class="admin-grid-stack">
                ${ranking.length ? ranking.slice(0, 8).map((item, idx) => `
                  <div style="padding:10px 12px;border:1px solid var(--light-200);border-radius:14px;background:var(--light-50);display:flex;justify-content:space-between;gap:10px;align-items:center;">
                    <div>
                      <div style="font-weight:700;">#${idx + 1} ${esc(item.name)}</div>
                      <div style="font-size:0.75rem;color:var(--text-muted);">${esc(item.university || '')}</div>
                    </div>
                    <div style="font-weight:800;color:var(--epsa-green);">${item.votes || 0} votes</div>
                  </div>
                `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No Phase 2 ranking is available yet.</div>'}
              </div>
            </div>
            <div class="admin-detail-card">
              <div style="font-weight:800;margin-bottom:10px;">Governance Rules</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.75;">
                ${(data.governance_guidelines || []).map(item => `â€¢ ${esc(item)}`).join('<br>')}
              </div>
              <div style="margin-top:16px;font-weight:800;">Term Alerts</div>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
                ${termAlerts.length ? termAlerts.map(item => `
                  <div style="padding:10px 12px;border-radius:14px;background:rgba(200,163,64,0.08);border:1px solid rgba(200,163,64,0.18);">
                    <div style="font-weight:700;">${esc(item.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-secondary);">${esc(item.assigned_role || 'Executive Member')} â€¢ Ends ${item.term_end ? new Date(item.term_end).toLocaleDateString() : 'TBD'}</div>
                  </div>
                `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No immediate term expirations.</div>'}
              </div>
            </div>
          </div>
        </div>
        <div class="glass-inline-card" style="padding:18px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1.02rem;margin-bottom:12px;">Role Assignment Workstation</div>
          <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.65;margin-bottom:12px;">Use this panel after a formal NEB decision to assign or reassign portfolio roles for committee members outside the locked top three.</div>
          <div style="display:grid;gap:10px;">
            <select id="execMemberSelect" class="form-select">
              <option value="">Select executive member</option>
              ${activePool.map(item => `<option value="${item.member_id}">${esc(item.name)}${item.assigned_role ? ` â€¢ ${esc(item.assigned_role)}` : ''}</option>`).join('')}
            </select>
            <input id="execRoleName" class="form-input" placeholder="Role name, e.g. Director of Finance">
            <input id="execDecisionRef" class="form-input" placeholder="NEB decision reference / memo ID">
            <textarea id="execDecisionNotes" class="form-input" rows="3" placeholder="Notes or summary of the decision"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="submitExecutiveRoleAssignment('assign')">Assign Role</button>
              <button class="btn btn-ghost btn-sm" onclick="submitExecutiveRoleAssignment('reassign')">Reassign Role</button>
            </div>
          </div>
        </div>
      </div>

      <div class="data-table-card" style="margin-bottom:16px;">
        <div class="table-header">
          <div class="table-title">Executive Committee Members</div>
          <input id="executiveMemberSearch" class="table-search-input" placeholder="Search members, universities, roles">
        </div>
        <table class="data-table">
          <thead><tr><th>Member</th><th>University</th><th>Role</th><th>Vote Record</th><th>Status</th><th>Governance</th><th>Actions</th></tr></thead>
          <tbody id="executiveMembersTbody">
            ${members.length ? members.map(item => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;">
                    ${item.photo_url ? `<img src="${API.toAbsoluteUrl(esc(item.photo_url))}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;">` : `<div class="table-avatar">${esc((item.name || 'E').slice(0, 1))}</div>`}
                    <div>
                      <div style="font-weight:700;">${esc(item.name)}</div>
                      <div style="font-size:0.72rem;color:var(--text-muted);">${esc(item.student_id || 'No EPSA ID')}</div>
                    </div>
                  </div>
                </td>
                <td style="font-size:0.82rem;">${esc(item.university || '')}</td>
                <td>${item.assigned_role ? `<strong>${esc(item.assigned_role)}</strong>` : '<span style="color:var(--text-muted);">Awaiting assignment</span>'}</td>
                <td style="font-size:0.8rem;">Rank #${item.vote_rank || 'â€”'}<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${item.vote_count || 0} votes</div></td>
                <td>${executiveStatusBadge(item.status)}</td>
                <td style="font-size:0.76rem;color:var(--text-secondary);line-height:1.6;">${item.decision_reference ? `Ref: ${esc(item.decision_reference)}` : 'Awaiting NEB directive'}<br>${esc(item.engagement_status || 'active')}</td>
                <td>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-ghost btn-sm" onclick="openExecutiveQuickAction(${item.id}, 'engagement')">Engagement</button>
                    <button class="btn btn-ghost btn-sm" onclick="openExecutiveQuickAction(${item.id}, 'handover')">Handover</button>
                    <button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="openExecutiveQuickAction(${item.id}, 'remove')">Remove</button>
                  </div>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Executive committee has not been formed yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="glass-inline-card" style="padding:18px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:12px;">Vacancy Resolution Workflow</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${vacancies.length ? vacancies.map(item => `
              <div class="admin-detail-card">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                  <div>
                    <div style="font-weight:800;">${esc(item.role_name)}</div>
                    <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">Status: ${esc(item.status)} â€¢ Path: ${esc(item.resolution_path || 'pending')}</div>
                    <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.65;margin-top:8px;">${esc(item.reason || 'No reason recorded')}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:8px;">Decision ref: ${esc(item.decision_reference || 'â€”')}</div>
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-ghost btn-sm" onclick="openVacancyAction(${item.id}, 'interest')">Record Interest</button>
                    <button class="btn btn-primary btn-sm" onclick="openVacancyAction(${item.id}, 'internal')">Internal Reassign</button>
                    <button class="btn btn-ghost btn-sm" onclick="openVacancyAction(${item.id}, 'start-election')">Start Election</button>
                    <button class="btn btn-ghost btn-sm" onclick="openVacancyAction(${item.id}, 'complete-election')">Complete Election</button>
                  </div>
                </div>
              </div>
            `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No current vacancies.</div>'}
          </div>
        </div>
        <div class="glass-inline-card" style="padding:18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div>
              <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Mid-term & Term Cycles</div>
              <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
                ${cycles.length ? cycles.slice(0, 5).map(item => `
                  <div style="padding:10px 12px;border-radius:14px;background:rgba(200,163,64,0.08);border:1px solid rgba(200,163,64,0.16);">
                    <div style="font-weight:700;">${esc(item.cycle_type)} â€¢ ${esc(item.related_role || item.scope_value || 'NEC')}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${esc(item.status)} â€¢ ${item.triggered_at ? new Date(item.triggered_at).toLocaleDateString() : ''}</div>
                  </div>
                `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No NEC cycles have been triggered yet.</div>'}
              </div>
              <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Recent Decisions</div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${decisions.length ? decisions.slice(0, 6).map(item => `
                  <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                    <div style="font-weight:700;">${esc(item.decision_type)}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${esc(item.reference_code)} â€¢ ${item.issued_at ? new Date(item.issued_at).toLocaleDateString() : ''}</div>
                  </div>
                `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No decisions logged yet.</div>'}
              </div>
            </div>
            <div>
              <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Audit Trail</div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${audit.length ? audit.slice(0, 6).map(item => `
                  <div style="padding:10px 12px;border-radius:14px;background:rgba(26,107,60,0.05);border:1px solid rgba(26,107,60,0.1);">
                    <div style="font-weight:700;">${esc(item.action_type)}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${esc(item.actor_name || 'System')} â€¢ ${item.created_at ? new Date(item.created_at).toLocaleString() : ''}</div>
                  </div>
                `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No audit records yet.</div>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    byId('executiveMemberSearch')?.addEventListener('input', (event) => {
      const q = String(event.target.value || '').toLowerCase();
      byId('executiveMembersTbody')?.querySelectorAll('tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  window.loadExecutiveDashboard = async function () {
    const root = byId('executiveDashboardRoot');
    if (!root) return;
    root.innerHTML = `<div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading executive governance workspaceâ€¦</div>`;
    try {
      const data = await API.getExecutiveDashboard();
      window._executiveDashboardData = data;
      renderExecutiveDashboard(data);
    } catch (err) {
      root.innerHTML = `<div class="glass-inline-card" style="padding:24px;text-align:center;color:#b91c1c;">${esc(err.message || 'Unable to load executive governance data')}</div>`;
    }
  };

  window.formExecutiveCommittee = async function () {
    const decisionReference = prompt('Decision reference for committee formation:', 'AUTO-NATIONAL-ELECTION');
    if (decisionReference === null) return;
    try {
      const res = await API.formExecutiveCommittee({ decision_reference: decisionReference });
      showToast(res.message || 'Executive committee formed');
      await window.loadExecutiveDashboard();
      if (typeof loadVotingAnalytics === 'function') loadVotingAnalytics();
    } catch (err) {
      showToast(err.message || 'Unable to form committee', 'error');
    }
  };

  window.submitExecutiveRoleAssignment = async function (mode) {
    const memberId = byId('execMemberSelect')?.value;
    const roleName = byId('execRoleName')?.value.trim();
    const decisionReference = byId('execDecisionRef')?.value.trim();
    const notes = byId('execDecisionNotes')?.value.trim();
    if (!memberId || !roleName || !decisionReference) {
      showToast('Member, role, and decision reference are required', 'error');
      return;
    }
    try {
      const fn = mode === 'reassign' ? API.reassignExecutiveRole.bind(API) : API.assignExecutiveRole.bind(API);
      const res = await fn(memberId, { role_name: roleName, decision_reference: decisionReference, notes });
      showToast(res.message || 'Executive role updated');
      ['execRoleName', 'execDecisionRef', 'execDecisionNotes'].forEach(id => { if (byId(id)) byId(id).value = ''; });
      await window.loadExecutiveDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to update role', 'error');
    }
  };

  window.openExecutiveQuickAction = async function (memberId, action) {
    try {
      if (action === 'engagement') {
        const engagement_status = prompt('Engagement status (active, flagged, under_review):', 'active');
        if (engagement_status === null) return;
        const engagement_notes = prompt('Engagement notes or monitoring remarks:', '') || '';
        const performance_flag = prompt('Optional performance or ethics flag:', '') || '';
        const res = await API.updateExecutiveEngagement(memberId, { engagement_status, engagement_notes, performance_flag });
        showToast(res.message || 'Engagement updated');
      } else if (action === 'handover') {
        const item_title = prompt('Add or update a handover checklist item title:', 'Submit outgoing role report');
        if (item_title === null) return;
        const item_status = prompt('Checklist status (pending, completed):', 'pending') || 'pending';
        const notes = prompt('Checklist notes:', '') || '';
        const res = await API.updateExecutiveHandover(memberId, { item_title, item_status, notes });
        showToast(res.message || 'Handover updated');
      } else if (action === 'remove') {
        const reason = prompt('Reason for removal:', '');
        if (!reason) return;
        const decision_reference = prompt('NEB decision reference / memo ID:', '');
        if (!decision_reference) return;
        const notes = prompt('Additional notes (optional):', '') || '';
        const res = await API.removeExecutiveMember(memberId, { reason, decision_reference, notes });
        showToast(res.message || 'Executive member removed');
      }
      await window.loadExecutiveDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to process executive action', 'error');
    }
  };

  window.openVacancyAction = async function (vacancyId, action) {
    try {
      if (action === 'interest') {
        const member_id = prompt('Executive member ID expressing interest:', '');
        if (!member_id) return;
        const statement = prompt('Interest statement:', '') || '';
        const res = await API.recordVacancyInterest(vacancyId, { member_id, statement });
        showToast(res.message || 'Interest recorded');
      } else if (action === 'internal') {
        const member_id = prompt('Executive member ID selected for internal reassignment:', '');
        if (!member_id) return;
        const decision_reference = prompt('NEB decision reference:', '');
        if (!decision_reference) return;
        const notes = prompt('Notes (optional):', '') || '';
        const res = await API.resolveVacancyInternal(vacancyId, { member_id, decision_reference, notes });
        showToast(res.message || 'Vacancy resolved internally');
      } else if (action === 'start-election') {
        const decision_reference = prompt('Decision reference for opening the vacancy election:', '');
        if (!decision_reference) return;
        const notes = prompt('Notes (optional):', '') || '';
        const res = await API.startVacancyElection(vacancyId, { decision_reference, notes });
        showToast(res.message || 'Vacancy election started');
      } else if (action === 'complete-election') {
        const winner_user_id = prompt('Winning NRC user ID:', '');
        if (!winner_user_id) return;
        const winner_vote_count = prompt('Winner vote count:', '0') || '0';
        const result_reference = prompt('Election result reference / decision ID:', '');
        if (!result_reference) return;
        const notes = prompt('Notes (optional):', '') || '';
        const res = await API.completeVacancyElection(vacancyId, { winner_user_id, winner_vote_count, result_reference, notes });
        showToast(res.message || 'Vacancy election completed');
      }
      await window.loadExecutiveDashboard();
    } catch (err) {
      showToast(err.message || 'Unable to process vacancy action', 'error');
    }
  };

  ready(async () => {
    injectAdminModals();
    injectExecutiveGovernanceUI();
    enhancePartnerForm();
    patchProposalActions();
    patchFinancialReports();
    patchPartnerCrud();
    patchClubOversight();
    if (window._ecoSections) {
      window._ecoSections['partners-admin'] = () => window.loadAdminPartners();
      window._ecoSections['clubs-admin'] = () => window.loadAdminClubs();
      window._ecoSections['grants-admin'] = () => {
        if (typeof loadAdminProposals === 'function') loadAdminProposals();
        refreshGrantSummary();
      };
    }
    const previousSwitch = window.switchAdminSection;
    window.switchAdminSection = function (sec) {
      if (typeof previousSwitch === 'function') previousSwitch(sec);
      if (sec === 'executive') {
        const title = byId('adminPageTitle');
        if (title) title.textContent = 'Executive Committee';
        window.loadExecutiveDashboard();
      } else if (sec === 'nrc') {
        const title = byId('adminPageTitle');
        if (title) title.textContent = 'NRC Management';
        window.loadNRCDashboard();
      }
    };
    await loadBudgetOverviewCard();
  });
})();





