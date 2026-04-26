(function () {
  const pages = {
    'index.html': 'home',
    'history.html': 'history',
    'ecosystem.html': 'ecosystem',
    'clubs.html': 'clubs',
    'partners.html': 'partners',
    'get-involved.html': 'involved'
  };

  function currentPageKey() {
    const path = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return pages[path] || '';
  }

  function injectDock() {
    if (document.querySelector('.public-mobile-dock')) return;
    const active = currentPageKey();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="public-mobile-dock">
        <nav aria-label="Mobile ecosystem navigation">
          <a class="public-mobile-link ${active === 'home' ? 'active' : ''}" href="index.html"><span>HM</span><span>Home</span></a>
          <a class="public-mobile-link ${active === 'history' ? 'active' : ''}" href="history.html"><span>HS</span><span>History</span></a>
          <a class="public-mobile-link ${active === 'ecosystem' ? 'active' : ''}" href="ecosystem.html"><span>HB</span><span>Hub</span></a>
          <a class="public-mobile-link ${active === 'clubs' ? 'active' : ''}" href="clubs.html"><span>CL</span><span>Clubs</span></a>
          <a class="public-mobile-link ${active === 'partners' ? 'active' : ''}" href="partners.html"><span>PT</span><span>Partners</span></a>
          <a class="public-mobile-link ${active === 'involved' ? 'active' : ''}" href="get-involved.html"><span>JN</span><span>Join</span></a>
        </nav>
      </div>
    `);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDock, { once: true });
  } else {
    injectDock();
  }
})();
