// ════════════════════════════════════════════════
// EPSA MESSAGING SYSTEM
// ════════════════════════════════════════════════

let activeConversation = null;
let conversations      = [];
let messagePollingInterval = null;

function normalizeConversation(c) {
  const name = (c && (c.name || c.full_name)) || 'Member';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    c.initials ||
    (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
  return {
    id: c.id,
    name,
    initials,
    uni: c.uni || '',
    lastMsg: c.lastMsg || '',
    time: c.time,
    unread: Number(c.unread) || 0,
    is_staff: !!c.is_staff,
  };
}

async function refreshSupportBanner() {
  const banner = document.getElementById('messagingSupportBanner');
  if (!banner) return;
  const u = API.getUser();
  if (!u || u.role === 'admin' || u.role === 'super_admin') {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  try {
    const contact = await API.getSupportContact();
    banner.style.display = 'block';
    const safe = (contact.name || 'EPSA Administration').replace(/</g, '&lt;');
    banner.innerHTML = `
      <div class="messaging-support-inner">
        <div>
          <div class="messaging-support-title">Need help from national office?</div>
          <div class="messaging-support-sub">Message <strong>${safe}</strong> for account, exams, or voting support.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="messagingSupportOpenBtn">Message admin</button>
      </div>`;
    const btn = document.getElementById('messagingSupportOpenBtn');
    if (btn) {
      btn.onclick = () => openConversation(contact.id, contact.name || 'EPSA Administration');
    }
  } catch (_) {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
}

async function loadConversations() {
  try {
    const data = await API.getConversations();
    conversations = (Array.isArray(data) ? data : []).map(normalizeConversation);
  } catch (err) {
    console.error(err);
    conversations = [];
    if (typeof showToast === 'function') {
      showToast('Could not load conversations. Try refreshing.', 'error');
    }
  }
  await refreshSupportBanner();
  renderConversationList();

  // Update message badge count
  const unreadCount = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  const badge = document.getElementById('msgBadge');
  if (badge) {
    if (unreadCount > 0) { badge.textContent = unreadCount; badge.style.display = 'inline-block'; }
    else badge.style.display = 'none';
  }
}
window.loadConversations = loadConversations;

function formatMsgTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderConversationList() {
  const list = document.getElementById('conversationList'); if (!list) return;
  if (!conversations.length) {
    list.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);font-size:0.85rem;">No conversations yet.<br>Connect with students to start chatting!</div>`;
    return;
  }
  list.innerHTML = conversations.map(c => `
    <div class="chat-conversation-item ${activeConversation?.id === c.id ? 'active' : ''}"
         onclick="openConversation(${c.id},'${c.name}')">
      <div class="chat-conv-avatar" style="font-size:0.85rem;">${c.initials}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="chat-conv-name">${c.name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">${formatMsgTime(c.time)}</div>
        </div>
        <div class="chat-conv-preview">${c.lastMsg}</div>
      </div>
      ${c.unread ? `<span style="width:18px;height:18px;border-radius:50%;background:var(--epsa-green);color:white;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${c.unread}</span>` : ''}
    </div>`).join('');
}

async function openConversation(userId, name) {
  activeConversation = conversations.find(c => c.id === userId) || { id: userId, name, initials: name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase(), unread: 0 };
  activeConversation.unread = 0;

  // Update partner header
  const partnerName = document.getElementById('chatPartnerName');
  const partnerUni  = document.getElementById('chatPartnerUni');
  const partnerAvtr = document.getElementById('chatPartnerAvatar');
  if (partnerName) partnerName.textContent = name;
  if (partnerAvtr) partnerAvtr.textContent = activeConversation.initials || name.slice(0,2).toUpperCase();
  if (partnerUni) {
    const s = conversations.find(c=>c.id===userId);
    partnerUni.textContent = s?.uni || '';
  }

  renderConversationList(); // re-render to highlight active

  let messages = [];
  try {
    const data = await API.getMessages(userId);
    if (Array.isArray(data)) messages = data;
  } catch (_) {}

  renderMessages(messages);
  if (messagePollingInterval) clearInterval(messagePollingInterval);
  // Poll every 5s in real mode
  messagePollingInterval = setInterval(() => pollNewMessages(userId), 5000);
}
window.openConversation = openConversation;

function renderMessages(messages) {
  const box = document.getElementById('chatMessages'); if (!box) return;
  box.innerHTML = messages.map(m => `
    <div class="msg-bubble ${m.from === 'me' ? 'sent' : 'received'}">
      <div>${m.text}</div>
      <div style="font-size:0.65rem;opacity:0.65;margin-top:4px;text-align:${m.from==='me'?'right':'left'};">${formatMsgTime(m.time)}</div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function appendMessage(text, from) {
  const box = document.getElementById('chatMessages'); if (!box) return;
  const div = document.createElement('div');
  div.className = `msg-bubble ${from === 'me' ? 'sent' : 'received'}`;
  div.innerHTML = `<div>${text}</div><div style="font-size:0.65rem;opacity:0.65;margin-top:4px;text-align:${from==='me'?'right':'left'};">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  if (!activeConversation) { showToast('Please select a conversation first','error'); return; }
  const input = document.getElementById('chatInput'); if (!input) return;
  const text  = input.value.trim(); if (!text) return;

  input.value = '';
  appendMessage(text, 'me');

  try { await API.sendMessage(activeConversation.id, text); } catch(_) {}

  // Update last message in sidebar
  const conv = conversations.find(c => c.id === activeConversation.id);
  if (conv) conv.lastMsg = text;
  renderConversationList();
}
window.sendChatMessage = sendChatMessage;

async function pollNewMessages(userId) {
  if (!activeConversation || activeConversation.id !== userId) return;
  try {
    const data = await API.getMessages(userId);
    if (Array.isArray(data)) renderMessages(data);
  } catch(_) {}
}

const chatSearch = document.getElementById('chatSearch');
if (chatSearch) {
  chatSearch.addEventListener('input', () => {
    const q = chatSearch.value.trim().toLowerCase();
    if (!q) return renderConversationList();
    const list = document.getElementById('conversationList');
    if (!list) return;
    const filtered = conversations.filter(c =>
      `${c.name} ${c.uni} ${c.lastMsg}`.toLowerCase().includes(q)
    );
    list.innerHTML = filtered.length ? filtered.map(c => `
      <div class="chat-conversation-item ${activeConversation?.id === c.id ? 'active' : ''}" onclick="openConversation(${c.id},'${c.name}')">
        <div class="chat-conv-avatar" style="font-size:0.85rem;">${c.initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="chat-conv-name">${c.name}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">${formatMsgTime(c.time)}</div>
          </div>
          <div class="chat-conv-preview">${c.lastMsg}</div>
        </div>
      </div>`).join('') : `<div style="padding:var(--space-6);text-align:center;color:var(--text-muted);font-size:0.85rem;">No conversations match your search.</div>`;
  });
}
