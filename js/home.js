// ════════════════════════════════════════════════
// EPSA HOME PAGE — Animations, Counters, Effects
// ════════════════════════════════════════════════

// ── Toast System ──────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', gold: '⭐', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || '✅'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
window.showToast = showToast;

// ── Navbar Scroll Effect ──────────────────────
const navbar = document.getElementById('navbar');
const handleScroll = () => {
  if (window.scrollY > 50) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
};
window.addEventListener('scroll', handleScroll, { passive: true });
handleScroll();

// ── Mobile Menu ───────────────────────────────
const hamburger = document.getElementById('nav-hamburger');
const mobileMenu = document.getElementById('mobile-menu');
let menuOpen = false;
if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    menuOpen = !menuOpen;
    mobileMenu.style.display = menuOpen ? 'block' : 'none';
    const spans = hamburger.querySelectorAll('span');
    if (menuOpen) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity   = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    }
  });
  // Close on nav link click
  mobileMenu.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      menuOpen = false;
      mobileMenu.style.display = 'none';
      hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    });
  });
}

// ── Particle Generator ────────────────────────
function generateParticles() {
  const container = document.getElementById('heroParticles');
  if (!container) return;
  const count = 18;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left   = `${Math.random() * 100}%`;
    p.style.width  = `${Math.random() * 4 + 2}px`;
    p.style.height = p.style.width;
    p.style.animationDuration  = `${Math.random() * 12 + 8}s`;
    p.style.animationDelay     = `${Math.random() * 8}s`;
    p.style.opacity = Math.random() * 0.6 + 0.2;
    container.appendChild(p);
  }
}
generateParticles();

// ── Smooth Anchor Scrolling ───────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Intersection Observer — Reveal ───────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── Animated Counters ─────────────────────────
function animateCounter(el) {
  const target  = parseInt(el.dataset.target, 10);
  const suffix  = el.dataset.suffix || '';
  const duration = 2000;
  const steps    = 60;
  const increment = target / steps;
  let current = 0;
  const timer = setInterval(() => {
    current = Math.min(current + increment, target);
    el.textContent = Math.floor(current).toLocaleString() + suffix;
    if (current >= target) clearInterval(timer);
  }, duration / steps);
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.counter').forEach(animateCounter);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.stats-grid').forEach(el => counterObserver.observe(el));

const HOME_API_ORIGIN = (() => {
  const explicit = window.EPSA_API_ORIGIN || window.EPSA_API_BASE || window.__EPSA_CONFIG__?.API_BASE_URL || localStorage.getItem('epsa_api_base') || '';
  if (explicit) {
    return String(explicit).replace(/\/api\/?$/, '').replace(/\/$/, '');
  }
  return window.location.origin;
})();

function homeApiUrl(path) {
  return `${HOME_API_ORIGIN}${path}`;
}

function homeMediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${HOME_API_ORIGIN}${path}`;
}

// ── Leadership — Load from API ────────────────
async function loadLeadership() {
  try {
    const res = await fetch(homeApiUrl('/api/leadership/public'));
    if (!res.ok) return;
    const data = await res.json();

    const nebGrid = document.getElementById('publicNebGrid');
    if (nebGrid && data.neb_appointed) {
      if (data.neb_appointed.length) {
        nebGrid.innerHTML = data.neb_appointed.map((a, i) => `
          <div class="leader-card neb-card reveal revealed" style="transition-delay: ${i*0.08}s">
            <div class="card-hover-info">${a.bio || 'Advising Authority'}</div>
            <div class="leader-photo-wrap">
              ${a.photo ? `<img src="${homeMediaUrl(a.photo)}" class="leader-photo">` : `<div class="leader-avatar-placeholder">🏛️</div>`}
              <div class="leader-role-badge">⭐</div>
            </div>
            <div class="leader-name">${a.name}</div>
            <div class="leader-position">${a.position}</div>
            <div class="leader-badge-pill">${a.hierarchy} Authority</div>
          </div>
        `).join('');
      } else {
        nebGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:var(--space-6);color:var(--text-muted);">Awaiting Board Appointments</div>';
      }
    }

    const necGrid = document.getElementById('publicNecGrid');
    if (necGrid && data.nec) {
      if (data.nec.length) {
        necGrid.innerHTML = data.nec.map((e, i) => `
          <div class="leader-card nec-card reveal revealed" style="transition-delay: ${i*0.08}s">
            <div class="card-hover-info">Elected Executive — ${e.university}</div>
            <div class="leader-photo-wrap">
              ${e.photo ? `<img src="${homeMediaUrl(e.photo)}" class="leader-photo">` : `<div class="leader-avatar-placeholder">🎓</div>`}
              <div class="leader-role-badge">${e.rank === 1 ? '👑' : '⭐'}</div>
            </div>
            <div class="leader-name">${e.name}</div>
            <div class="leader-position">${e.position}</div>
            <div class="leader-badge-pill executive-pill">Executive Authority</div>
          </div>
        `).join('');
      } else {
        necGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:var(--space-6);color:var(--text-muted);">Elections in Progress</div>';
      }
    }

    const nrcGrid = document.getElementById('publicNrcGrid');
    if (nrcGrid && data.nrc) {
      if (data.nrc.length) {
        nrcGrid.innerHTML = `
          <div class="nrc-info">
            Elected Representatives across ${data.nrc.length} Ethiopian Universities.
          </div>
          <div class="nrc-avatars">
            ${data.nrc.slice(0, 5).map((r,i) => `
              <div class="nrc-avatar" style="z-index:${10-i};" title="${r.name} - ${r.university}">
                ${r.photo ? `<img src="${homeMediaUrl(r.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-full);">` : '👨🏾‍🎓'}
              </div>
            `).join('')}
            ${data.nrc.length > 5 ? `<div class="nrc-avatar nrc-more">+${data.nrc.length-5}</div>` : ''}
          </div>
          <div class="leader-badge-pill rep-pill">Representative Level</div>
        `;
      } else {
        nrcGrid.innerHTML = '<div style="text-align:center;padding:var(--space-6);color:var(--text-muted);">University Rep Elections in Progress</div>';
      }
    }
  } catch (err) { console.warn('Leadership load failed', err); }
}
loadLeadership();

async function enhanceNRCPublicDisplay() {
  const nrcGrid = document.getElementById('publicNrcGrid');
  if (!nrcGrid) return;
  try {
    const res = await fetch(homeApiUrl('/api/leadership/public'));
    if (!res.ok) return;
    const data = await res.json();
    if (!data.nrc || !data.nrc.length) return;
    nrcGrid.innerHTML = `
      <div class="nrc-info" style="display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap;padding:20px 22px;border-radius:26px;background:linear-gradient(135deg,rgba(16,59,32,0.86),rgba(10,30,17,0.92));border:1px solid rgba(200,163,64,0.18);">
        <div style="max-width:560px;">
          <div style="font-size:0.74rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.54);margin-bottom:8px;">National Representatives Council</div>
          <div style="font-family:var(--font-display);font-size:1.35rem;font-weight:800;color:white;">${data.nrc.length} universities are now represented in the national council.</div>
          <div style="font-size:0.86rem;color:rgba(255,255,255,0.72);line-height:1.75;margin-top:10px;">Each representative connects their university's psychology students with national EPSA governance, elections, communication, and accountability processes.</div>
        </div>
        <div class="leader-badge-pill rep-pill">Representative Level</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:18px;">
        ${data.nrc.map((r) => `
          <div class="leader-card reveal revealed" style="background:linear-gradient(180deg,rgba(17,40,24,0.96),rgba(10,25,15,0.96));border:1px solid rgba(200,163,64,0.15);box-shadow:0 28px 60px rgba(0,0,0,0.28);">
            <div class="card-hover-info">${r.term_end ? `Term ends ${new Date(r.term_end).toLocaleDateString()}` : 'Representative term active'}</div>
            <div class="leader-photo-wrap">
              ${r.photo ? `<img src="${homeMediaUrl(r.photo)}" class="leader-photo">` : `<div class="leader-avatar-placeholder">UR</div>`}
              <div class="leader-role-badge">UR</div>
            </div>
            <div class="leader-name">${r.name}</div>
            <div class="leader-position">${r.university}</div>
            <div class="leader-badge-pill rep-pill">${r.status || 'active'} representative</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.warn('NRC public display enhancement failed', err);
  }
}
enhanceNRCPublicDisplay();

// ── News — Load from API ──────────────────────
async function loadPublicNews() {
  const wrapper = document.getElementById('homeNewsWrapper');
  if (!wrapper) return;
  try {
    const res = await fetch(homeApiUrl('/api/news'));
    if (!res.ok) throw new Error('API error');
    const news = await res.json();
    if (!news.length) {
      wrapper.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:var(--space-8);">No news updates at this moment.</div>';
      return;
    }

    const featured = news.find(n => n.is_featured) || news[0];
    const rest = news.filter(n => n.id !== featured.id).slice(0, 4);

    let html = `
      <div class="news-featured reveal revealed">
        <div class="news-featured-img">
          ${featured.image_url ? `<img src="${homeMediaUrl(featured.image_url)}" style="width:100%;height:100%;object-fit:cover;">` : '📢'}
          <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(13,31,18,0.6),transparent);"></div>
          <div style="position:absolute;bottom:20px;left:20px;">
            <span class="news-category">📅 ${formatRelativeDate(featured.created_at)}</span>
          </div>
        </div>
        <div class="news-featured-body">
          <span class="news-category">${featured.category}</span>
          <h3 class="news-card-title">${featured.title}</h3>
          <p class="news-card-excerpt">${featured.excerpt}</p>
        </div>
      </div>
    `;

    if (rest.length > 0) {
      const colors = ['var(--epsa-gold)', '#2563eb', '#16a34a', '#8b5cf6'];
      html += `<div class="news-sidebar">`;
      html += rest.map((n, i) => `
        <div class="news-small-card reveal revealed" style="border-left-color:${colors[i%colors.length]};">
          <span class="news-category" style="font-size:0.7rem; padding:2px 8px;">${n.category}</span>
          <div class="news-small-title">${n.title}</div>
          <div class="news-small-date">📅 ${formatRelativeDate(n.created_at)}</div>
        </div>
      `).join('');
      html += `</div>`;
    }
    wrapper.innerHTML = html;
  } catch(err) {
    wrapper.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:var(--space-8);color:red;">Unable to fetch latest news.</div>';
  }
}
loadPublicNews();

// ── News Date Formatting ──────────────────────
function formatRelativeDate(dateStr) {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Active Nav Link Highlight on Scroll ───────
const sections  = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav-link');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.style.color = link.getAttribute('href') === `#${entry.target.id}`
          ? 'white' : 'rgba(255,255,255,0.8)';
      });
    }
  });
}, { threshold: 0.4 });

