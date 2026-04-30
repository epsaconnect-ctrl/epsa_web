(function () {
  if (!/dashboard\.html$/i.test(window.location.pathname)) return;

  const state = {
    myClubs: [],
    clubDirectory: [],
    activeClub: null,
    feedPage: 1,
    feedFilter: 'all',
    feedLoading: false
  };

  function byId(id) { return document.getElementById(id); }
  function user() { return (window.API && API.getUser && API.getUser()) || {}; }
  function html(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  function timeAgo(value) {
    if (window.relTime) return window.relTime(value);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'recently';
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  }
  function profileInitials(name) {
    return (name || 'EPSA')
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function messageStudent(id, name, uni) {
    if (typeof switchSection === 'function') switchSection('messaging');
    setTimeout(async () => {
      try { if (typeof loadConversations === 'function') await loadConversations(); } catch (_) {}
      if (typeof openConversation === 'function') openConversation(id, name);
      if (byId('chatPartnerUni') && uni) byId('chatPartnerUni').textContent = uni;
    }, 160);
  }
  window.messageStudent = messageStudent;

  async function toggleConnection(targetId) {
    try {
      const res = await API.connectUser(targetId);
      showToast(res.message || 'Connection updated');
      await loadSuggestedConnections();
      const currentQuery = byId('networkSearchInput')?.value.trim();
      if (currentQuery) await runNetworkSearch();
    } catch (err) {
      showToast(err.message || 'Unable to update connection', 'error');
    }
  }
  window.toggleConnection = toggleConnection;

  async function openStudentProfile(studentId) {
    const modal = byId('studentProfileModal');
    const body = byId('studentProfileBody');
    if (!modal || !body) return;
    modal.classList.add('active');
    body.innerHTML = '<div style="padding:24px;color:var(--text-muted);">Loading profile...</div>';
    try {
      const data = await API.getStudent(studentId);
      body.innerHTML = `
        <div class="glass-inline-card">
          <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
            <div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;overflow:hidden;">
              ${(data.profile_photo_url || data.profile_photo) ? `<img src="${API.toAbsoluteUrl(data.profile_photo_url || `/uploads/profiles/${data.profile_photo}`)}" style="width:100%;height:100%;object-fit:cover;">` : profileInitials(`${data.first_name} ${data.father_name}`)}
            </div>
            <div style="flex:1;min-width:220px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
                <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.25rem;margin:0;">${html(data.first_name)} ${html(data.father_name)}</h3>
                <span class="soft-badge ${data.connected ? 'green' : 'blue'}">${data.connected ? 'Connected' : 'EPSA Member'}</span>
              </div>
              <div style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
                ${html(data.university || 'University not set')}  ${html(data.program_type || 'Program not set')}  Year ${html(data.academic_year || '')}
              </div>
              <div style="font-size:0.84rem;color:var(--text-secondary);margin-top:10px;line-height:1.75;">${html(data.bio || 'This student has not written a profile summary yet.')}</div>
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
          <div class="admin-detail-card">
            <h4 style="margin-bottom:10px;">Academic Snapshot</h4>
            <div style="font-size:0.84rem;color:var(--text-secondary);line-height:1.8;">
              <div><strong>Field:</strong> ${html(data.field_of_study || 'Psychology')}</div>
              <div><strong>EPSA ID:</strong> ${html(data.student_id || '')}</div>
              <div><strong>LinkedIn:</strong> ${data.linkedin ? `<a href="${html(data.linkedin)}" target="_blank" rel="noreferrer">Open profile</a>` : 'Not added'}</div>
            </div>
          </div>
          <div class="admin-detail-card">
            <h4 style="margin-bottom:10px;">Club Membership</h4>
            <div class="club-activity-stack">
              ${(data.clubs || []).length ? data.clubs.map(club => `
                <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                  <div style="font-weight:700;font-size:0.84rem;">${html(club.name)}</div>
                  <div style="font-size:0.76rem;color:var(--text-muted);">${html(club.role || 'member')}  ${html(club.university || '')}</div>
                </div>
              `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No clubs joined yet.</div>'}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">
          <button class="btn btn-primary" onclick="toggleConnection(${studentId})">${data.connected ? 'Remove Connection' : 'Connect'}</button>
          <button class="btn btn-outline-green" onclick="messageStudent(${studentId}, '${html(`${data.first_name} ${data.father_name}`)}', '${html(data.university || '')}')">Message</button>
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div style="padding:24px;color:#b91c1c;">${html(err.message || 'Unable to load profile')}</div>`;
    }
  }
  window.openStudentProfile = openStudentProfile;

  function injectStudentProfileModal() {
    if (byId('studentProfileModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="studentProfileModal" onclick="if(event.target===this)this.classList.remove('active')">
        <div class="modal" style="max-width:760px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-family:var(--font-display);font-weight:800;margin:0;">Student Profile</h3>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('studentProfileModal').classList.remove('active')">Close</button>
          </div>
          <div id="studentProfileBody"></div>
        </div>
      </div>
    `);
  }

  function ensureConsoleEnhancements() {
    const tabs = document.querySelector('#clubConsole .pill-tabs');
    const contentWrap = document.querySelector('#clubConsole > div:last-child');
    const membersToolbar = document.querySelector('#ctab-members > div');
    if (!tabs || !contentWrap) return;

    if (!byId('ctab-requests')) {
      tabs.insertAdjacentHTML('beforeend', `
        <span class="pill-tab" data-extra-tab="requests" onclick="switchConsoleTab('requests',this)"> Applications</span>
        <span class="pill-tab" data-extra-tab="support" onclick="switchConsoleTab('support',this)"> Support</span>
      `);
      contentWrap.insertAdjacentHTML('beforeend', `
        <div id="ctab-requests" style="display:none;">
          <div id="consoleJoinRequests" class="approval-stack"></div>
        </div>
        <div id="ctab-support" style="display:none;">
          <div class="glass-inline-card" style="margin-bottom:14px;">
            <div style="font-weight:800;font-size:0.92rem;margin-bottom:10px;">Submit a support request</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
              <input id="supportTitle" class="form-input" placeholder="Request title">
              <select id="supportType" class="form-select">
                <option value="funding">Funding</option>
                <option value="collaboration">Collaboration</option>
                <option value="training">Training</option>
              </select>
            </div>
            <textarea id="supportDescription" class="form-input" rows="3" placeholder="Explain what the club needs, expected impact, and urgency."></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:10px;">
              <button class="btn btn-primary btn-sm" onclick="submitSupportRequest()">Send Request</button>
            </div>
          </div>
          <div id="consoleSupportRequests" class="support-request-stack"></div>
        </div>
      `);
    }

    if (membersToolbar && !byId('clubRoleSelect')) {
      membersToolbar.insertAdjacentHTML('beforeend', `
        <select class="form-select" id="clubRoleSelect" style="max-width:180px;">
          <option value="member">Member</option>
          <option value="Vice President">Vice President</option>
          <option value="Secretary">Secretary</option>
          <option value="Treasurer">Treasurer</option>
          <option value="Coordinator">Coordinator</option>
        </select>
      `);
    }
  }

  async function loadConsoleJoinRequests(clubId) {
    const box = byId('consoleJoinRequests');
    if (!box) return;
    box.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Loading applications...</div>';
    try {
      const rows = await API.getClubJoinRequests(clubId);
      if (!rows.length) {
        box.innerHTML = '<div class="glass-inline-card" style="color:var(--text-muted);">No pending membership applications right now.</div>';
        return;
      }
      box.innerHTML = rows.map(row => `
        <div class="approval-card">
          <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <div style="font-weight:800;font-size:0.92rem;">${html(row.name)}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">${html(row.student_id)}  ${html(row.university)}  Applied ${timeAgo(row.requested_at)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="approveJoinRequest(${clubId}, ${row.id})">Approve</button>
              <button class="btn btn-ghost btn-sm" style="color:#b91c1c;" onclick="rejectJoinRequest(${clubId}, ${row.id})">Reject</button>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      box.innerHTML = `<div class="glass-inline-card" style="color:#b91c1c;">${html(err.message || 'Unable to load applications')}</div>`;
    }
  }

  async function approveJoinRequest(clubId, joinId) {
    try {
      const res = await API.approveClubJoinRequest(clubId, joinId);
      showToast(res.message || 'Membership approved');
      await Promise.all([loadConsoleJoinRequests(clubId), loadConsoleMembers(clubId), loadMyClubs()]);
    } catch (err) {
      showToast(err.message || 'Unable to approve application', 'error');
    }
  }
  window.approveJoinRequest = approveJoinRequest;

  async function rejectJoinRequest(clubId, joinId) {
    try {
      const res = await API.rejectClubJoinRequest(clubId, joinId);
      showToast(res.message || 'Membership request rejected', 'info');
      await loadConsoleJoinRequests(clubId);
    } catch (err) {
      showToast(err.message || 'Unable to reject application', 'error');
    }
  }
  window.rejectJoinRequest = rejectJoinRequest;

  async function loadSupportRequests(clubId) {
    const box = byId('consoleSupportRequests');
    if (!box) return;
    box.innerHTML = '<div style="padding:16px;color:var(--text-muted);">Loading support requests...</div>';
    try {
      const rows = await API.getClubSupportRequests(clubId);
      if (!rows.length) {
        box.innerHTML = '<div class="glass-inline-card" style="color:var(--text-muted);">No support requests submitted yet.</div>';
        return;
      }
      box.innerHTML = rows.map(row => `
        <div class="glass-inline-card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <strong>${html(row.title)}</strong>
                <span class="soft-badge ${row.status === 'responded' ? 'green' : row.status === 'pending' ? 'gold' : 'blue'}">${html(row.status)}</span>
                <span class="soft-badge blue">${html(row.request_type)}</span>
              </div>
              <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;line-height:1.7;">${html(row.description || 'No extra description supplied.')}</div>
              ${row.admin_response ? `<div style="margin-top:10px;padding:10px 12px;border-radius:14px;background:rgba(37,99,235,0.06);font-size:0.8rem;color:var(--text-secondary);"><strong>Admin response:</strong> ${html(row.admin_response)}</div>` : ''}
            </div>
            <div style="font-size:0.74rem;color:var(--text-muted);">${timeAgo(row.submitted_at)}</div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      box.innerHTML = `<div class="glass-inline-card" style="color:#b91c1c;">${html(err.message || 'Unable to load support requests')}</div>`;
    }
  }

  async function submitSupportRequest() {
    if (!state.activeClub) return;
    const title = byId('supportTitle')?.value.trim();
    const request_type = byId('supportType')?.value;
    const description = byId('supportDescription')?.value.trim();
    if (!title) {
      showToast('Please give the support request a title', 'error');
      return;
    }
    try {
      const res = await API.submitClubSupportRequest(state.activeClub.id, { title, request_type, description });
      showToast(res.message || 'Support request sent');
      byId('supportTitle').value = '';
      byId('supportDescription').value = '';
      await loadSupportRequests(state.activeClub.id);
    } catch (err) {
      showToast(err.message || 'Unable to submit support request', 'error');
    }
  }
  window.submitSupportRequest = submitSupportRequest;

  async function submitClubMembership(clubId) {
    try {
      const res = await API.joinClub(clubId);
      showToast(res.message || 'Application submitted');
      await loadMyClubs();
    } catch (err) {
      showToast(err.message || 'Unable to apply for club membership', 'error');
    }
  }
  window.submitClubMembership = submitClubMembership;

  async function toggleClubFollow(clubId) {
    try {
      const res = await API.followClub(clubId);
      showToast(res.message || 'Club follow updated');
      await loadMyClubs();
      await loadFeedClubsWidget();
    } catch (err) {
      showToast(err.message || 'Unable to follow club', 'error');
    }
  }
  window.toggleClubFollow = toggleClubFollow;

  async function loadMyClubs() {
    const myList = byId('myClubsList');
    const discover = byId('discoverClubsGrid');
    if (!myList || !discover) return;

    myList.innerHTML = '<div style="padding:24px;color:var(--text-muted);">Loading clubs...</div>';
    discover.innerHTML = '<div style="padding:24px;color:var(--text-muted);">Loading chapters...</div>';

    try {
      const [mine, clubs] = await Promise.all([API.getMyClubs(), API.getClubs()]);
      state.myClubs = mine || [];
      state.clubDirectory = clubs || [];

      const detailedMine = await Promise.all(state.myClubs.map(async club => {
        let activities = [];
        let joinRequests = [];
        try { activities = await API.getClubActivities(club.id); } catch (_) {}
        if (String(club.my_role || '').toLowerCase() === 'president') {
          try { joinRequests = await API.getClubJoinRequests(club.id); } catch (_) {}
        }
        return { ...club, activities, joinRequests };
      }));

      myList.innerHTML = detailedMine.length ? detailedMine.map(club => `
        <div class="glass-inline-card">
          <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;">
            <div style="flex:1;min-width:260px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
                <h3 style="font-family:var(--font-display);font-weight:800;font-size:1.08rem;margin:0;">${html(club.name)}</h3>
                <span class="soft-badge green">Verified Club</span>
                <span class="soft-badge blue">${html(club.my_role || 'member')}</span>
                ${club.joinRequests?.length ? `<span class="soft-badge gold">${club.joinRequests.length} pending applications</span>` : ''}
              </div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">${html(club.university)}  ${club.member_count || club.live_member_count || 0} members</div>
              <div style="font-size:0.84rem;color:var(--text-secondary);line-height:1.7;margin-bottom:12px;">${html(club.description || 'This chapter is active in the EPSA ecosystem and shares updates with its members here.')}</div>
              <div class="club-activity-stack">
                ${(club.activities || []).slice(0, 2).map(activity => `
                  <div class="club-activity-card">
                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                      <strong style="font-size:0.84rem;">${html(activity.title)}</strong>
                      <span class="soft-badge ${activity.activity_type === 'event' ? 'blue' : activity.activity_type === 'report' ? 'green' : 'gold'}">${html(activity.activity_type || 'update')}</span>
                    </div>
                    <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:6px;line-height:1.6;">${html(activity.content || '')}</div>
                  </div>
                `).join('') || '<div style="font-size:0.8rem;color:var(--text-muted);">No club activities posted yet.</div>'}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;min-width:220px;">
              ${String(club.my_role || '').toLowerCase() === 'president'
                ? `<button class="btn btn-primary" onclick="openClubConsole(${club.id}, '${html(club.name)}', '${html(club.university)}')">Open President Console</button>`
                : `<button class="btn btn-outline-green" onclick="loadClubFeedIntoNetworking(${club.id}, '${html(club.name)}')">View Club Feed</button>`}
              <button class="btn btn-ghost" onclick="switchSection('networking'); setTimeout(() => loadClubFeedIntoNetworking(${club.id}, '${html(club.name)}'), 160)">Open in Networking</button>
            </div>
          </div>
        </div>
      `).join('') : `
        <div class="glass-inline-card" style="text-align:center;">
          <div style="font-size:2rem;margin-bottom:10px;"></div>
          <div style="font-weight:800;margin-bottom:6px;">You have not joined a club yet</div>
          <div style="font-size:0.84rem;color:var(--text-muted);">Apply to a chapter from your university below, or register a new club if your campus does not have one yet.</div>
        </div>
      `;

      const joinedIds = new Set(state.myClubs.map(club => club.id));
      const discoverCandidates = (state.clubDirectory || []).filter(club => !joinedIds.has(club.id)).slice(0, 8);
      const detailedDiscover = await Promise.all(discoverCandidates.map(async club => {
        let joinStatus = { status: 'none', can_join: false };
        let following = false;
        try { joinStatus = await API.getClubJoinStatus(club.id); } catch (_) {}
        try {
          const status = await API.getClubFollowStatus(club.id);
          following = !!status.following;
        } catch (_) {}
        return { ...club, joinStatus, following };
      }));

      discover.innerHTML = detailedDiscover.length ? detailedDiscover.map(club => `
        <div class="glass-inline-card">
          <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;">
            <div style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--epsa-green-dark),var(--epsa-green));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;overflow:hidden;">
          ${club.logo_url ? `<img src="${API.toAbsoluteUrl(club.logo_url)}" style="width:100%;height:100%;object-fit:cover;">` : profileInitials(club.name)}
            </div>
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong>${html(club.name)}</strong>
                <span class="soft-badge green">Verified</span>
              </div>
              <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">${html(club.university)}  ${club.member_count || club.live_member_count || 0} members  ${club.follower_count || 0} followers</div>
            </div>
          </div>
          <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.7;margin-bottom:14px;">${html(club.description || 'Active EPSA club building campus-level psychology community and professional development.')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn ${club.joinStatus?.can_join && club.joinStatus?.status === 'none' ? 'btn-primary' : 'btn-ghost'} btn-sm" ${club.joinStatus?.can_join && club.joinStatus?.status === 'none' ? `onclick="submitClubMembership(${club.id})"` : 'disabled'}>
              ${club.joinStatus?.status === 'member' ? 'Already Joined' : club.joinStatus?.status === 'pending' ? 'Application Pending' : club.joinStatus?.can_join ? 'Apply to Join' : 'Read Only'}
            </button>
            <button class="btn btn-outline-green btn-sm" onclick="toggleClubFollow(${club.id})">${club.following ? 'Unfollow' : 'Follow'}</button>
            <button class="btn btn-ghost btn-sm" onclick="loadClubFeedIntoNetworking(${club.id}, '${html(club.name)}')">View Feed</button>
          </div>
        </div>
      `).join('') : '<div class="glass-inline-card" style="grid-column:1/-1;color:var(--text-muted);">No more clubs to discover right now.</div>';
    } catch (err) {
      myList.innerHTML = `<div class="glass-inline-card" style="color:#b91c1c;">${html(err.message || 'Unable to load your clubs')}</div>`;
      discover.innerHTML = '<div class="glass-inline-card" style="grid-column:1/-1;color:#b91c1c;">Unable to load discover section.</div>';
    }
  }
  window.loadMyClubs = loadMyClubs;

  function patchAddMemberAction() {
    window.addClubMember = async function () {
      const clubId = window._activeClubId;
      const studentId = byId('addMemberInput')?.value.trim();
      const role = byId('clubRoleSelect')?.value || 'member';
      if (!clubId || !studentId) return;
      try {
        const res = role === 'member'
          ? await window.authFetch(`/api/clubs/${clubId}/members`, { method: 'POST', body: JSON.stringify({ student_id: studentId }) }).then(r => r.json())
          : await window.authFetch(`/api/clubs/${clubId}/leadership`, { method: 'POST', body: JSON.stringify({ student_id: studentId, role }) }).then(r => r.json());
        if (res.error) throw new Error(res.error);
        showToast(res.message || 'Club member updated');
        byId('addMemberInput').value = '';
        await Promise.all([loadConsoleMembers(clubId), loadMyClubs()]);
      } catch (err) {
        showToast(err.message || 'Unable to add member', 'error');
      }
    };
  }

  function patchConsoleTabs() {
    window.switchConsoleTab = function (tab, tabEl) {
      ['members', 'proposals', 'activities', 'requests', 'support'].forEach(key => {
        const panel = byId(`ctab-${key}`);
        if (panel) panel.style.display = key === tab ? '' : 'none';
      });
      document.querySelectorAll('#clubConsole .pill-tab').forEach(item => item.classList.remove('active'));
      if (tabEl) tabEl.classList.add('active');
      if (tab === 'proposals' && window.loadConsoleProposals) window.loadConsoleProposals(window._activeClubId);
      if (tab === 'activities' && window.loadConsoleActivities) window.loadConsoleActivities(window._activeClubId);
      if (tab === 'requests') loadConsoleJoinRequests(window._activeClubId);
      if (tab === 'support') loadSupportRequests(window._activeClubId);
    };
  }

  function patchConsoleOpen() {
    const originalOpen = window.openClubConsole;
    window.openClubConsole = function (id, name, university) {
      state.activeClub = { id, name, university };
      if (typeof originalOpen === 'function') originalOpen(id, name, university);
      ensureConsoleEnhancements();
      loadConsoleJoinRequests(id);
      loadSupportRequests(id);
    };
  }

  function ensureNetworkingShell() {
    const section = byId('sec-networking');
    const mainCol = section?.querySelector('div > div');
    const sideCol = section?.querySelector('div > div:last-child');
    if (!section || !mainCol || byId('networkSearchShell')) return;
    mainCol.insertAdjacentHTML('afterbegin', `
      <div id="networkSearchShell" class="network-search-shell">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
          <div>
            <div style="font-family:var(--font-display);font-weight:800;font-size:1.15rem;">EPSA Network</div>
            <div style="font-size:0.82rem;color:rgba(255,255,255,0.7);margin-top:4px;">Search students and clubs, view profiles, connect, message peers, and filter the community feed like a professional network.</div>
          </div>
          <div class="pill-tabs">
            <span class="pill-tab active" data-feed-filter="all" onclick="setFeedFilter('all', this)">All Posts</span>
            <span class="pill-tab" data-feed-filter="student" onclick="setFeedFilter('student', this)">Students</span>
            <span class="pill-tab" data-feed-filter="club" onclick="setFeedFilter('club', this)">Club Posts</span>
          </div>
        </div>
        <div class="network-search-grid">
          <input id="networkSearchInput" class="form-input" placeholder="Search students, universities, programs, or clubs" onkeydown="if(event.key==='Enter')runNetworkSearch()">
          <button class="btn btn-gold" onclick="runNetworkSearch()">Search</button>
        </div>
        <div id="networkSearchResults" class="network-results-grid"></div>
      </div>
    `);
    if (sideCol && !byId('networkProfileCard')) {
      const me = user();
      sideCol.insertAdjacentHTML('afterbegin', `
        <div id="networkProfileCard" class="glass-inline-card">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="width:52px;height:52px;border-radius:18px;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;">${profileInitials(`${me.first_name || ''} ${me.father_name || ''}`)}</div>
            <div style="flex:1;">
              <div style="font-family:var(--font-display);font-weight:800;">${html(`${me.first_name || 'EPSA'} ${me.father_name || 'Member'}`)}</div>
              <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">${html(me.university || 'EPSA Student Portal')}</div>
              <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:8px;line-height:1.65;">Build your network, message peers, follow club activity, and share updates with the EPSA community.</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn btn-outline-green btn-sm" onclick="switchSection('profile')">View My Profile</button>
            <button class="btn btn-ghost btn-sm" onclick="switchSection('messaging'); if (window.loadConversations) loadConversations();">Open Messages</button>
          </div>
        </div>
      `);
    }
  }

  async function runNetworkSearch() {
    const q = byId('networkSearchInput')?.value.trim() || '';
    const box = byId('networkSearchResults');
    if (!box) return;
    box.innerHTML = '<div class="glass-inline-card" style="grid-column:1/-1;color:white;background:rgba(255,255,255,0.08);">Searching the EPSA network...</div>';
    try {
      const data = await API.searchNetwork(q);
      const students = (data.students || []).map(student => `
        <div class="network-result-card">
          <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;">
            <div style="width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;overflow:hidden;">
          ${student.photo_url ? `<img src="${API.toAbsoluteUrl(student.photo_url)}" style="width:100%;height:100%;object-fit:cover;">` : profileInitials(`${student.first_name} ${student.father_name}`)}
            </div>
            <div style="flex:1;">
              <h4 style="margin:0 0 4px 0;">${html(student.first_name)} ${html(student.father_name)}</h4>
              <div style="font-size:0.78rem;color:var(--text-muted);">${html(student.university)}  ${html(student.program_type || 'Psychology')}</div>
              <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:6px;">${html(student.bio || 'EPSA member ready to connect with peers across the network.')}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="toggleConnection(${student.id})">${student.connected ? 'Disconnect' : 'Connect'}</button>
            <button class="btn btn-outline-green btn-sm" onclick="messageStudent(${student.id}, '${html(`${student.first_name} ${student.father_name}`)}', '${html(student.university || '')}')">Message</button>
            <button class="btn btn-ghost btn-sm" onclick="openStudentProfile(${student.id})">View Profile</button>
          </div>
        </div>
      `);
      const clubs = (data.clubs || []).map(club => `
        <div class="network-result-card">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">
            <div>
              <h4 style="margin:0 0 4px 0;">${html(club.name)}</h4>
              <div style="font-size:0.78rem;color:var(--text-muted);">${html(club.university)}  ${club.member_count || 0} members</div>
            </div>
            <span class="soft-badge green">Club</span>
          </div>
          <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.7;margin-bottom:12px;">${html(club.description || 'EPSA chapter active in networking, campus programs, and member development.')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="toggleClubFollow(${club.id})">${club.following ? 'Unfollow' : 'Follow'}</button>
            <button class="btn btn-ghost btn-sm" onclick="loadClubFeedIntoNetworking(${club.id}, '${html(club.name)}')">Open Feed</button>
          </div>
        </div>
      `);
      const combined = [...students, ...clubs];
      box.innerHTML = combined.length ? combined.join('') : '<div class="glass-inline-card" style="grid-column:1/-1;background:rgba(255,255,255,0.08);color:white;">No students or clubs matched your search.</div>';
    } catch (err) {
      box.innerHTML = `<div class="glass-inline-card" style="grid-column:1/-1;background:rgba(220,38,38,0.16);color:white;">${html(err.message || 'Unable to search the network')}</div>`;
    }
  }
  window.runNetworkSearch = runNetworkSearch;

  async function setFeedFilter(filter, el) {
    state.feedFilter = filter;
    document.querySelectorAll('[data-feed-filter]').forEach(node => node.classList.remove('active'));
    if (el) el.classList.add('active');
    await loadFeed(true);
  }
  window.setFeedFilter = setFeedFilter;

  function renderPost(post) {
    const me = user();
    const authorName = html(post.author_name || 'EPSA Member');
    const authorUni = html(post.author_uni || '');
    const clubLabel = post.club_name ? `<span class="soft-badge green">${html(post.club_name)}</span>` : '';
    const actionableAuthor = post.user_id && String(post.user_id) !== String(me.id || '');
    const profileButton = actionableAuthor && post.post_type !== 'club' ? `<button class="btn btn-ghost btn-sm" onclick="openStudentProfile(${post.user_id})">Profile</button>` : '';
    const messageButton = actionableAuthor && post.post_type !== 'club' ? `<button class="btn btn-ghost btn-sm" onclick="messageStudent(${post.user_id}, '${authorName}', '${authorUni}')">Message</button>` : '';
    return `
      <div id="post-${post.id}" class="glass-inline-card" style="padding:0;overflow:hidden;">
        <div style="padding:20px 20px 14px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div style="display:flex;gap:12px;align-items:flex-start;">
              <div style="width:48px;height:48px;border-radius:18px;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;overflow:hidden;">
          ${post.author_photo_url ? `<img src="${API.toAbsoluteUrl(post.author_photo_url)}" style="width:100%;height:100%;object-fit:cover;">` : profileInitials(post.author_name)}
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <strong>${authorName}</strong>
                  ${clubLabel}
                </div>
                <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">${authorUni}  ${timeAgo(post.created_at)}</div>
              </div>
            </div>
            ${String(post.user_id) === String(me.id || '') ? `<button onclick="deletePost(${post.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:6px;"></button>` : ''}
          </div>
          <div style="margin-top:14px;font-size:0.88rem;line-height:1.75;color:var(--text-primary);white-space:pre-wrap;">${html(post.content)}</div>
        </div>
        ${post.image_url ? `<img src="${API.toAbsoluteUrl(post.image_url)}" style="width:100%;max-height:380px;object-fit:cover;border-top:1px solid var(--light-100);border-bottom:1px solid var(--light-100);">` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:14px 20px;">
          <button onclick="toggleLike(${post.id}, this)" style="display:flex;align-items:center;gap:6px;border-radius:12px;padding:8px 14px;border:1px solid ${post.user_liked ? 'rgba(22,163,74,0.3)' : 'var(--light-200)'};background:${post.user_liked ? 'rgba(22,163,74,0.08)' : 'transparent'};color:${post.user_liked ? 'var(--epsa-green)' : 'var(--text-muted)'};cursor:pointer;"> <span id="likes-${post.id}">${post.likes || 0}</span></button>
          <button onclick="toggleComments(${post.id})" class="btn btn-ghost btn-sm"> ${post.comment_count || 0}</button>
          <button onclick="shareNetworkPost(${post.id})" class="btn btn-ghost btn-sm"> Share</button>
          ${profileButton}
          ${messageButton}
        </div>
        <div id="comments-${post.id}" style="display:none;border-top:1px solid var(--light-100);padding:16px 20px;">
          <div id="comment-list-${post.id}" style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;">
            <input id="comment-input-${post.id}" class="form-input" placeholder="Write a comment..." style="flex:1;" onkeydown="if(event.key==='Enter')submitComment(${post.id})">
            <button class="btn btn-primary btn-sm" onclick="submitComment(${post.id})">Post</button>
          </div>
        </div>
      </div>
    `;
  }

  async function loadFeed(reset) {
    const container = byId('feedPosts');
    const loading = byId('feedLoading');
    if (!container || state.feedLoading) return;
    state.feedLoading = true;
    if (reset) {
      state.feedPage = 1;
      container.innerHTML = '';
    }
    if (loading) loading.style.display = '';
    try {
      const posts = await API.getFeedFiltered(state.feedFilter, state.feedPage);
      if (!posts.length && state.feedPage === 1) {
        container.innerHTML = '<div class="glass-inline-card" style="text-align:center;color:var(--text-muted);">No posts yet in this view. Try sharing an update or switch filters.</div>';
      } else {
        posts.forEach(post => container.insertAdjacentHTML('beforeend', renderPost(post)));
        if (posts.length === 15) state.feedPage += 1;
      }
    } catch (err) {
      container.innerHTML = `<div class="glass-inline-card" style="color:#b91c1c;">${html(err.message || 'Unable to load feed')}</div>`;
    } finally {
      if (loading) loading.style.display = 'none';
      state.feedLoading = false;
    }
  }
  window.loadFeed = loadFeed;
  window.renderPost = renderPost;

  async function shareNetworkPost(postId) {
    try {
      const res = await API.sharePost(postId);
      showToast(res.message || 'Shared to your feed');
      await loadFeed(true);
    } catch (err) {
      showToast(err.message || 'Unable to share post', 'error');
    }
  }
  window.shareNetworkPost = shareNetworkPost;

  async function loadSuggestedConnections() {
    const box = byId('suggestedConnections');
    if (!box) return;
    try {
      const rows = await API.getSuggestions();
      box.innerHTML = rows.length ? rows.map(student => `
        <div class="glass-inline-card" style="padding:14px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <div style="width:40px;height:40px;border-radius:14px;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;overflow:hidden;">
          ${student.photo_url ? `<img src="${API.toAbsoluteUrl(student.photo_url)}" style="width:100%;height:100%;object-fit:cover;">` : profileInitials(`${student.first_name} ${student.father_name}`)}
            </div>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:0.84rem;">${html(student.first_name)} ${html(student.father_name)}</div>
              <div style="font-size:0.74rem;color:var(--text-muted);margin-top:3px;">${html(student.university)}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn btn-primary btn-sm" onclick="toggleConnection(${student.id})">Connect</button>
            <button class="btn btn-ghost btn-sm" onclick="openStudentProfile(${student.id})">Profile</button>
          </div>
        </div>
      `).join('') : '<div style="font-size:0.82rem;color:var(--text-muted);">No suggestions right now.</div>';
    } catch (_) {
      box.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">Unable to load suggestions.</div>';
    }
  }
  window.loadSuggestedConnections = loadSuggestedConnections;

  async function loadFeedClubsWidget() {
    const box = byId('activeClubsSidebar');
    if (!box) return;
    try {
      const clubs = state.clubDirectory.length ? state.clubDirectory : await API.getClubs();
      box.innerHTML = clubs.slice(0, 5).map(club => `
        <div class="glass-inline-card" style="padding:14px;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div>
              <div style="font-weight:700;font-size:0.83rem;">${html(club.name)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${club.live_member_count || club.member_count || 0} members  ${club.follower_count || 0} followers</div>
            </div>
            <span class="soft-badge green">Club</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn btn-primary btn-sm" onclick="toggleClubFollow(${club.id})">Follow</button>
            <button class="btn btn-ghost btn-sm" onclick="loadClubFeedIntoNetworking(${club.id}, '${html(club.name)}')">Feed</button>
          </div>
        </div>
      `).join('');
    } catch (_) {
      box.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">Unable to load clubs.</div>';
    }
  }
  window.loadFeedClubsWidget = loadFeedClubsWidget;

  async function loadClubFeedIntoNetworking(clubId, clubName) {
    if (typeof switchSection === 'function') switchSection('networking');
    const container = byId('feedPosts');
    if (!container) return;
    container.innerHTML = '<div class="glass-inline-card" style="color:var(--text-muted);">Loading club feed...</div>';
    try {
      const posts = await API.getClubFeed(clubId);
      byId('networkSearchResults').innerHTML = `
        <div class="glass-inline-card" style="grid-column:1/-1;background:rgba(255,255,255,0.08);color:white;">
          Showing recent club posts from <strong>${html(clubName || 'selected club')}</strong>. Use the main feed filters above to return to all posts.
        </div>
      `;
      container.innerHTML = posts.length ? posts.map(renderPost).join('') : '<div class="glass-inline-card" style="color:var(--text-muted);">This club has not posted to the network yet.</div>';
    } catch (err) {
      container.innerHTML = `<div class="glass-inline-card" style="color:#b91c1c;">${html(err.message || 'Unable to load club feed')}</div>`;
    }
  }
  window.loadClubFeedIntoNetworking = loadClubFeedIntoNetworking;

  function ensureRepresentativePortal() {
    const nav = document.querySelector('.sidebar-nav');
    if (nav && !nav.querySelector('[data-section="representative"]')) {
      const votingBtn = nav.querySelector('[data-section="voting"]');
      votingBtn?.insertAdjacentHTML('afterend', `
        <button class="sidebar-link" data-section="representative" style="display:none;" onclick="switchSection('representative')"><span class="sidebar-link-icon"></span> NRC Portal</button>
      `);
    }
    const content = document.querySelector('.dash-content');
    if (content && !byId('sec-representative')) {
      const votingSection = byId('sec-voting');
      const markup = `
        <section id="sec-representative" class="dash-section" style="display:none;">
          <div class="glass-inline-card" style="padding:22px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <h2 style="font-family:var(--font-display);font-weight:800;font-size:1.35rem;margin:0 0 6px;">Representative Portal</h2>
                <div style="font-size:0.84rem;color:var(--text-muted);">Your University Representative workspace for national governance, university communication, reports, and election readiness.</div>
              </div>
              <button class="btn btn-outline-green btn-sm" onclick="loadRepresentativePortal()">Refresh</button>
            </div>
          </div>
          <div id="representativePortalRoot">
            <div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading representative portal</div>
          </div>
        </section>
      `;
      if (votingSection) votingSection.insertAdjacentHTML('afterend', markup);
      else content.insertAdjacentHTML('beforeend', markup);
    }
  }

  function renderRepresentativePortal(data) {
    const root = byId('representativePortalRoot');
    if (!root) return;
    if (!data.active) {
      root.innerHTML = `<div class="glass-inline-card" style="padding:24px;color:var(--text-muted);text-align:center;">${html(data.message || 'You are not currently serving as a representative.')}</div>`;
      return;
    }
    const member = data.member || {};
    const students = data.students || [];
    const peers = data.peers || [];
    const docs = data.documents || [];
    const cycles = data.cycles || [];
    root.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px;">
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">University</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.15rem;">${html(member.university || '')}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Term Start</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.15rem;">${member.term_start ? new Date(member.term_start).toLocaleDateString() : ''}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Term End</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.15rem;">${member.term_end ? new Date(member.term_end).toLocaleDateString() : ''}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Status</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.15rem;">${html(member.status || 'active')}</div></div>
        <div class="admin-detail-card"><div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;">Election Eligibility</div><div style="font-family:var(--font-display);font-weight:900;font-size:1.15rem;">${html(member.eligibility_status || 'eligible')}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:16px;margin-bottom:16px;">
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Representative Briefing</div>
          <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.75;">
            ${(data.responsibilities || []).map(item => ` ${html(item)}`).join('<br>')}
          </div>
          <div style="margin-top:14px;padding:12px 14px;border-radius:16px;background:rgba(26,107,60,0.06);font-size:0.8rem;color:var(--text-secondary);">
            <strong>Mid-term status:</strong> ${html(member.midterm_status || 'pending')}<br>
            <strong>Inactivity watch:</strong> ${html(member.inactivity_flag || 'Clear')}
          </div>
        </div>
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Submit Representative Report</div>
          <div style="display:grid;gap:10px;">
            <input id="nrcDocTitle" class="form-input" placeholder="Report or update title">
            <select id="nrcDocType" class="form-select">
              <option value="report">Report</option>
              <option value="update">Update</option>
              <option value="handover">Handover</option>
            </select>
            <textarea id="nrcDocSummary" class="form-input" rows="3" placeholder="Summary of the report, update, or transition note"></textarea>
            <input id="nrcDocFile" type="file" class="form-input">
            <button class="btn btn-primary btn-sm" onclick="submitRepresentativeDocument()">Submit Document</button>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Students From Your University</div>
          <div class="club-activity-stack">
            ${students.slice(0, 10).map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div>
                  <div style="font-weight:700;font-size:0.84rem;">${html(item.first_name)} ${html(item.father_name)}</div>
                  <div style="font-size:0.74rem;color:var(--text-muted);">${html(item.student_id || '')}  ${html(item.program_type || '')}</div>
                </div>
                <button class="btn btn-ghost btn-sm" onclick="messageStudent(${item.id}, '${html(`${item.first_name} ${item.father_name}`)}', '${html(member.university || '')}')">Message</button>
              </div>
            `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No student list available.</div>'}
          </div>
        </div>
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">National Representative Network</div>
          <div class="club-activity-stack">
            ${peers.slice(0, 10).map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                  <div>
                    <div style="font-weight:700;font-size:0.84rem;">${html(item.name)}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);">${html(item.university)}  ${html(item.status)}</div>
                  </div>
                  <button class="btn btn-ghost btn-sm" onclick="messageStudent(${item.user_id}, '${html(item.name)}', '${html(item.university)}')">Message</button>
                </div>
              </div>
            `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No NRC peer list available.</div>'}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Submitted Documents</div>
          <div class="club-activity-stack">
            ${docs.map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:rgba(26,107,60,0.05);border:1px solid rgba(26,107,60,0.1);">
                <div style="font-weight:700;font-size:0.84rem;">${html(item.title)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);">${html(item.document_type || 'report')}  ${item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : ''}</div>
              </div>
            `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No representative documents yet.</div>'}
          </div>
        </div>
        <div class="glass-inline-card">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-bottom:10px;">Governance Cycles & Announcements</div>
          <div class="club-activity-stack">
            ${cycles.map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:rgba(200,163,64,0.08);border:1px solid rgba(200,163,64,0.16);">
                <div style="font-weight:700;font-size:0.84rem;">${html(item.body_type)}  ${html(item.cycle_type)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);">${html(item.scope_value || item.scope_type || 'national')}  ${html(item.status || 'scheduled')}</div>
              </div>
            `).join('')}
            ${(data.announcements || []).slice(0, 4).map(item => `
              <div style="padding:10px 12px;border-radius:14px;background:var(--light-50);border:1px solid var(--light-200);">
                <div style="font-weight:700;font-size:0.84rem;">${html(item.title)}</div>
                <div style="font-size:0.74rem;color:var(--text-muted);">${html(item.category || 'Announcement')}  ${item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</div>
              </div>
            `).join('') || '<div style="font-size:0.82rem;color:var(--text-muted);">No cycles or announcements available.</div>'}
          </div>
        </div>
      </div>
    `;
  }

  async function loadRepresentativePortal() {
    const root = byId('representativePortalRoot');
    const navButton = document.querySelector('[data-section="representative"]');
    if (!root) return;
    root.innerHTML = '<div class="glass-inline-card" style="padding:24px;text-align:center;color:var(--text-muted);">Loading representative portal</div>';
    try {
      const data = await API.getNRCPortal();
      window._repPortalData = data;
      if (navButton) navButton.style.display = data.active ? '' : 'none';
      renderRepresentativePortal(data);
    } catch (err) {
      if (navButton) navButton.style.display = 'none';
      root.innerHTML = `<div class="glass-inline-card" style="padding:24px;text-align:center;color:#b91c1c;">${html(err.message || 'Unable to load representative portal')}</div>`;
    }
  }
  window.loadRepresentativePortal = loadRepresentativePortal;

  async function submitRepresentativeDocument() {
    const title = byId('nrcDocTitle')?.value.trim();
    if (!title) {
      showToast('Document title is required', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('title', title);
    fd.append('document_type', byId('nrcDocType')?.value || 'report');
    fd.append('summary', byId('nrcDocSummary')?.value || '');
    const file = byId('nrcDocFile')?.files?.[0];
    if (file) fd.append('document', file);
    try {
      const res = await API.uploadNRCDocument(fd);
      showToast(res.message || 'Representative document submitted');
      ['nrcDocTitle', 'nrcDocSummary'].forEach(id => { if (byId(id)) byId(id).value = ''; });
      if (byId('nrcDocFile')) byId('nrcDocFile').value = '';
      await loadRepresentativePortal();
    } catch (err) {
      showToast(err.message || 'Unable to submit representative document', 'error');
    }
  }
  window.submitRepresentativeDocument = submitRepresentativeDocument;

  function patchSectionSwitcher() {
    const previous = window.switchSection;
    window.switchSection = function (section) {
      if (typeof previous === 'function') previous(section);
      if (section === 'representative') {
        if (byId('pageTitle')) byId('pageTitle').textContent = 'Representative Portal';
        loadRepresentativePortal();
      }
      if (section === 'clubs') loadMyClubs();
      if (section === 'networking') {
        ensureNetworkingShell();
        loadFeed(true);
        loadSuggestedConnections();
        loadFeedClubsWidget();
      }
      if (section === 'messaging' && typeof window.loadConversations === 'function') {
        window.loadConversations();
      }
    };
  }

  whenReady(() => {
    injectStudentProfileModal();
    ensureRepresentativePortal();
    ensureConsoleEnhancements();
    ensureNetworkingShell();
    patchAddMemberAction();
    patchConsoleTabs();
    patchConsoleOpen();
    patchSectionSwitcher();
    loadRepresentativePortal();
  });
})();
