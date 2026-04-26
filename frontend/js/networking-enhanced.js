// ════════════════════════════════════════
// EPSA ENHANCED NETWORKING — directory, connect, follow, messaging
// ══════════════════════════════════════════

let currentNetworkView = 'connections';
let networkData = {
  connections: [],
  suggestions: [],
  conversations: [],
  stats: { connections: 0, profileViews: 0, messages: 0, clubs: 0 },
};

function studentDisplayName(row) {
  return `${row.first_name || ''} ${row.father_name || ''}`.trim() || 'EPSA Member';
}

function studentPhotoUrl(row) {
  if (row.photo_url) {
    if (row.photo_url.startsWith('http') || row.photo_url.startsWith('data:')) return row.photo_url;
    const base = (API._apiBase || '').replace(/\/api\/?$/, '');
    return `${base}${row.photo_url.startsWith('/') ? '' : '/'}${row.photo_url}`;
  }
  if (row.profile_photo) return API.resolveUploadUrl('profiles', row.profile_photo);
  return '';
}

async function loadEnhancedNetworking() {
  const emptyProfile = { profile_views: 0, club_count: 0, face_registered: false };
  try {
    const settled = await Promise.allSettled([
      API.getProfile(),
      API.getStudents(''),
      API.getSuggestions(),
      API.getConversations(),
    ]);
    const profile =
      settled[0].status === 'fulfilled' ? settled[0].value : emptyProfile;
    const students = settled[1].status === 'fulfilled' ? settled[1].value : [];
    const suggestions = settled[2].status === 'fulfilled' ? settled[2].value : [];
    let conversations = [];
    if (settled[3].status === 'fulfilled') {
      conversations = Array.isArray(settled[3].value) ? settled[3].value : [];
    } else {
      console.error('Conversations failed:', settled[3].reason);
    }

    const mapped = (students || []).map((u) => ({
      id: u.id,
      name: studentDisplayName(u),
      university: u.university,
      program_type: u.program_type,
      academic_year: u.academic_year,
      bio: u.bio,
      connected: !!u.connected,
      following: !!u.following,
      photo_url: studentPhotoUrl(u),
    }));

    networkData.connections = mapped.filter((s) => s.connected);
    networkData.suggestions = (suggestions || []).map((u) => ({
      id: u.id,
      name: studentDisplayName(u),
      university: u.university,
      program_type: u.program_type,
      academic_year: u.academic_year,
      bio: u.bio,
      photo_url: studentPhotoUrl(u),
      connected: false,
      following: false,
    }));
    networkData.conversations = conversations;

    networkData.stats = {
      connections: networkData.connections.length,
      profileViews: profile.profile_views || 0,
      messages: networkData.conversations.reduce((sum, c) => sum + (c.unread || c.unread_count || 0), 0),
      clubs: profile.club_count || 0,
    };

    updateNetworkStats();
    renderNetworkView();
  } catch (err) {
    console.error('Failed to load networking data:', err);
    showToast('Could not refresh the network. Check your connection and try again.', 'error');
  }
}

function updateNetworkStats() {
  const c = document.getElementById('networkConnectionsCount');
  const p = document.getElementById('networkProfileViews');
  const m = document.getElementById('networkMessagesCount');
  const cl = document.getElementById('networkClubsCount');
  if (c) c.textContent = networkData.stats.connections;
  if (p) p.textContent = networkData.stats.profileViews;
  if (m) m.textContent = networkData.stats.messages;
  if (cl) cl.textContent = networkData.stats.clubs;
}

function switchNetworkView(view) {
  currentNetworkView = view;
  document.querySelectorAll('.toggle-btn').forEach((btn) => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`[onclick="switchNetworkView('${view}')"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const cv = document.getElementById('connectionsView');
  const sv = document.getElementById('suggestionsView');
  const wrap = document.getElementById('networkMessagingWrap');
  if (cv) cv.style.display = view === 'connections' ? '' : 'none';
  if (sv) sv.style.display = view === 'suggestions' ? '' : 'none';
  if (wrap) wrap.style.display = view === 'messaging' ? '' : 'none';

  renderNetworkView();
}

function renderNetworkView() {
  switch (currentNetworkView) {
    case 'connections':
      renderProfessionalConnections();
      break;
    case 'suggestions':
      renderSuggestions();
      break;
    case 'messaging':
      renderConversations();
      break;
    default:
      break;
  }
}

function renderProfessionalConnections() {
  const container = document.getElementById('connectionsView');
  if (!container) return;

  if (!networkData.connections.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:12px;">🤝</div>
        <div style="font-weight:600;margin-bottom:8px;">No connections yet</div>
        <div style="font-size:0.875rem;">Discover members in Suggestions and connect.</div>
      </div>`;
    return;
  }

  container.innerHTML = networkData.connections.map((connection) => cardHtml(connection, true)).join('');
}

