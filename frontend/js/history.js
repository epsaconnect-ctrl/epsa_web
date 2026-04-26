const HISTORY_API_ORIGIN = (() => {
  const explicit = window.EPSA_API_ORIGIN || window.EPSA_API_BASE || window.__EPSA_CONFIG__?.API_BASE_URL || localStorage.getItem('epsa_api_base') || '';
  if (explicit) return String(explicit).replace(/\/api\/?$/, '').replace(/\/$/, '');
  return window.location.origin;
})();
const HISTORY_API = `${HISTORY_API_ORIGIN}/api/history/public`;
let historyPayload = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function apiAsset(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/uploads/')) return `${HISTORY_API_ORIGIN}${url}`;
  return url;
}

function formatDate(value, withYear = true) {
  if (!value) return 'Term details pending';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function formatTerm(start, end) {
  if (!start && !end) return 'Term details pending';
  if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
  if (start) return `Since ${formatDate(start)}`;
  return `Until ${formatDate(end)}`;
}

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'EP';
}

function renderEmpty(message) {
  return `<div class="history-empty-state">${escapeHtml(message)}</div>`;
}

function renderFounders(founders = []) {
  const root = document.getElementById('historyFoundersGrid');
  if (!root) return;
  if (!founders.length) {
    root.innerHTML = renderEmpty('Founding coordinator records will appear here.');
    return;
  }
  root.innerHTML = founders.map((founder) => `
    <article class="history-founder-detail-card history-reveal">
      <img src="${escapeHtml(apiAsset(founder.image) || founder.image || '')}" alt="${escapeHtml(founder.name)}">
      <div class="history-founder-content">
        <div class="history-founder-pills">
          <span class="history-chip">${escapeHtml(founder.title || 'Founder')}</span>
          <span class="history-chip">${escapeHtml(founder.student_status || 'Student-led foundation')}</span>
        </div>
        <h3>${escapeHtml(founder.name)}</h3>
        <p>${escapeHtml(founder.summary || '')}</p>
        <ul class="history-contribution-list">
          ${(founder.contributions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    </article>
  `).join('');
}

function renderTimeline(timeline = []) {
  const root = document.getElementById('historyTimeline');
  if (!root) return;
  if (!timeline.length) {
    root.innerHTML = renderEmpty('Timeline milestones will appear here.');
    return;
  }
  root.innerHTML = timeline.map((item) => `
    <article class="history-timeline-card history-reveal">
      <div class="date">${escapeHtml(formatDate(item.date))}</div>
      <h3>${escapeHtml(item.label || '')}</h3>
      <p>${escapeHtml(item.description || '')}</p>
    </article>
  `).join('');
}

