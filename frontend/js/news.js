function newsEscapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNewsDate(value) {
  if (!value) return 'Recently posted';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Recently posted';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function newsImageUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return API.toAbsoluteUrl(path);
}

function resolveNewsItemImage(item) {
  return newsImageUrl(item?.image_api_url || item?.image_url || '');
}

function readNewsQueryId() {
  const raw = new URLSearchParams(window.location.search).get('id');
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function renderNewsDetail(item) {
  const panel = document.getElementById('newsDetailPanel');
  if (!panel) return;
  if (!item) {
    panel.innerHTML = '<div class="news-detail-empty">This update could not be found.</div>';
    return;
  }
  panel.innerHTML = `
    ${(item.image_api_url || item.image_url) ? `<div class="news-detail-media"><img src="${resolveNewsItemImage(item)}" alt="${newsEscapeHtml(item.title)}"></div>` : ''}
    <div class="news-detail-body">
      <div class="news-detail-meta">
        <span class="news-category">${newsEscapeHtml(item.category || 'Update')}</span>
        <span class="news-detail-date">${formatNewsDate(item.created_at)}</span>
      </div>
      <h2 class="news-detail-title">${newsEscapeHtml(item.title)}</h2>
      ${item.excerpt ? `<p class="news-detail-excerpt">${newsEscapeHtml(item.excerpt)}</p>` : ''}
      <div class="news-detail-content">${newsEscapeHtml(item.content || item.excerpt || 'Full details will be added soon.')}</div>
    </div>
  `;
}

function renderNewsArchive(items, selectedId) {
  const grid = document.getElementById('newsArchiveGrid');
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="news-detail-empty">No news or event updates have been published yet.</div>';
    return;
  }
  grid.innerHTML = items.map((item) => `
    <a class="news-archive-card" href="news.html?id=${item.id}" ${selectedId === item.id ? 'aria-current="page"' : ''}>
      <div class="news-archive-image">
        ${(item.image_api_url || item.image_url) ? `<img src="${resolveNewsItemImage(item)}" alt="${newsEscapeHtml(item.title)}">` : ''}
      </div>
      <div class="news-archive-content">
        <div class="news-detail-meta" style="margin-bottom:12px;">
          <span class="news-category">${newsEscapeHtml(item.category || 'Update')}</span>
          <span class="news-detail-date">${formatNewsDate(item.created_at)}</span>
        </div>
        <div class="news-archive-title">${newsEscapeHtml(item.title)}</div>
        <div class="news-archive-excerpt">${newsEscapeHtml(item.excerpt || item.content || 'Open this update to read the full story.')}</div>
        <div class="news-archive-footer">
          <span>${item.has_full_content ? 'Full story available' : 'Quick update'}</span>
          <span>Read more →</span>
        </div>
      </div>
    </a>
  `).join('');
}

async function loadNewsPage() {
  const selectedId = readNewsQueryId();
  try {
    const items = await API.get('/news');
    if (!selectedId) {
      const featured = Array.isArray(items) && items.length ? items[0] : null;
      renderNewsDetail(featured);
      renderNewsArchive(Array.isArray(items) ? items : [], null);
      return;
    }

    const [detail, archive] = await Promise.all([
      API.get(`/news/${selectedId}`),
      API.get('/news'),
    ]);
    renderNewsDetail(detail);
    renderNewsArchive(Array.isArray(archive) ? archive : [], selectedId);
  } catch (error) {
    renderNewsDetail(null);
    renderNewsArchive([], selectedId);
  }
}

document.addEventListener('DOMContentLoaded', loadNewsPage);