sections.forEach(s => sectionObserver.observe(s));

// ── Parallax Hero ─────────────────────────────
window.addEventListener('scroll', () => {
  const heroImg = document.querySelector('.hero-bg img');
  if (heroImg) {
    const scrolled = window.scrollY;
    heroImg.style.transform = `scale(1.05) translateY(${scrolled * 0.25}px)`;
  }
}, { passive: true });

// ── Stagger Leadership Cards ──────────────────
document.querySelectorAll('.leader-card').forEach((card, i) => {
  card.style.transitionDelay = `${i * 0.08}s`;
});

console.log('%c🧠 EPSA Platform', 'font-size:20px; font-weight:bold; color:#1a6b3c;');
console.log('%cEthiopian Psychology Students\' Association', 'color:#c8a340;');

// ── Clubs Network — Load from API ────────────

let _homeClubsData = [];
let _homePartnersData = [];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildShowcaseTrack(items, mapper, extraClass = '') {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return '';
  const mapped = safeItems.map(mapper).join('');
  const duplicated = safeItems.length > 1 ? mapped + mapped : mapped;
  return `
    <div class="hp-showcase-marquee">
      <div class="hp-showcase-track ${extraClass}">${duplicated}</div>
    </div>
  `;
}

async function loadHomeClubs() {
  const slider = document.getElementById('homeClubsSlider');
  if (!slider) return;
  try {
    const res = await fetch(homeApiUrl('/api/clubs'));
    if (!res.ok) throw new Error();
    const clubs = await res.json();
    _homeClubsData = clubs;
    if (!clubs.length) {
      slider.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted);">
        <div style="font-size:2.5rem;margin-bottom:12px;">🏛️</div>
        <div style="font-weight:700;margin-bottom:8px;">No verified clubs yet</div>
        <div style="font-size:0.85rem;">Be the first to <a href="get-involved.html#clubs" style="color:var(--epsa-green);font-weight:700;">register your university club →</a></div>
      </div>`;
      return;
    }
    const visibleClubs = clubs.slice(0, 8);
    slider.innerHTML = buildShowcaseTrack(visibleClubs, (c, i) => {
      const image = c.cover_image_url || c.logo_url;
      const leader = (c.leadership || [])[0]?.name || c.president_name || 'Leadership registered with EPSA';
      return `
        <article class="hp-showcase-card club-card" onclick="showHomeClubModal(${i % visibleClubs.length})">
          <div class="hp-showcase-media">
            ${image ? `<img src="${homeMediaUrl(image)}" alt="${escapeHtml(c.name)}">` : ''}
          </div>
          <div class="hp-showcase-hover">
            <strong>About This Chapter</strong>
            <p>${escapeHtml(c.description || 'Verified EPSA chapter building campus-level psychology leadership and activity.')}</p>
            <em>Lead contact: ${escapeHtml(leader)}</em>
          </div>
          <div class="hp-showcase-content">
            <div class="hp-showcase-kicker">Verified EPSA Club</div>
            <div class="hp-showcase-title">${escapeHtml(c.name)}</div>
            <div class="hp-showcase-subtitle">🏫 ${escapeHtml(c.university)}</div>
            <div class="hp-showcase-meta">
              <span>👥 ${c.member_count || c.live_member_count || 0} members</span>
              <span>📣 ${c.activity_count || 0} activities</span>
              <span>❤️ ${c.follower_count || 0} followers</span>
            </div>
          </div>
        </article>
      `;
    });
  } catch(e) {
    slider.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
      Clubs loading offline. <a href="clubs.html" style="color:var(--epsa-green);font-weight:600;">Visit directory →</a>
    </div>`;
  }
}
loadHomeClubs();