function renderSuggestions() {
  const container = document.getElementById('suggestionsView');
  if (!container) return;

  if (!networkData.suggestions.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:12px;">🔍</div>
        <div style="font-weight:600;margin-bottom:8px;">No suggestions right now</div>
        <div style="font-size:0.875rem;">Try again later for new EPSA members to meet.</div>
      </div>`;
    return;
  }

  container.innerHTML = networkData.suggestions.map((s) => cardHtml(s, false)).join('');
}

function cardHtml(connection, isPeer) {
  const img = connection.photo_url || 'assets/logo.png';
  return `
    <div class="professional-card">
      <div class="professional-header">
        <img class="professional-avatar" src="${img}" alt="" onerror="this.src='assets/logo.png'">
        <div class="professional-info">
          <div class="professional-name">${connection.name}</div>
          <div class="professional-title">${connection.program_type || 'Psychology Student'}</div>
          <div class="professional-university">🏫 ${connection.university || '—'}</div>
          <div class="professional-bio">${connection.bio || ''}</div>
        </div>
      </div>
      <div class="professional-actions">
        <button type="button" class="action-btn primary" onclick="sendConnectionRequest(${connection.id})">${isPeer ? 'Disconnect' : 'Connect'}</button>
        ${!isPeer ? `<button type="button" class="action-btn secondary" onclick="followMember(${connection.id}, ${connection.following ? 'true' : 'false'})">${connection.following ? 'Unfollow' : 'Follow'}</button>` : ''}
        <button type="button" class="action-btn secondary" onclick="viewProfile(${connection.id})">Profile</button>
        <button type="button" class="action-btn secondary" onclick="openMessageFromNetwork(${connection.id})">Message</button>
      </div>
    </div>`;
}

function renderConversations() {
  const container = document.getElementById('networkConversationList');
  if (!container) return;
  const rows = networkData.conversations || [];
  if (!rows.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:36px 20px;color:var(--text-muted);font-size:0.9rem;line-height:1.5;">
        <div style="font-size:1.75rem;margin-bottom:10px;">💬</div>
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px;">No messages yet</div>
        <div>Connect with members or message EPSA Administration from the Messaging area.</div>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:16px;" onclick="switchSection('messaging')">Go to Messaging</button>
      </div>`;
    return;
  }
  container.innerHTML = rows
    .map((c) => {
      const displayName = c.name || 'Member';
      const initials = c.initials || displayName.slice(0, 2).toUpperCase();
      const preview = (c.lastMsg || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const t = formatTime(c.time);
      const unread = c.unread > 0 ? `<span class="network-unread-pill">${c.unread}</span>` : '';
      return `
    <button type="button" class="network-conv-row" onclick="openMessageFromNetwork(${c.id})">
      <span class="network-conv-avatar">${initials}</span>
      <span class="network-conv-body">
        <span class="network-conv-top"><strong>${displayName.replace(/</g, '&lt;')}</strong><span class="network-conv-time">${t}</span></span>
        <span class="network-conv-preview">${preview || '—'}</span>
      </span>
      ${unread}
    </button>`;
    })
    .join('');
}

async function sendConnectionRequest(userId) {
  try {
    const res = await API.connectUser(userId);
    showToast(res.message || 'Updated', res.message === 'Connected' ? 'success' : 'gold');
    await loadEnhancedNetworking();
  } catch (err) {
    showToast(err.message || 'Connection failed', 'error');
  }
}

async function followMember(userId, isFollowing) {
  try {
    if (isFollowing) await API.unfollowUser(userId);
    else await API.followUser(userId);
    showToast(isFollowing ? 'Unfollowed' : 'Following', 'success');
    await loadEnhancedNetworking();
  } catch (err) {
    showToast(err.message || 'Could not update follow', 'error');
  }
}

function viewProfile(userId) {
  if (typeof switchSection === 'function') switchSection('profile');
  showToast('Open directory or messaging to interact with this member.', 'info');
}

async function openMessageFromNetwork(userId) {
  const row =
    (networkData.conversations || []).find((c) => c.id === userId) ||
    (networkData.connections || []).find((c) => c.id === userId);
  const name = row?.name || 'EPSA Member';
  if (typeof switchSection === 'function') switchSection('messaging');
  if (typeof openConversation === 'function') {
    await openConversation(userId, name);
  }
}

function formatTime(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

window.loadEnhancedNetworking = loadEnhancedNetworking;
window.switchNetworkView = switchNetworkView;
window.sendConnectionRequest = sendConnectionRequest;
window.followMember = followMember;
window.viewProfile = viewProfile;
window.openMessageFromNetwork = openMessageFromNetwork;
