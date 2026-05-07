/**
 * EPSA Telegram Mini App Authentication
 * =====================================
 * This module handles ALL Telegram-specific auth logic.
 *
 * CRITICAL: Every function in this file checks isTelegramWebApp() first.
 * If the user is visiting via a normal browser, NOTHING here runs.
 * The existing login/dashboard behavior is completely unaffected.
 *
 * Functions exposed globally:
 *   - EPSA_TG.isTelegramWebApp()
 *   - EPSA_TG.tryAutoLogin()
 *   - EPSA_TG.showLinkingModal()
 *   - EPSA_TG.sendOtp(initData)
 *   - EPSA_TG.verifyOtp(initData, code)
 *   - EPSA_TG.unlinkTelegram()
 *   - EPSA_TG.initLoginPage()
 *   - EPSA_TG.initDashboardPage()
 */

(function (global) {
  'use strict';

  let activeLinkingPromise = null;
  let resolveActiveLinkingPromise = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getApiBase() {
    // Use the same API base already discovered by api.js
    return (typeof API !== 'undefined' && API._apiBase)
      ? API._apiBase.replace(/\/$/, '')
      : (window.location.origin + '/api');
  }

  function getToken() {
    return typeof API !== 'undefined' ? API.getToken() : localStorage.getItem('epsa_token');
  }

  function storeToken(token) {
    if (typeof API !== 'undefined') API.setToken(token);
    else localStorage.setItem('epsa_token', token);
  }

  function storeUser(user) {
    if (typeof API !== 'undefined') API.setUser(user);
    else localStorage.setItem('epsa_user', JSON.stringify(user));
  }

  function updateStoredUser(patch) {
    if (!patch || typeof patch !== 'object') return;
    const currentUser = (typeof API !== 'undefined' && typeof API.getUser === 'function')
      ? (API.getUser() || {})
      : JSON.parse(localStorage.getItem('epsa_user') || '{}');
    storeUser({ ...currentUser, ...patch });
  }

  function redirectForUser(user) {
    const role = user?.role;
    if (role === 'admin' || role === 'super_admin') {
      window.location.href = 'admin/dashboard.html';
      return;
    }
    if (role === 'teacher') {
      window.location.href = 'teacher.html';
      return;
    }
    window.location.href = 'dashboard.html';
  }

  async function apiPost(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(getApiBase() + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: json };
  }

  function showToastMsg(msg, type) {
    // Use the existing showToast function if available
    if (typeof showToast === 'function') {
      showToast(msg, type || 'info');
    } else {
      console[type === 'error' ? 'error' : 'log']('[EPSA TG]', msg);
    }
  }

  function formatOtpStatus(data) {
    const safeOtp = String(data?.otp || '').replace(/[^\d]/g, '').slice(0, 6);
    const expiresIn = Number(data?.expires_in_seconds || 300);
    const warning = data?.warning || data?.telegram_message || '';
    if (!safeOtp) return '';
    return `
      <div style="display:grid;gap:10px;text-align:left;">
        <div style="padding:12px 14px;border-radius:16px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18);color:#166534;">
          <strong>Your verification code is ready.</strong><br>
          Use this fallback code now if Telegram did not deliver the DM.
        </div>
        <div style="padding:16px;border-radius:18px;background:#0f172a;color:white;text-align:center;border:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.65);margin-bottom:8px;">One-time code</div>
          <div style="font-size:1.9rem;font-weight:800;letter-spacing:0.34em;text-indent:0.34em;">${safeOtp}</div>
          <div style="font-size:0.76rem;color:rgba(255,255,255,0.68);margin-top:10px;">Expires in ${expiresIn}s</div>
        </div>
        ${warning ? `<div style="padding:12px 14px;border-radius:16px;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.18);color:#92400e;">${warning}</div>` : ''}
      </div>
    `;
  }

  // ── Core Detection ─────────────────────────────────────────────────────────

  /**
   * Returns true ONLY when inside Telegram Mini App.
   * Normal browser visits always return false.
   */
  function isTelegramWebApp() {
    return !!(
      window.Telegram &&
      window.Telegram.WebApp &&
      window.Telegram.WebApp.initData &&
      window.Telegram.WebApp.initData.length > 0
    );
  }

  function getInitData() {
    if (!isTelegramWebApp()) return null;
    return window.Telegram.WebApp.initData;
  }

  function getTelegramUser() {
    if (!isTelegramWebApp()) return null;
    return window.Telegram.WebApp.initDataUnsafe?.user || null;
  }

  // ── Auto-Login (Returning Users) ───────────────────────────────────────────

  /**
   * Attempt silent Telegram auto-login.
   * Returns true if logged in, false if not linked or error.
   */
  async function tryAutoLogin() {
    if (!isTelegramWebApp()) return false;

    const initData = getInitData();
    if (!initData) return false;

    try {
      const { ok, status, data } = await apiPost('/auth/telegram-login', { init_data: initData });

      if (ok && data.user) {
        // Store JWT + user info using the same keys as the rest of the app
        if (data.token) storeToken(data.token);
        storeUser(data.user);
        return true;
      }

      if (status === 404 && data.code === 'not_linked') {
        return false;
      }

      console.warn('[EPSA TG] Auto-login failed:', data.error || status);
      return false;
    } catch (err) {
      console.error('[EPSA TG] Auto-login error:', err);
      return false;
    }
  }

  // ── OTP Linking Flow ───────────────────────────────────────────────────────

  async function sendOtp() {
    const initData = getInitData();
    if (!initData) {
      showToastMsg('Telegram session not found. Please reopen from Telegram.', 'error');
      return { ok: false };
    }

    const token = getToken();
    if (!token) {
      showToastMsg('Please log in with your email/password first.', 'error');
      return { ok: false };
    }

    return apiPost('/auth/telegram-send-otp', { init_data: initData }, token);
  }

  async function verifyOtp(code) {
    const initData = getInitData();
    if (!initData || !code) return { ok: false };

    const token = getToken();
    if (!token) return { ok: false };

    return apiPost('/auth/telegram-verify-otp', { init_data: initData, otp: code }, token);
  }

  async function unlinkTelegram() {
    const token = getToken();
    if (!token) return { ok: false };
    return apiPost('/auth/unlink-telegram', {}, token);
  }

  // ── Login Page ─────────────────────────────────────────────────────────────

  /**
   * Called on login.html load.
   * Injects the Telegram button and OTP modal ONLY inside Telegram.
   * Does nothing for normal browser visits.
   */
  async function initLoginPage() {
    if (!isTelegramWebApp()) return;

    // Expand the Mini App to full screen
    window.Telegram.WebApp.expand();

    const tgUser = getTelegramUser();
    const firstName = tgUser?.first_name || 'there';

    // Show immediate loading splash before attempting auto-login
    showTelegramLoadingSplash();

    // 1. Try silent auto-login first
    const loggedIn = await tryAutoLogin();
    if (loggedIn) {
      // Already linked — redirect to dashboard immediately
      removeTelegramLoadingSplash();
      showToastMsg(`Welcome back, ${firstName}!`, 'success');
      // Redirect immediately without extra delay
      window.location.href = 'dashboard.html';
      return;
    }

    // 2. Not linked — remove splash and inject Telegram banner + linking instructions
    removeTelegramLoadingSplash();
    _injectTelegramLoginUI(firstName);
  }

  function showTelegramLoadingSplash() {
    // Create full-screen loading overlay
    const splash = document.createElement('div');
    splash.id = 'tg-loading-splash';
    splash.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 24px; color: white;
    `;
    splash.innerHTML = `
      <div style="position: relative; width: 64px; height: 64px;">
        <div style="
          position: absolute; inset: 0;
          border: 3px solid rgba(255,255,255,0.1);
          border-radius: 50%;
          border-top-color: #22c55e;
          border-right-color: #3b82f6;
          animation: spin 0.8s linear infinite;
        "></div>
        <div style="
          position: absolute; inset: 8px;
          border: 2px solid transparent;
          border-radius: 50%;
          border-top-color: rgba(34,197,94,0.6);
          animation: spin 1.2s linear infinite reverse;
        "></div>
      </div>
      <div style="text-align: center;">
        <div style="
          font-size: 1.25rem; font-weight: 700;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
        ">Opening EPSA Portal</div>
        <div style="
          font-size: 0.9rem;
          color: rgba(255,255,255,0.7);
        ">Just a moment…</div>
      </div>
      <style>
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    document.body.appendChild(splash);
  }

  function removeTelegramLoadingSplash() {
    const splash = document.getElementById('tg-loading-splash');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 0.3s ease';
      setTimeout(() => splash.remove(), 300);
    }
  }

  function _injectTelegramLoginUI(firstName) {
    // Add a Telegram-specific banner above the login form
    const formHeader = document.querySelector('.auth-form-header');
    if (!formHeader) return;

    const banner = document.createElement('div');
    banner.id = 'tg-link-banner';
    banner.style.cssText = `
      background: linear-gradient(135deg, #229ED9 0%, #1a8abf 100%);
      color: white; border-radius: 12px; padding: 14px 16px;
      margin-bottom: 16px; font-size: 0.875rem; display: flex;
      align-items: flex-start; gap: 10px;
    `;
    banner.innerHTML = `
      <span style="font-size:1.4rem;flex-shrink:0;">✈️</span>
      <div>
        <strong style="display:block;margin-bottom:2px;">Hi ${firstName}, you're in Telegram!</strong>
        <span style="opacity:0.9;">Sign in below once to link your EPSA account. After that, just tap "Login with Telegram" — no password needed.</span>
      </div>
    `;
    formHeader.parentNode.insertBefore(banner, formHeader.nextSibling);

    // Add "Login with Telegram" button under the existing buttons
    _injectTelegramLoginButton();
  }

  function _injectTelegramLoginButton() {
    // Find the face login button to insert after it
    const faceBtn = document.getElementById('openFaceLoginBtn');
    if (!faceBtn) return;

    const divider = document.createElement('div');
    divider.style.cssText = 'text-align:center;color:var(--text-muted,#888);font-size:0.8rem;margin:4px 0;';
    divider.textContent = '— or —';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'telegramLoginBtn';
    btn.style.cssText = `
      width:100%; padding:12px; border-radius:10px; border:none; cursor:pointer;
      background:linear-gradient(135deg,#229ED9,#1a8abf); color:white;
      font-size:0.95rem; font-weight:600; display:flex; align-items:center;
      justify-content:center; gap:8px; margin-top:4px;
      transition:opacity 0.2s, transform 0.15s;
    `;
    btn.innerHTML = `<span style="font-size:1.2rem;">✈️</span> Login with Telegram`;
    btn.onmouseenter = () => { btn.style.opacity = '0.9'; btn.style.transform = 'translateY(-1px)'; };
    btn.onmouseleave = () => { btn.style.opacity = '1'; btn.style.transform = 'translateY(0)'; };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid white;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span> Checking...`;
      const loggedIn = await tryAutoLogin();
      if (loggedIn) {
        showToastMsg('Logged in via Telegram!', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
      } else {
        showToastMsg('No EPSA account linked to this Telegram yet. Please sign in with your credentials first.', 'info');
        if (data?.code === 'bot_not_started') {
          status.innerHTML = `
            <div style="padding:12px 14px;border-radius:14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.18);color:#991b1b;">
              <strong>EPSA could not send the Telegram code yet.</strong><br>
              Open <a href="https://t.me/epsahub_bot?start=epsa_link" target="_blank" style="color:#229ED9;font-weight:700;">@epsahub_bot</a>, press <strong>Start</strong>, then come back here and try again.
            </div>
          `;
        }
        btn.disabled = false;
        btn.innerHTML = `<span style="font-size:1.2rem;">✈️</span> Login with Telegram`;
      }
    });

    faceBtn.parentNode.insertBefore(divider, faceBtn.nextSibling);
    faceBtn.parentNode.insertBefore(btn, divider.nextSibling);
  }

  async function handleManualLogin(loginPayload) {
    if (!isTelegramWebApp()) {
      redirectForUser(loginPayload?.user);
      return;
    }

    const user = loginPayload?.user || {};
    if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'teacher') {
      redirectForUser(user);
      return;
    }

    if (user.telegram_id) {
      redirectForUser(user);
      return;
    }

    await showLinkingModal({ requireLink: true });
  }

  /**
   * Called AFTER a successful normal password login (from auth.js).
   * Shows the OTP linking modal if inside Telegram.
   */
  function showLinkingModal(options = {}) {
    if (!isTelegramWebApp()) return Promise.resolve({ linked: false });
    if (activeLinkingPromise) return activeLinkingPromise;
    const requireLink = options.requireLink !== false;

    // Build and inject the modal
    if (document.getElementById('tg-link-modal')) return Promise.resolve({ linked: false });

    activeLinkingPromise = new Promise((resolve) => {
      resolveActiveLinkingPromise = resolve;
    });

    const tgUser = getTelegramUser();
    const username = tgUser?.username ? `@${tgUser.username}` : (tgUser?.first_name || 'your Telegram account');

    const overlay = document.createElement('div');
    overlay.id = 'tg-link-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:16px;
      animation:fadeIn 0.2s ease;
    `;

    overlay.innerHTML = `
      <div style="
        background:linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,249,255,0.98));border-radius:24px;padding:24px;
        max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.24);
        border:1px solid rgba(34,158,217,0.16);color:#0f172a;
        animation:slideUp 0.25s ease;
      ">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:2.5rem;margin-bottom:8px;">✈️</div>
          <h2 style="font-size:1.2rem;font-weight:700;margin:0 0 6px;color:#0f172a;">
            Link Telegram Account
          </h2>
          <p style="color:#475569;font-size:0.92rem;line-height:1.6;margin:0;">
            Link <strong style="color:#229ED9;">${username}</strong> to your EPSA account for one-tap login next time.
          </p>
        </div>

        <!-- Bot start notice -->
        <div id="tg-bot-notice" style="
          background:linear-gradient(135deg,rgba(34,158,217,0.10),rgba(200,163,64,0.10));border:1px solid rgba(34,158,217,0.22);
          border-radius:16px;padding:14px;margin-bottom:16px;font-size:0.86rem;
          color:#334155;line-height:1.65;
        ">
          ⚠️ <strong>Before you request the code:</strong> Open
          <a href="https://t.me/epsahub_bot" target="_blank" style="color:#229ED9;">@epsahub_bot</a>
          in Telegram and press <strong>Start</strong>. The bot needs permission to DM you.
        </div>

        <!-- OTP step -->
        <div id="tg-otp-step">
          <button id="tg-send-otp-btn" style="
            width:100%;padding:12px;border-radius:10px;border:none;cursor:pointer;
            background:linear-gradient(135deg,#229ED9,#1a8abf);color:white;
            font-size:0.95rem;font-weight:600;margin-bottom:12px;transition:opacity 0.2s;
          ">
            📩 Send Verification Code
          </button>

          <div id="tg-code-input-row" style="display:none;">
            <p style="color:var(--text-muted,#aaa);font-size:0.825rem;margin:0 0 8px;">
              Enter the 6-digit code sent to your Telegram:
            </p>
            <input id="tg-otp-input" type="text" inputmode="numeric" maxlength="6"
              placeholder="123456"
              style="
                width:100%;padding:12px;border-radius:10px;border:1px solid var(--border,#333);
                background:var(--surface-2,#252d3a);color:var(--text-primary,#fff);
                font-size:1.2rem;text-align:center;letter-spacing:6px;margin-bottom:10px;
                box-sizing:border-box;
              ">
            <button id="tg-verify-otp-btn" style="
              width:100%;padding:12px;border-radius:10px;border:none;cursor:pointer;
              background:var(--epsa-green,#1a6b3c);color:white;
              font-size:0.95rem;font-weight:600;transition:opacity 0.2s;
            ">
              ✅ Verify &amp; Link
            </button>
          </div>

          <p id="tg-otp-status" style="font-size:0.85rem;color:#64748b;text-align:center;margin:10px 0 0;min-height:22px;line-height:1.6;"></p>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px;">
          <button id="tg-skip-link-btn" style="
            flex:1;padding:10px;border-radius:10px;border:1px solid var(--border,#333);
            background:transparent;color:#475569;cursor:pointer;font-size:0.875rem;
          ">
            Cancel sign-in
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Wire up events
    document.getElementById('tg-send-otp-btn').addEventListener('click', async () => {
      const btn = document.getElementById('tg-send-otp-btn');
      const status = document.getElementById('tg-otp-status');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      status.textContent = '';

      const { ok, data } = await sendOtp();
      if (ok) {
        status.style.color = '#166534';
        if (data?.otp) {
          status.innerHTML = formatOtpStatus(data);
          document.getElementById('tg-otp-input').value = String(data.otp).replace(/[^\d]/g, '').slice(0, 6);
        } else {
          status.textContent = `Code sent. Expires in ${data.expires_in_seconds || 300}s.`;
        }
        document.getElementById('tg-code-input-row').style.display = 'block';
        btn.textContent = 'Resend Code';
        btn.disabled = false;
      } else {
        const errMsg = data?.error || 'Failed to send OTP.';
        status.style.color = '#ef4444';
        status.textContent = errMsg;
        if (data?.code === 'bot_not_started') {
          status.innerHTML = `
            ❌ ${errMsg}<br>
            <a href="https://t.me/epsahub_bot" target="_blank" style="color:#229ED9;">
              Open @epsahub_bot → press Start → then try again
            </a>
          `;
        }
        btn.disabled = false;
        btn.textContent = 'Send Verification Code';
      }
    });

    document.getElementById('tg-verify-otp-btn').addEventListener('click', async () => {
      const code = (document.getElementById('tg-otp-input').value || '').trim();
      const status = document.getElementById('tg-otp-status');
      const btn = document.getElementById('tg-verify-otp-btn');

      if (!code || code.length !== 6) {
        status.style.color = '#ef4444';
        status.textContent = 'Please enter the 6-digit code.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Verifying...';
      status.textContent = '';

      const { ok, data } = await verifyOtp(code);
      if (ok) {
        status.style.color = '#22c55e';
        status.textContent = '🎉 Telegram linked! Redirecting...';
        updateStoredUser({ telegram_id: data?.telegram_id || String(tgUser?.id || '') });
        setTimeout(() => {
          overlay.remove();
          const resolver = resolveActiveLinkingPromise;
          activeLinkingPromise = null;
          resolveActiveLinkingPromise = null;
          if (resolver) resolver({ linked: true, telegram_id: data?.telegram_id || null });
          redirectForUser((typeof API !== 'undefined' && typeof API.getUser === 'function') ? API.getUser() : null);
        }, 1200);
      } else {
        status.style.color = '#ef4444';
        status.textContent = data?.error || 'Verification failed. Try again.';
        btn.disabled = false;
        btn.textContent = '✅ Verify & Link';
      }
    });

    document.getElementById('tg-skip-link-btn').addEventListener('click', () => {
      overlay.remove();
      const resolver = resolveActiveLinkingPromise;
      activeLinkingPromise = null;
      resolveActiveLinkingPromise = null;
      if (resolver) resolver({ linked: false, cancelled: true });
      if (requireLink) {
        showToastMsg('Telegram linking is required before entering the Mini App portal.', 'info');
        if (typeof API !== 'undefined' && typeof API.clearToken === 'function') {
          API.clearToken();
        }
        setTimeout(() => { window.location.href = 'login.html'; }, 250);
      } else {
        redirectForUser((typeof API !== 'undefined' && typeof API.getUser === 'function') ? API.getUser() : null);
      }
    });
    return activeLinkingPromise;
  }

  // ── Dashboard Page ─────────────────────────────────────────────────────────

  /**
   * Called on dashboard.html load.
   * Injects Telegram status and unlink button ONLY inside Telegram.
   */
  async function initDashboardPage() {
    if (!isTelegramWebApp()) return;

    window.Telegram.WebApp.expand();

    // Try to find the profile section to inject status
    const profileSection = document.querySelector(
      '#profile-section, .profile-card, [data-section="profile"], #studentProfile, ' +
      '.student-profile-card, .profile-header, [id*="profile"]'
    );

    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(getApiBase() + '/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const user = await res.json();

      // Find a good injection point — fall back to bottom of body
      const target = profileSection || document.querySelector('.dashboard-sidebar, .sidebar, main') || document.body;
      _injectTelegramStatus(target, user.telegram_id);
    } catch (err) {
      console.warn('[EPSA TG] Dashboard init error:', err);
    }
  }

  function _injectTelegramStatus(container, telegramId) {
    const existing = document.getElementById('tg-status-widget');
    if (existing) existing.remove();

    const widget = document.createElement('div');
    widget.id = 'tg-status-widget';
    widget.style.cssText = `
      display:flex;align-items:center;gap:10px;padding:12px 14px;
      border-radius:10px;margin-top:12px;font-size:0.875rem;
      border:1px solid var(--border,#333);background:var(--surface-2,#1c2432);
    `;

    if (telegramId) {
      widget.innerHTML = `
        <span style="font-size:1.3rem;">✈️</span>
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--text-primary,#fff);">Telegram Linked</div>
          <div style="color:var(--text-muted,#aaa);font-size:0.8rem;">
            One-tap login is active. ID: ${telegramId}
          </div>
        </div>
        <button id="tg-unlink-btn" style="
          padding:6px 12px;border-radius:8px;border:1px solid #ef4444;
          background:transparent;color:#ef4444;cursor:pointer;font-size:0.8rem;
          font-weight:600;transition:background 0.2s;
        ">Unlink</button>
      `;
      container.appendChild(widget);

      document.getElementById('tg-unlink-btn').addEventListener('click', async () => {
        if (!confirm('Are you sure you want to unlink your Telegram account? You will need to re-link it to use Telegram login again.')) return;
        const { ok, data } = await unlinkTelegram();
        if (ok) {
          showToastMsg('Telegram account unlinked.', 'success');
          widget.innerHTML = `
            <span style="font-size:1.3rem;">✈️</span>
            <div style="color:var(--text-muted,#aaa);">Telegram not linked. Re-login to link again.</div>
          `;
        } else {
          showToastMsg(data?.error || 'Failed to unlink.', 'error');
        }
      });
    } else {
      widget.innerHTML = `
        <span style="font-size:1.3rem;">✈️</span>
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--text-muted,#aaa);">Telegram Not Linked</div>
          <div style="color:var(--text-muted,#aaa);font-size:0.8rem;">
            Log out and sign in again from Telegram to link your account.
          </div>
        </div>
      `;
      container.appendChild(widget);
    }
  }

  // ── Spinner CSS (injected once) ────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
    @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  `;
  document.head.appendChild(style);

  // ── Public API ─────────────────────────────────────────────────────────────
  global.EPSA_TG = {
    isTelegramWebApp,
    tryAutoLogin,
    handleManualLogin,
    showLinkingModal,
    sendOtp,
    verifyOtp,
    unlinkTelegram,
    initLoginPage,
    initDashboardPage,
    getTelegramUser,
    getInitData,
  };

})(window);