function showHomeClubModal(idx) {
  const c = _homeClubsData[idx];
  if (!c) return;
  const modal = document.getElementById('homeClubModal');
  document.getElementById('hcmName').textContent = c.name;
  document.getElementById('hcmUni').textContent = '🏫 ' + c.university;
  document.getElementById('hcmDesc').textContent = c.description || 'Active EPSA university chapter.';

  const logoEl = document.getElementById('hcmLogo');
  if (c.logo_url) {
    logoEl.innerHTML = `<img src="${homeMediaUrl(c.logo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">`;
  } else {
    logoEl.innerHTML = '🏛️';
  }

  document.getElementById('hcmStats').innerHTML = `
    <div style="background:var(--light-100);padding:10px 16px;border-radius:12px;text-align:center;">
      <div style="font-family:var(--font-display);font-weight:800;font-size:1.3rem;color:var(--epsa-green);">${c.member_count || c.live_member_count || 0}</div>
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;">Members</div>
    </div>
    <div style="background:var(--light-100);padding:10px 16px;border-radius:12px;text-align:center;">
      <div style="font-family:var(--font-display);font-weight:800;font-size:1.3rem;color:var(--epsa-gold);">${c.follower_count || 0}</div>
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;">Followers</div>
    </div>
    <div style="background:var(--light-100);padding:10px 16px;border-radius:12px;text-align:center;">
      <div style="font-family:var(--font-display);font-weight:800;font-size:1.3rem;">${c.activity_count || 0}</div>
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;">Activities</div>
    </div>
  `;

  const leaderEl = document.getElementById('hcmLeadership');
  if (c.leadership && c.leadership.length) {
    leaderEl.innerHTML = c.leadership.map(l => `
      <div style="background:var(--light-100);padding:6px 12px;border-radius:8px;font-size:0.78rem;">
        <span style="font-weight:700;text-transform:capitalize;">${l.role}</span>: ${l.name}
      </div>
    `).join('');
  } else {
    leaderEl.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;">${c.president_name ? `President: ${c.president_name}` : 'Leadership info not available'}</div>`;
  }

  modal.classList.add('active');
}