function memberCard(member, kind) {
  const photo = apiAsset(member.photo);
  const term = formatTerm(member.term_start, member.term_end);
  const meta = [
    member.university ? `University: ${member.university}` : '',
    member.vote_count != null && kind === 'nec' ? `Votes: ${member.vote_count}` : '',
    member.vote_rank ? `Rank: #${member.vote_rank}` : '',
    member.student_id ? `EPSA ID: ${member.student_id}` : '',
    kind === 'nec' && member.assignment_type ? `Assignment: ${member.assignment_type}` : ''
  ].filter(Boolean);
  const pills = [
    member.status || '',
    member.eligibility_status || '',
    member.midterm_status || '',
    member.engagement_status || ''
  ].filter(Boolean);
  return `
    <article class="history-member-card">
      <div class="history-member-top">
        <div class="history-avatar">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(member.name)}">` : escapeHtml(initials(member.name))}
        </div>
        <div>
          <h5>${escapeHtml(member.name)}</h5>
          <div class="history-member-role">${escapeHtml(member.role || member.title || 'Leadership Member')}</div>
        </div>
      </div>
      <div class="history-member-meta">
        <span>${escapeHtml(term)}</span>
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
      <div class="history-status-pill-row">
        ${pills.map((pill) => `<span class="history-status-pill">${escapeHtml(pill)}</span>`).join('')}
      </div>
      <p class="history-member-note">${escapeHtml(member.description || 'EPSA leadership record.')}</p>
    </article>
  `;
}

function matchesSearch(member, query) {
  if (!query) return true;
  const haystack = [
    member.name,
    member.role,
    member.title,
    member.university,
    member.description,
    member.status,
    member.assignment_type
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function matchesUniversity(member, university) {
  if (!university) return true;
  return (member.university || '').toLowerCase() === university.toLowerCase();
}

function renderMemberGroup(rootId, members, kind, options = {}) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (!members.length) {
    root.innerHTML = renderEmpty(options.emptyMessage || 'No records available.');
    return;
  }
  root.innerHTML = members.map((member) => memberCard(member, kind)).join('');
}

function renderUniversities(universities = []) {
  const select = document.getElementById('historyUniversityFilter');
  const map = document.getElementById('historyUniversityMap');
  if (select) {
    select.innerHTML = `<option value="">All Universities</option>${universities.map((u) => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join('')}`;
  }
  if (map) {
    if (!universities.length) {
      map.innerHTML = renderEmpty('University representation data will appear here.');
      return;
    }
    map.innerHTML = universities.map((u) => `
      <div class="history-university-chip">
        <strong>${escapeHtml(u.name)}</strong>
        <span>${escapeHtml(`${u.active_count || 0} active representative${(u.active_count || 0) === 1 ? '' : 's'}`)}</span>
      </div>
    `).join('');
  }
}

function renderGallery(items = []) {
  const root = document.getElementById('historyGallery');
  if (!root) return;
  if (!items.length) {
    root.innerHTML = renderEmpty('Media highlights will appear here as public records grow.');
    return;
  }
  root.innerHTML = items.map((item) => `
    <article class="history-gallery-card history-reveal">
      ${item.image ? `<img src="${escapeHtml(apiAsset(item.image))}" alt="${escapeHtml(item.title)}">` : ''}
      <div>
        <strong>${escapeHtml(item.title || 'EPSA milestone')}</strong>
        <p>${escapeHtml(item.excerpt || item.category || 'Institutional gallery item.')}</p>
      </div>
    </article>
  `).join('');
}

function renderResources(items = [], rootId, type) {
  const root = document.getElementById(rootId);
  if (!root) return;
  if (!items.length) {
    root.innerHTML = renderEmpty(type === 'links' ? 'Official links can be added here when confirmed.' : 'No public documents are linked yet.');
    return;
  }
  root.innerHTML = items.map((item) => `
    <div class="history-resource-item">
      <strong>${escapeHtml(item.title || item.label || 'EPSA resource')}</strong>
      <p>${escapeHtml(item.summary || item.note || 'Institutional record')}</p>
      ${item.url ? `<a href="${escapeHtml(apiAsset(item.url))}" target="_blank" rel="noopener noreferrer">Open resource</a>` : '<p style="margin-top:10px;font-weight:700;color:var(--text-muted);">Link pending confirmation</p>'}
    </div>
  `).join('');
}

function applyFilters() {
  if (!historyPayload) return;
  const query = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
  const university = document.getElementById('historyUniversityFilter')?.value || '';

  const nebCurrent = (historyPayload.neb?.current || []).filter((m) => matchesSearch(m, query));
  const nebPast = (historyPayload.neb?.past || []).filter((m) => matchesSearch(m, query));
  const necCurrent = (historyPayload.nec?.current || []).filter((m) => matchesSearch(m, query) && matchesUniversity(m, university));
  const necPast = (historyPayload.nec?.past || []).filter((m) => matchesSearch(m, query) && matchesUniversity(m, university));
  const nrcCurrent = (historyPayload.nrc?.current || []).filter((m) => matchesSearch(m, query) && matchesUniversity(m, university));
  const nrcPast = (historyPayload.nrc?.past || []).filter((m) => matchesSearch(m, query) && matchesUniversity(m, university));

  renderMemberGroup('nebCurrentGrid', nebCurrent, 'neb', { emptyMessage: 'No current NEB members match your search.' });
  renderMemberGroup('nebPastGrid', nebPast, 'neb', { emptyMessage: 'No past NEB records match your search.' });
  renderMemberGroup('necCurrentGrid', necCurrent, 'nec', { emptyMessage: 'No current NEC members match your search.' });
  renderMemberGroup('necPastGrid', necPast, 'nec', { emptyMessage: 'No past NEC records match your search.' });
  renderMemberGroup('nrcCurrentGrid', nrcCurrent, 'nrc', { emptyMessage: 'No current NRC members match your filters.' });
  renderMemberGroup('nrcPastGrid', nrcPast, 'nrc', { emptyMessage: 'No past NRC members match your filters.' });

  const nebCountPill = document.getElementById('nebCountPill');
  const necCountPill = document.getElementById('necCountPill');
  if (nebCountPill) nebCountPill.textContent = `${nebCurrent.length} current`;
  if (necCountPill) necCountPill.textContent = `${necCurrent.length} current`;
}

function hydrateHero(data) {
  const title = document.getElementById('historyHeroTitle');
  const summary = document.getElementById('historyHeroSummary');
  const announcement = document.getElementById('historyAnnouncement');
  if (title) title.textContent = data.overview?.title || 'History of EPSA';
  if (summary) summary.textContent = data.overview?.summary || summary.textContent;
  if (announcement) announcement.textContent = data.overview?.announcement || announcement.textContent;
  document.getElementById('historyStatFounders').textContent = data.founders?.length || 0;
  document.getElementById('historyStatNeb').textContent = data.neb?.current?.length || 0;
  document.getElementById('historyStatNec').textContent = data.nec?.current?.length || 0;
  document.getElementById('historyStatNrc').textContent = data.nrc?.current?.length || 0;
}

async function loadHistoryArchive() {
  try {
    const res = await fetch(HISTORY_API);
    if (!res.ok) throw new Error('Unable to load history archive');
    historyPayload = await res.json();
    hydrateHero(historyPayload);
    renderTimeline(historyPayload.timeline || []);
    renderFounders(historyPayload.founders || []);
    renderUniversities(historyPayload.nrc?.universities || []);
    renderGallery(historyPayload.gallery || []);
    renderResources(historyPayload.documents || [], 'historyDocuments', 'documents');
    renderResources(historyPayload.external_links || [], 'historyLinks', 'links');
    applyFilters();
    attachRevealObserver();
  } catch (err) {
    const sections = ['historyTimeline', 'historyFoundersGrid', 'nebCurrentGrid', 'necCurrentGrid', 'nrcCurrentGrid', 'historyGallery', 'historyDocuments', 'historyLinks'];
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = renderEmpty('History data is temporarily unavailable.');
    });
    console.warn(err);
  }
}

function attachRevealObserver() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.history-reveal').forEach((el) => observer.observe(el));
}

function setupNav() {
  const navbar = document.getElementById('navbar');
  const handleScroll = () => {
    if (!navbar) return;
    navbar.classList.toggle('scrolled', window.scrollY > 32);
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  const hamburger = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  if (hamburger && mobileMenu) {
    let open = false;
    const closeMenu = () => {
      open = false;
      mobileMenu.style.display = 'none';
      hamburger.querySelectorAll('span').forEach((span) => {
        span.style.transform = '';
        span.style.opacity = '';
      });
    };
    hamburger.addEventListener('click', () => {
      open = !open;
      mobileMenu.style.display = open ? 'block' : 'none';
      const spans = hamburger.querySelectorAll('span');
      if (open) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        closeMenu();
      }
    });
    mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  }
}

function setupFilters() {
  document.getElementById('historySearch')?.addEventListener('input', applyFilters);
  document.getElementById('historyUniversityFilter')?.addEventListener('change', applyFilters);
}

setupNav();
setupFilters();
attachRevealObserver();
loadHistoryArchive();
