// ════════════════════════════════════════════════
// EPSA API CLIENT — Centralized fetch wrapper
// ════════════════════════════════════════════════

const API_BASE_CANDIDATES = (() => {
  const currentOrigin = window.location?.origin || '';
  const runtimeConfigured = window.__EPSA_CONFIG__?.API_BASE_URL || window.EPSA_CONFIG?.API_BASE_URL || '';
  const persisted = localStorage.getItem('epsa_api_base') || '';
  const candidates = [];
  if (runtimeConfigured) candidates.push(String(runtimeConfigured).replace(/\/$/, ''));
  if (currentOrigin && /^https?:/i.test(currentOrigin) && !/^(file:|null)$/i.test(currentOrigin)) {
    candidates.push(`${currentOrigin.replace(/\/$/, '')}/api`);
  }
  if (persisted) candidates.push(String(persisted).replace(/\/$/, ''));
  if (!candidates.length) {
    candidates.push('/api');
  }
  return [...new Set(candidates.filter(Boolean))];
})();

const API = {
  _apiBase: API_BASE_CANDIDATES[0],
  _requestTimeoutMs: 60000,
  getApiBases() {
    return [this._apiBase, ...API_BASE_CANDIDATES.filter((base) => base !== this._apiBase)];
  },
  getBaseOrigin() {
    return (this._apiBase || API_BASE_CANDIDATES[0] || '').replace(/\/api\/?$/, '');
  },
  toAbsoluteUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith('/')) return `${this.getBaseOrigin()}${path}`;
    return `${this.getBaseOrigin()}/${path}`;
  },
  // ── Auth token management ──
  getToken() { return localStorage.getItem('epsa_token') || localStorage.getItem('epsa_access_token'); },
  setToken(t) {
    if (!t) return;
    localStorage.setItem('epsa_token', t);
    localStorage.setItem('epsa_access_token', t);
  },
  clearToken() {
    localStorage.removeItem('epsa_token');
    localStorage.removeItem('epsa_access_token');
    localStorage.removeItem('epsa_user');
  },

  getUser() {
    try { return JSON.parse(localStorage.getItem('epsa_user') || 'null'); }
    catch { return null; }
  },
  setUser(u) { localStorage.setItem('epsa_user', JSON.stringify(u)); },
  getRegistrationVerificationToken() { return localStorage.getItem('epsa_registration_verification_token') || ''; },
  setRegistrationVerificationToken(token) {
    if (!token) return;
    localStorage.setItem('epsa_registration_verification_token', token);
  },
  clearRegistrationVerificationToken() {
    localStorage.removeItem('epsa_registration_verification_token');
  },

  isLoggedIn() { return !!this.getToken() || !!this.getUser(); },

  isAdmin() {
    const u = this.getUser();
    return u && (u.role === 'admin' || u.role === 'super_admin');
  },

  // ── Core fetch helper ──
  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let isMultipart = false;
    if (options.body && options.body instanceof FormData) {
      delete headers['Content-Type']; // Let browser set multipart/form-data with boundary
      isMultipart = true;
    }

    const requestOptions = {
      ...options,
      credentials: 'include',
      headers,
      body: options.body && !isMultipart
        ? JSON.stringify(options.body)
        : options.body,
    };

    let resp = null;
    for (const base of this.getApiBases()) {
      try {
        const controller = new AbortController();
        // Do not enforce strict timeouts for file uploads to allow for slower connections
        const timeoutMs = isMultipart ? 300000 : this._requestTimeoutMs; 
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        resp = await fetch(`${base}${path}`, { ...requestOptions, signal: controller.signal });
        clearTimeout(timeoutId);
        this._apiBase = base;
        localStorage.setItem('epsa_api_base', base);
        break;
      } catch (err) {
        resp = null;
      }
    }
    if (!resp) {
      throw new Error('EPSA backend is unreachable. Start the backend server on port 5000 and retry.');
    }

    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!resp.ok) {
        throw new Error(`Request failed (${resp.status})`);
      }
      if (ct.includes('text/html')) {
        throw new Error('Unexpected non-JSON response from API. Check frontend-to-backend routing.');
      }
      return resp;
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      data = { error: 'Unknown server error' };
    }

    if (!resp.ok) {
      // Use the 'code' field from our custom JWT error handlers (backend/app.py)
      // to decide whether to force logout. Only real session-ender codes redirect.
      const sessionEndedCodes = new Set(['token_expired', 'token_invalid', 'token_revoked']);
      const isSessionEnded = (resp.status === 401 || resp.status === 422)
                              && sessionEndedCodes.has(data.code);

      // A plain 401 on a login/register endpoint is just wrong credentials — don't redirect.
      const isLoginEndpoint = path.includes('/auth/login') || path.includes('/auth/register');

      if (isSessionEnded && !isLoginEndpoint) {
        const hadToken = !!this.getToken();
        this.clearToken();
        if (hadToken) {
          const cur = window.location.pathname;
          const onAuthPage = cur.includes('login') || cur.includes('register') || cur === '/';
          if (!onAuthPage) {
            window.location.href = 'login.html';
          }
        }
        throw new Error(data.error || data.message || 'Session expired. Please sign in again.');
      }

      // For all other errors (including 401 with code=token_missing on data endpoints),
      // just surface the error message for the UI to handle — no redirect.
      throw new Error(data.error || data.message || 'Request failed');
    }
    return data;
  },

  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  },

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  },



  // ── Auth endpoints ──
  async login(identifier, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: { identifier, password } });
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  },

  async faceLogin(live_capture, angle_samples = []) {
    const data = await this.request('/auth/face-login', {
      method: 'POST',
      body: { live_capture, angle_samples },
    });
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  },

  async adminLogin(username, password, totp) {
    const data = await this.request('/auth/admin-login', { method: 'POST', body: { username, password, totp } });
    this.setToken(data.token);
    this.setUser(data.user);
    return data;
  },

  async sendOTP(email) {
    const init_data = window.Telegram?.WebApp?.initData || '';
    return this.request('/auth/send-otp', { method: 'POST', body: { email, init_data } });
  },

  async verifyOTP(email, code) {
    const data = await this.request('/auth/verify-otp', { method: 'POST', body: { email, code } });
    this.setRegistrationVerificationToken(data.verification_token);
    return data;
  },

  async verifyRegistrationFace(formData) {
    return this.request('/auth/verify-registration-face', { method: 'POST', body: formData });
  },

  async analyzeRegistrationFace(live_capture) {
    return this.request('/auth/analyze-registration-face', { method: 'POST', body: { live_capture } });
  },

  resolveUploadUrl(folder, filename) {
    if (!filename) return '';
    if (/^https?:\/\//i.test(filename)) return filename;
    const safeFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
    const safeName = String(filename || '').replace(/^\/+/, '');
    return this.toAbsoluteUrl(`/uploads/${safeFolder}/${safeName}`);
  },

  // ── Registration ──
  async register(formData) {
    const token = this.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (formData instanceof FormData && !formData.has('otp_verification_token')) {
      const verificationToken = this.getRegistrationVerificationToken();
      if (verificationToken) formData.append('otp_verification_token', verificationToken);
    }
    let resp = null;
    for (const base of this.getApiBases()) {
      try {
        resp = await fetch(`${base}/auth/register`, { method: 'POST', headers, body: formData, credentials: 'include' });
        this._apiBase = base;
        localStorage.setItem('epsa_api_base', base);
        break;
      } catch (err) {
        resp = null;
      }
    }
    if (!resp) throw new Error('EPSA backend is unreachable. Start the backend server on port 5000 and retry.');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Registration failed');
    this.clearRegistrationVerificationToken();
    return data;
  },

  async forgotPassword(email) {
    return this.request('/auth/forgot-password', { method: 'POST', body: { email } });
  },

  async resetPassword(token, password) {
    return this.request('/auth/reset-password', { method: 'POST', body: { token, password } });
  },

  // ── Students ──
  async getProfile()           { return this.request('/students/profile'); },
  async updateProfile(body)    { return this.request('/students/profile', { method: 'PUT', body }); },
  async getStudents(params='') { return this.request(`/students?${params}`); },
  async getStudent(id)         { return this.request(`/students/${id}`); },
  async connectStudent(id)     { return this.request(`/students/${id}/connect`, { method: 'POST' }); },

  // ── Trainings ──
  async getTrainings()         { return this.request('/trainings'); },
  async getTraining(id)        { return this.request(`/trainings/${id}`); },
  async applyTraining(id)      { return this.request(`/trainings/${id}/apply`, { method: 'POST' }); },
  async uploadReceipt(id, fd)  {
    const headers = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let resp = null;
    for (const base of this.getApiBases()) {
      try {
        resp = await fetch(`${base}/trainings/${id}/receipt`, { method: 'POST', headers, body: fd });
        this._apiBase = base;
        break;
      } catch (err) {
        resp = null;
      }
    }
    if (!resp) throw new Error('EPSA backend is unreachable. Start the backend server on port 5000 and retry.');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  async getMyTrainings()       { return this.request('/trainings/mine'); },

  // ── Voting ──
  async getActiveCandidates(phase) { return this.request(`/voting/candidates?phase=${phase}`); },
  async nominateSelf(data)         { return this.request('/voting/nominate', { method: 'POST', body: data }); },
  async castVote(candidateId)      { return this.request('/voting/vote', { method: 'POST', body: { candidate_id: candidateId } }); },
  async getVoteResults()           { return this.request('/voting/results'); },

  // ── Exams ──
  async getExams()             { return this.request('/exams'); },
  async startExam(id, body={}) { return this.request(`/exams/${id}/start`, { method: 'POST', body }); },
  async verifyExamFace(id, live_capture) {
    return this.request(`/exams/${id}/verify-face`, { method: 'POST', body: { live_capture } });
  },
  async updateExamProgress(id, answers, progress_count) {
    return this.request(`/exams/${id}/progress`, { method: 'POST', body: { answers, progress_count } });
  },
  async submitExam(id, answers){ return this.request(`/exams/${id}/submit`, { method: 'POST', body: { answers } }); },
  async getExamResults(id)     { return this.request(`/exams/${id}/results`); },

  // ── Messaging ──
  async getSupportContact()    { return this.request('/messages/support-contact'); },
  async getConversations()     { return this.request('/messages/conversations'); },
  async getMessages(userId)    { return this.request(`/messages/${userId}`); },
  async sendMessage(toId, text){ return this.request('/messages', { method: 'POST', body: { to_id: toId, text } }); },
  async getClubs()                 { return this.request('/clubs'); },
  async getClub(id)                { return this.request(`/clubs/${id}`); },
  async getMyClubs()               { return this.request('/clubs/mine'); },
  async getClubActivities(id)      { return this.request(`/clubs/${id}/activities`); },
  async getClubJoinStatus(id)      { return this.request(`/clubs/${id}/join-status`); },
  async joinClub(id)               { return this.request(`/clubs/${id}/join`, { method: 'POST' }); },
  async followClub(id)             { return this.request(`/clubs/${id}/follow`, { method: 'POST' }); },
  async getClubFollowStatus(id)    { return this.request(`/clubs/${id}/follow`); },
  async getFundingOverview()       { return this.request('/clubs/funding/overview'); },
  async getClubSupportRequests(id) { return this.request(`/clubs/${id}/support-requests`); },
  async submitClubSupportRequest(id, body) { return this.request(`/clubs/${id}/support-request`, { method: 'POST', body }); },
  async getPartners(params='')     { return this.request(`/partners${params ? `?${params}` : ''}`); },
  async getPartner(id)             { return this.request(`/partners/${id}`); },
  async getPartnerCategories()     { return this.request('/partners/categories'); },
  async getFeed(page=1)            { return this.request(`/network/feed?page=${page}`); },
  async getFeedFiltered(filter='all', page=1) { return this.request(`/network/feed?filter=${encodeURIComponent(filter)}&page=${page}`); },
  async getClubFeed(id, page=1)    { return this.request(`/network/club-feed/${id}?page=${page}`); },
  async searchNetwork(q='')        { return this.request(`/network/search?q=${encodeURIComponent(q)}`); },
  async createPost(body)           { return this.request('/network/posts', { method: 'POST', body }); },
  async likePost(id)               { return this.request(`/network/posts/${id}/like`, { method: 'POST' }); },
  async sharePost(id)              { return this.request(`/network/posts/${id}/share`, { method: 'POST' }); },
  async getPostComments(id)        { return this.request(`/network/posts/${id}/comments`); },
  async addPostComment(id, content){ return this.request(`/network/posts/${id}/comments`, { method: 'POST', body: { content } }); },
  async getSuggestions()           { return this.request('/network/suggestions'); },
  async connectUser(id)            { return this.request(`/network/connect/${id}`, { method: 'POST' }); },
  async followUser(id)             { return this.request(`/network/follow/${id}`, { method: 'POST' }); },
  async unfollowUser(id)           { return this.request(`/network/follow/${id}`, { method: 'DELETE' }); },
  async getClubJoinRequests(id)    { return this.request(`/clubs/${id}/join-requests`); },
  async approveClubJoinRequest(clubId, joinId) { return this.request(`/clubs/${clubId}/join-requests/${joinId}/approve`, { method: 'POST' }); },
  async rejectClubJoinRequest(clubId, joinId) { return this.request(`/clubs/${clubId}/join-requests/${joinId}/reject`, { method: 'POST' }); },

  // ── Admin endpoints ──
  async getApplicants(status)  { return this.request(`/admin/applicants?status=${status}`); },
  async getPendingApplicants() { return this.request('/admin/applicants?status=pending'); },
  async approveApplicant(id)   { return this.request(`/admin/applicants/${id}/approve`, { method: 'POST' }); },
  async rejectApplicant(id, r) { return this.request(`/admin/applicants/${id}/reject`, { method: 'POST', body: { reason: r } }); },
  async deleteApplicant(id)    { return this.request(`/admin/applicants/${id}/delete`, { method: 'DELETE' }); },
  async deleteRegisteredStudent(id) { return this.request(`/admin/students/${id}/delete`, { method: 'DELETE' }); },
  async adminStats()           { return this.request('/admin/stats'); },
  async createTraining(body)   { return this.request('/admin/trainings', { method: 'POST', body }); },
  async createTrainingWithUpload(formData) {
    const token = this.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let resp = null;
    for (const base of this.getApiBases()) {
      try {
        resp = await fetch(`${base}/admin/trainings`, { method: 'POST', headers, body: formData });
        this._apiBase = base;
        break;
      } catch (err) {
        resp = null;
      }
    }
    if (!resp) throw new Error('EPSA backend is unreachable.');
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Training create failed');
    return data;
  },
  async updateTraining(id, body) { return this.request(`/admin/trainings/${id}`, { method: 'PUT', body }); },
  async deleteTraining(id)     { return this.request(`/admin/trainings/${id}`, { method: 'DELETE' }); },
  async submitTelegramBroadcast(formData) {
    const token = this.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let resp = null;
    for (const base of this.getApiBases()) {
      try {
        resp = await fetch(`${base}/admin/telegram/broadcast`, {
          method: 'POST',
          headers,
          body: formData,
          credentials: 'include',
        });
        this._apiBase = base;
        localStorage.setItem('epsa_api_base', base);
        break;
      } catch (err) {
        resp = null;
      }
    }
    if (!resp) throw new Error('EPSA backend is unreachable.');
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Telegram broadcast failed');
    return data;
  },
  async verifyReceipt(appId)   { return this.request(`/admin/training-applications/${appId}/verify`, { method: 'POST' }); },
  async createExam(body)       { return this.request('/admin/exams', { method: 'POST', body }); },
  async updateExam(id, body)   { return this.request(`/admin/exams/${id}`, { method: 'PUT', body }); },
  async deleteExam(id)         { return this.request(`/admin/exams/${id}`, { method: 'DELETE' }); },
  async getLeadership()        { return this.request('/leadership/public'); },

  // ── Admin: trainings/exams (full list incl. inactive) ──
  async getAdminTrainings()       { return this.request('/admin/trainings'); },
  async toggleTraining(id)        { return this.request(`/admin/trainings/${id}/toggle`, { method: 'POST' }); },
  async getAdminExams()           { return this.request('/admin/exams'); },
  async publishExam(id, active = null) {
    const body = active === null || active === undefined ? {} : { active: !!active };
    return this.request(`/admin/exams/${id}/publish`, { method: 'POST', body });
  },

  // ── Admin: question builder ──
  async getExamQuestions(eid)     { return this.request(`/admin/exams/${eid}/questions`); },
  async addExamQuestion(eid, body){ return this.request(`/admin/exams/${eid}/questions`, { method: 'POST', body }); },
  async deleteExamQuestion(qid)   { return this.request(`/admin/exam-questions/${qid}`, { method: 'DELETE' }); },

  // ── Admin: submissions & result release ──
  async getExamSubmissions(eid)   { return this.request(`/admin/exams/${eid}/submissions`); },
  async releaseExamResults(eid)   { return this.request(`/admin/exams/${eid}/release-results`, { method: 'POST' }); },
  async getVotingConfig()         { return this.request('/admin/voting/config'); },
  async updateVotingConfig(body)  { return this.request('/admin/voting/config', { method: 'PUT', body }); },
  async startVotingPhase(phase_number) { return this.request('/admin/voting/start_phase', { method: 'POST', body: { phase_number } }); },
  async finalizeVotingPhase(phase_number) { return this.request('/admin/voting/finalize_phase', { method: 'POST', body: { phase_number } }); },
  async getAdminClubs(status='all')      { return this.request(`/admin/clubs?status=${status}`); },
  async getAdminProposals(status='all')  { return this.request(`/admin/proposals?status=${status}`); },
  async getGrantSources(status='all')    { return this.request(`/admin/grant-sources?status=${status}`); },
  async createGrantSource(body)          { return this.request('/admin/grant-sources', { method: 'POST', body }); },
  async updateGrantSource(id, body)      { return this.request(`/admin/grant-sources/${id}`, { method: 'PUT', body }); },
  async deleteGrantSource(id)            { return this.request(`/admin/grant-sources/${id}`, { method: 'DELETE' }); },
  async getAdminPartners()               { return this.request('/admin/partners'); },
  async getAdminClubMembers(id)          { return this.request(`/admin/clubs/${id}/members`); },
  async getAdminClubActivities(id)       { return this.request(`/admin/clubs/${id}/activities`); },
  async getSupportRequests(status='all') { return this.request(`/admin/support-requests?status=${status}`); },
  async respondSupportRequest(id, body)  { return this.request(`/admin/support-requests/${id}/respond`, { method: 'POST', body }); },
  async getBudgetOverview()              { return this.request('/admin/budget/overview'); },
  async getAdminFinancialReports()       { return this.request('/admin/financial-reports'); },
  async verifyFinancialReport(id)        { return this.request(`/admin/financial-reports/${id}/verify`, { method: 'POST' }); },
  async flagFinancialReport(id, reason)  { return this.request(`/admin/financial-reports/${id}/flag`, { method: 'POST', body: { reason } }); },
  async getExecutiveDashboard()          { return this.request('/admin/executive/dashboard'); },
  async formExecutiveCommittee(body={})  { return this.request('/admin/executive/form-committee', { method: 'POST', body }); },
  async assignNEBRole(body)              { return this.request('/admin/voting/assign_neb', { method: 'POST', body }); },
  async assignExecutiveRole(id, body)    { return this.request(`/admin/executive/${id}/assign-role`, { method: 'POST', body }); },
  async reassignExecutiveRole(id, body)  { return this.request(`/admin/executive/${id}/reassign-role`, { method: 'POST', body }); },
  async removeExecutiveMember(id, body)  { return this.request(`/admin/executive/${id}/remove`, { method: 'POST', body }); },
  async updateExecutiveEngagement(id, body) { return this.request(`/admin/executive/${id}/engagement`, { method: 'POST', body }); },
  async getExecutiveHandover(id)         { return this.request(`/admin/executive/${id}/handover`); },
  async updateExecutiveHandover(id, body){ return this.request(`/admin/executive/${id}/handover`, { method: 'POST', body }); },
  async recordVacancyInterest(id, body)  { return this.request(`/admin/executive/vacancies/${id}/interest`, { method: 'POST', body }); },
  async resolveVacancyInternal(id, body) { return this.request(`/admin/executive/vacancies/${id}/resolve-internal`, { method: 'POST', body }); },
  async startVacancyElection(id, body)   { return this.request(`/admin/executive/vacancies/${id}/start-election`, { method: 'POST', body }); },
  async completeVacancyElection(id, body){ return this.request(`/admin/executive/vacancies/${id}/complete-election`, { method: 'POST', body }); },
  async getNRCDashboard()                { return this.request('/admin/nrc/dashboard'); },
  async syncNRCMembers(body={})          { return this.request('/admin/nrc/sync', { method: 'POST', body }); },
  async updateNRCStatus(id, body)        { return this.request(`/admin/nrc/${id}/status`, { method: 'POST', body }); },
  async verifyNRCGraduation(id, body)    { return this.request(`/admin/nrc/${id}/graduation`, { method: 'POST', body }); },
  async replaceNRCMember(id, body)       { return this.request(`/admin/nrc/${id}/replace`, { method: 'POST', body }); },
  async getNRCPortal()                   { return this.request('/students/nrc/portal'); },
  async uploadNRCDocument(fd)            { return this.request('/students/nrc/documents', { method: 'POST', body: fd }); },

  // ── Teacher Portal ──
  async getTeacherCategories()          { return this.request('/teacher/categories'); },
  async getTeacherStats()               { return this.request('/teacher/stats'); },
  async getMyQuestions(params={})       { return this.request('/teacher/questions?' + new URLSearchParams(params)); },
  async submitQuestion(body)            { return this.request('/teacher/questions', { method: 'POST', body }); },
  async updateQuestion(id, body)        { return this.request(`/teacher/questions/${id}`, { method: 'PUT', body }); },
  async bulkSubmitQuestions(questions)  { return this.request('/teacher/questions/bulk', { method: 'POST', body: { questions } }); },
  async uploadQuestionDocument(fd)      { return this.request('/teacher/questions/bulk-document', { method: 'POST', body: fd }); },
  async teacherRegister(body)           { return this.request('/teacher/register', { method: 'POST', body }); },

  // ── Admin: Teacher & Question Bank ──
  async adminListTeachers(status='all')         { return this.request(`/teacher/admin/teachers?status=${status}`); },
  async adminApproveTeacher(id)                 { return this.request(`/teacher/admin/teachers/${id}/approve`, { method: 'POST' }); },
  async adminRejectTeacher(id, reason)          { return this.request(`/teacher/admin/teachers/${id}/reject`, { method: 'POST', body: { reason } }); },
  async adminListQuestions(params={})           { return this.request('/teacher/admin/questions?' + new URLSearchParams(params)); },
  async adminGetQuestionBlueprintSummary()      { return this.request('/teacher/admin/question-blueprint-summary'); },
  async adminApproveQuestion(id)                { return this.request(`/teacher/admin/questions/${id}/approve`, { method: 'POST' }); },
  async adminBulkApproveQuestions()             { return this.request('/teacher/admin/questions/bulk-approve', { method: 'POST' }); },
  async adminRejectQuestion(id, notes)          { return this.request(`/teacher/admin/questions/${id}/reject`, { method: 'POST', body: { notes } }); },
  async adminUpdateQuestion(id, body)           { return this.request(`/teacher/admin/questions/${id}`, { method: 'PUT', body }); },

  // ── Mock Exams (Student) ──
  async listMockExams()                         { return this.request('/mock-exams'); },
  async startMockExam(id)                       { return this.request(`/mock-exams/${id}/start`, { method: 'POST' }); },
  async saveMockProgress(id, body)              { return this.request(`/mock-exams/${id}/progress`, { method: 'POST', body }); },
  async submitMockExam(id, body)                { return this.request(`/mock-exams/${id}/submit`, { method: 'POST', body }); },
  async getMockResults(id)                      { return this.request(`/mock-exams/${id}/results`); },
  async getMockInsights(id)                     { return this.request(`/mock-exams/${id}/insights`); },

  // ── Mock Exams (Admin) ──
  async adminListMockExams()                    { return this.request('/mock-exams/admin'); },
  async adminCreateMockExam(body)               { return this.request('/mock-exams/admin', { method: 'POST', body }); },
  async adminUpdateMockExam(id, body)           { return this.request(`/mock-exams/admin/${id}`, { method: 'PUT', body }); },
  async adminActivateMockExam(id)               { return this.request(`/mock-exams/admin/${id}/activate`, { method: 'POST' }); },
  async adminReleaseExamResults(id)             { return this.request(`/mock-exams/admin/${id}/release-results`, { method: 'POST' }); },
  async adminDeleteMockExam(id)                 { return this.request(`/mock-exams/admin/${id}`, { method: 'DELETE' }); },
  async adminStopMockExam(id)                   { return this.request(`/mock-exams/admin/${id}/stop`, { method: 'POST' }); },
  async adminGetLiveMockAnalytics()             { return this.request('/mock-exams/admin/live-analytics'); },
  async adminReleaseMockExamResults(id)         { return this.adminReleaseExamResults(id); }, // alias
  async adminGetExamReport(id)                  { return this.request(`/mock-exams/admin/${id}/report`); },
  async adminDeleteQuestion(id)                { return this.request(`/mock-exams/admin/questions/${id}`, { method: 'DELETE' }); },

  // ── Logout ──
  logout() {
    try {
      // Clear any active timers and intervals
      if (window._previewCountdownInterval) {
        clearInterval(window._previewCountdownInterval);
        window._previewCountdownInterval = null;
      }
      if (window._tabWarningTimer) {
        clearInterval(window._tabWarningTimer);
        window._tabWarningTimer = null;
      }
      const es = typeof window.getExamState === 'function' ? window.getExamState() : null;
      if (es) {
        if (es.timerInterval) clearInterval(es.timerInterval);
        if (es.heartbeatInterval) clearInterval(es.heartbeatInterval);
      }
      
      this.clearToken();
      const home = new URL('index.html', window.location.href).href;
      setTimeout(() => {
        window.location.href = home;
      }, 50);
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = new URL('index.html', window.location.href).href;
    }
  },
};

// ── ANALYTIC ENGINE API EXTENSIONS ───────────────────────────────────────────
Object.assign(API, {
  /** Save exam progress including focus-time and answer-change data */
  async saveMockProgress(examId, payload) {
    return API.post(`/mock-exams/${examId}/progress`, payload);
  },

  /** Submit mock exam with focus-time and answer-change data */
  async submitMockExam(examId, payload) {
    return API.post(`/mock-exams/${examId}/submit`, payload);
  },

  // Analytics endpoints (admin)
  async getGlobalQuestionStats() {
    return API.get('/analytics/global-question-stats');
  },

  async getUniversityBenchmarking(examId = null) {
    const qs = examId ? `?exam_id=${examId}` : '';
    return API.get(`/analytics/university-benchmarking${qs}`);
  },

  async getExamDrilldown(examId) {
    return API.get(`/analytics/exam-drilldown/${examId}`);
  },

  async getFatigueAlert(examId) {
    return API.get(`/analytics/fatigue-alert/${examId}`);
  },

  // Teacher analytics endpoint
  async getTeacherQuestionPerformance() {
    return API.get('/analytics/teacher-question-performance');
  },
});

window.API = API;

// ── Global toast (shared between pages) ──
function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', gold: '⭐', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
window.showToast = showToast;