// ── Partners — Load from API ──────────────────
async function loadHomePartners() {
  const grid = document.getElementById('homePartnersGrid');
  if (!grid) return;
  const catColors = { NGO: '#4ade80', Hospital: '#f472b6', University: '#60a5fa', Government: '#fbbf24', Clinic: '#c084fc', Research: '#fb923c', Strategic: '#818cf8' };
  try {
    const res = await fetch(homeApiUrl('/api/partners'));
    if (!res.ok) throw new Error();
    const partners = await res.json();
    if (!partners.length) {
      grid.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;padding:48px;text-align:center;width:100%;">No partners listed yet.</div>`;
      return;
    }
    _homePartnersData = partners;
    const visiblePartners = partners.slice(0, 8);
    grid.innerHTML = buildShowcaseTrack(visiblePartners, (p) => {
      const color = catColors[p.category] || '#60a5fa';
      const image = (p.gallery && p.gallery[0]?.image_url) || p.logo_url;
      const descriptor = p.what_they_do || p.description || 'Supporting EPSA programming and student impact across Ethiopia.';
      return `
        <a href="partners.html" class="hp-showcase-card hp-partner-card partner-card">
          <div class="hp-showcase-media">
            ${image ? `<img src="${homeMediaUrl(image)}" alt="${escapeHtml(p.name)}">` : ''}
          </div>
          <div class="hp-showcase-hover">
            <strong>Partner Snapshot</strong>
            <p>${escapeHtml(descriptor)}</p>
            <em>${escapeHtml(p.partnership_type || 'Strategic')} · ${escapeHtml(p.category || 'Partner')}</em>
          </div>
          <div class="hp-showcase-content">
            <div class="hp-showcase-kicker" style="color:${color};">${escapeHtml(p.partnership_type || 'Strategic')} Partner</div>
            <div class="hp-showcase-title">${escapeHtml(p.name)}</div>
            <div class="hp-showcase-subtitle" style="color:${color};">${escapeHtml(p.category || 'Partner')}</div>
            <div class="hp-showcase-meta">
              <span>${escapeHtml(p.category || 'Partner')}</span>
              <span>${escapeHtml(p.partnership_type || 'Strategic')}</span>
            </div>
          </div>
        </a>`;
    }, 'partner-track');
  } catch(e) {
    grid.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;padding:48px;text-align:center;width:100%;"><a href="partners.html" style="color:var(--epsa-green);font-weight:600;">View partners →</a></div>`;
  }
}
loadHomePartners();

