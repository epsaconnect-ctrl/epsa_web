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

function resolveNewsMediaImage(media) {
  const direct = media?.image_api_url || media?.image_url || '';
  if (direct) {
    if (typeof API.resolveUploadUrl === 'function' && !/^https?:\/\//i.test(direct) && !String(direct).startsWith('/uploads/') && !String(direct).startsWith('/storage/')) {
      return API.resolveUploadUrl('news', direct);
    }
    return newsImageUrl(direct);
  }
  const rawPath = String(media?.image_path || '').trim();
  if (!rawPath) return '';
  if (typeof API.resolveUploadUrl === 'function') {
    return API.resolveUploadUrl('news', rawPath);
  }
  return newsImageUrl(rawPath);
}

function newsMediaFallbacks(item, media) {
  const urls = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text && !urls.includes(text)) urls.push(text);
  };
  if (media?.image_api_url) push(newsImageUrl(media.image_api_url));
  if (media?.image_url) {
    push(newsImageUrl(media.image_url));
    if (typeof API.resolveUploadUrl === 'function') push(API.resolveUploadUrl('news', media.image_url));
  }
  if (media?.image_path && typeof API.resolveUploadUrl === 'function') push(API.resolveUploadUrl('news', media.image_path));
  if (media?.news_id) push(newsImageUrl(`/api/news/${media.news_id}/image`));
  if (item?.id) push(newsImageUrl(`/api/news/${item.id}/image`));
  return urls;
}

function renderNewsImg(item, media, altText) {
  const fallbacks = newsMediaFallbacks(item, media);
  const primary = fallbacks.shift() || '';
  return `<img class="js-news-fallback-image" src="${newsEscapeHtml(primary)}" data-fallbacks="${newsEscapeHtml(fallbacks.join('|'))}" alt="${newsEscapeHtml(altText)}">`;
}

function wireNewsImageFallbacks(root = document) {
  root.querySelectorAll('.js-news-fallback-image').forEach((img) => {
    if (img.dataset.fallbackBound === '1') return;
    img.dataset.fallbackBound = '1';
    img.addEventListener('error', () => {
      const list = String(img.dataset.fallbacks || '').split('|').filter(Boolean);
      const next = list.shift();
      if (next) {
        img.dataset.fallbacks = list.join('|');
        img.src = next;
      } else {
        img.style.display = 'none';
      }
    });
  });
}

function readNewsGallery(item, maxItems = null) {
  const gallery = Array.isArray(item?.gallery) ? item.gallery : [];
  return maxItems ? gallery.slice(0, maxItems) : gallery;
}

function renderNewsGallery(item, variant = 'detail') {
  const gallery = readNewsGallery(item, variant === 'archive' ? 3 : null);
  if (!gallery.length) {
    return (item.image_api_url || item.image_url)
      ? `<img src="${resolveNewsItemImage(item)}" alt="${newsEscapeHtml(item.title)}">`
      : '';
  }
  if (gallery.length === 1) {
    const media = gallery[0];
    return `
      <div class="news-gallery-single ${variant === 'archive' ? 'news-gallery-single-compact' : ''}">
        ${renderNewsImg(item, media, media.caption || item.title || 'EPSA update image')}
        ${(media.caption || '').trim() && variant === 'detail' ? `<figcaption>${newsEscapeHtml(media.caption)}</figcaption>` : ''}
      </div>
    `;
  }
  const className = variant === 'archive' ? 'news-gallery-mosaic news-gallery-mosaic-compact' : 'news-gallery-mosaic';
  return `
    <div class="${className}">
      ${gallery.map((media, index) => `
        <figure class="news-gallery-cell news-gallery-cell-${index + 1}">
          ${renderNewsImg(item, media, media.caption || item.title || 'EPSA update image')}
          ${(media.caption || '').trim() && variant === 'detail' ? `<figcaption>${newsEscapeHtml(media.caption)}</figcaption>` : ''}
        </figure>
      `).join('')}
      ${variant === 'archive' && item.gallery_count > gallery.length ? `<div class="news-gallery-overflow">+${item.gallery_count - gallery.length}</div>` : ''}
    </div>
  `;
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
    ${(readNewsGallery(item).length || item.image_api_url || item.image_url) ? `<div class="news-detail-media">${renderNewsGallery(item, 'detail')}</div>` : ''}
    <div class="news-detail-body">
      <div class="news-detail-meta">
        <span class="news-category">${newsEscapeHtml(item.category || 'Update')}</span>
        <span class="news-detail-date">${formatNewsDate(item.created_at)}</span>
        ${item.gallery_count ? `<span class="news-detail-date">${item.gallery_count} photo${item.gallery_count === 1 ? '' : 's'}</span>` : ''}
      </div>
      <h2 class="news-detail-title">${newsEscapeHtml(item.title)}</h2>
      ${item.excerpt ? `<p class="news-detail-excerpt">${newsEscapeHtml(item.excerpt)}</p>` : ''}
      <div class="news-detail-content">${newsEscapeHtml(item.content || item.excerpt || 'Full details will be added soon.')}</div>
    </div>
  `;
  wireNewsImageFallbacks(panel);
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
        ${renderNewsGallery(item, 'archive')}
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
  wireNewsImageFallbacks(grid);
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