// ── Funding Transparency — Load from API ────────
async function loadHomeFunding() {
  const poolEl    = document.getElementById('hf-pool');
  const awardedEl = document.getElementById('hf-awarded');
  const spentEl   = document.getElementById('hf-spent');
  const grList    = document.getElementById('homeRecentGrants');
  const section   = document.querySelector('.hp-funding-section .container');
  if (!poolEl) return;
  try {
    const res = await fetch(homeApiUrl('/api/clubs/funding/overview'));
    if (!res.ok) throw new Error();
    const data = await res.json();
    const fundedProjects = Array.isArray(data.funded_projects) ? data.funded_projects : [];
    poolEl.textContent    = `ETB ${Number(data.grant_pool_total || 0).toLocaleString()}`;
    awardedEl.textContent = `ETB ${Number(data.allocated_total ?? data.total_funded ?? 0).toLocaleString()}`;
    spentEl.textContent   = `ETB ${Number(data.verified_spend ?? data.total_spent ?? 0).toLocaleString()}`;
    poolEl.parentElement?.setAttribute('title', data.term_definitions?.total_grant_pool || '');
    awardedEl.parentElement?.setAttribute('title', data.term_definitions?.funds_awarded || '');
    spentEl.parentElement?.setAttribute('title', data.term_definitions?.verified_spend || '');
    if (section && !document.getElementById('homeFundingGuide')) {
      const stats = document.querySelector('.hp-funding-stats');
      if (stats) {
        stats.insertAdjacentHTML('afterend', `
          <div id="homeFundingGuide" class="hp-funding-note-grid"></div>
        `);
      }
    }
    if (section && !document.getElementById('homeGrantSources')) {
      const grantsList = document.querySelector('.hp-grants-list');
      if (grantsList) {
        grantsList.insertAdjacentHTML('afterend', `
          <div id="homeGrantSources" class="hp-grants-list" style="margin-top:18px;">
            <div class="hp-grants-title">Funding Partners & Supporters</div>
            <div id="homeGrantSourceItems" class="hp-grants-items"></div>
          </div>
        `);
      }
    }
    const guide = document.getElementById('homeFundingGuide');
    const sourceBox = document.getElementById('homeGrantSourceItems');
    if (guide) {
      const defs = data.term_definitions || {};
      guide.innerHTML = `
        <div class="hp-funding-note">
          <strong>Total Grant Pool</strong>
          <p>${escapeHtml(defs.total_grant_pool || 'All committed money recorded for EPSA grants from partners and supporters.')}</p>
        </div>
        <div class="hp-funding-note">
          <strong>Funds Awarded</strong>
          <p>${escapeHtml(defs.funds_awarded || 'Money already allocated by EPSA to approved club proposals.')}</p>
        </div>
        <div class="hp-funding-note">
          <strong>Verified Spend</strong>
          <p>${escapeHtml(defs.verified_spend || 'Amount already checked against submitted financial reports and receipts.')}</p>
        </div>
      `;
    }
    if (!fundedProjects.length) {
      if (grList) grList.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:0.85rem;">No projects funded yet — <a href="get-involved.html#grants" style="color:var(--epsa-green);font-weight:600;">learn how to apply</a></div>`;
    } else if (grList) {
      grList.innerHTML = fundedProjects.slice(0, 4).map(p => {
        const award = p.funded_amount || p.budget || 0;
        const status = p.status === 'completed' ? 'Verified' : p.status === 'funded' ? 'Funded' : 'In Progress';
        const statusColor = p.status === 'completed' ? 'rgba(22,163,74,0.12);color:#15803d' : 'rgba(37,99,235,0.12);color:#1d4ed8';
        return `
        <div style="background:var(--off-white);border-radius:16px;border:1px solid var(--light-200);padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:18px;transition:all 0.2s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform=''">
          <div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
              <div style="font-weight:700;font-size:0.92rem;">${p.title}</div>
              <span style="padding:3px 9px;border-radius:999px;font-size:0.66rem;font-weight:700;${statusColor}">${status}</span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);">By ${p.club_name} · 🏫 ${p.university}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:var(--font-display);font-weight:800;color:var(--epsa-gold);font-size:1.05rem;">ETB ${award.toLocaleString()}</div>
            <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Allocated</div>
          </div>
        </div>
      `;
      }).join('');
    }
    if (sourceBox) {
      const sources = data.grant_sources || [];
      sourceBox.innerHTML = sources.length ? sources.map(src => `
        <div style="background:white;border-radius:14px;border:1px solid var(--light-200);padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <div style="font-weight:700;font-size:0.88rem;">${src.title}</div>
            <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">${src.partner_name || src.sponsor_name} · ${src.sponsor_type}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;color:var(--epsa-green);">ETB ${((src.amount_received || src.amount_committed || 0)).toLocaleString()}</div>
            <div style="font-size:0.66rem;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Available</div>
          </div>
        </div>
      `).join('') : '<div style="text-align:center;padding:26px;color:var(--text-muted);font-size:0.84rem;">Funding supporters will appear here when the admin records grant sources.</div>';
    }
  } catch(e) {
    poolEl.textContent = 'ETB —';
    awardedEl.textContent = 'ETB —';
    spentEl.textContent = 'ETB —';
    if (grList) grList.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:0.85rem;">Funding data offline.</div>`;
  }
}
loadHomeFunding();

async function loadHistoryPreview() {
  const foundersCount = document.getElementById('historyFoundersCount');
  const necCount = document.getElementById('historyNecCount');
  const nrcCount = document.getElementById('historyNrcCount');
  if (!foundersCount || !necCount || !nrcCount) return;
  try {
    const res = await fetch(homeApiUrl('/api/history/public'));
    if (!res.ok) return;
    const data = await res.json();
    foundersCount.textContent = data.founders?.length || 0;
    necCount.textContent = data.nec?.current?.length || 0;
    nrcCount.textContent = data.nrc?.current?.length || 0;
  } catch (err) {
    console.warn('History preview load failed', err);
  }
}
loadHistoryPreview();

function initHomeLiveRefresh() {
  const refresh = () => {
    loadHomeClubs();
    loadHomePartners();
    loadHomeFunding();
  };

  let refreshTimer = setInterval(refresh, 45000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(refreshTimer);
      return;
    }
    refresh();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 45000);
  });

  window.addEventListener('focus', refresh);
}
initHomeLiveRefresh();
