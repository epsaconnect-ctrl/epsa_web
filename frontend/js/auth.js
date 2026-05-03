let currentStep = 1;
const TOTAL_STEPS = 5;
let otpTimer = null;
const FACE_HOLD_DURATION_MS = 1000;
let activeFaceMode = 'registration';
let faceLoginRedirectTimer = null;
let faceLoginCountdownTimer = null;

const FACE_SCAN_TASKS = [
  {
    key: 'centered',
    title: 'Face alignment',
    description: 'Keep your face inside the frame so EPSA can compare it with the uploaded profile photo.',
    prompt: 'Center your face inside the guide and hold still for a moment.',
    purpose: 'Used to capture one clean live face frame for comparison.',
  },
];

let faceVerification = {};

function createFaceVerificationState() {
  return {
    verified: false,
    score: null,
    threshold: null,
    capture: '',
    stream: null,
    detector: null,
    detectorReady: false,
    smartScanActive: false,
    analysisTimer: null,
    processing: false,
    tasks: Object.fromEntries(FACE_SCAN_TASKS.map((task) => [task.key, false])),
    challengeIndex: 0,
    holdTaskKey: '',
    holdStartedAt: 0,
    holdProgress: 0,
    scanStartedAt: 0,
    profilePhotoFaceReady: false,
    profilePhotoAnalyzing: false,
    profilePhotoDataUrl: '',
    busyAction: '',
    baseline: {
      brightness: null,
      areaRatio: null,
      faceCenterX: null,
      smileScore: null,
      yawBalance: null,
    },
    metrics: {
      brightness: 0,
      faceBrightness: 0,
      alignment: 0,
      smileDelta: 0,
      movement: 0,
      turnOffset: 0,
      yawDegrees: 0,
      areaRatio: 0,
      hasFace: false,
      faceCount: 0,
    },
    latestAnalysis: null,
    bestCapture: '',
    bestCaptureQuality: 0,
    lockMissCount: 0,
    angleSamples: [],
    sampleLabels: {},
    previousFaceSignature: null,
    previousMouthSignature: null,
    loginStableFrames: 0,
    loginVisibleFrames: 0,
    loginLastAttemptAt: 0,
  };
}

function resetFaceState() {
  faceVerification = createFaceVerificationState();
}

resetFaceState();

function byId(id) {
  return document.getElementById(id);
}

function isFaceLoginMode() {
  return activeFaceMode === 'login';
}

function faceReferenceLabel() {
  return isFaceLoginMode() ? 'registered EPSA face map' : 'uploaded profile photo';
}

function val(id) {
  return (byId(id)?.value || '').trim();
}

function setError(inputId, errorId, isValid) {
  const input = byId(inputId);
  const error = byId(errorId);
  input?.classList.toggle('error', !isValid);
  if (error) error.style.display = isValid ? 'none' : 'flex';
  return isValid;
}

function normalizePhonePreview(phone) {
  return String(phone || '').replace(/\s+/g, '');
}

function passwordStrong(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

async function handleLogin(event) {
  event.preventDefault();
  const identifier = val('login-username');
  const password = byId('login-password')?.value || '';

  let valid = true;
  valid = setError('login-username', 'username-error', !!identifier) && valid;
  valid = setError('login-password', 'password-error', !!password) && valid;
  if (!valid) return;

  const btn = byId('loginBtn');
  const btnText = byId('loginBtnText');
  const spinner = byId('loginSpinner');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Signing in...';
  if (spinner) spinner.style.display = 'block';

  try {
    const data = await API.login(identifier, password);
    const role = data.user.role;
    if (data.user.status === 'pending') {
      showToast('Your application is still under review.', 'gold');
      setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    } else if (typeof EPSA_TG !== 'undefined' && EPSA_TG.isTelegramWebApp()) {
      await EPSA_TG.handleManualLogin(data);
    } else if (role === 'admin' || role === 'super_admin') {
      window.location.href = 'admin/dashboard.html';
    } else if (role === 'teacher') {
      window.location.href = 'teacher.html';
    } else {
      window.location.href = 'dashboard.html';
    }
  } catch (err) {
    showToast(err.message || 'Login failed. Check your credentials.', 'error');
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Sign In to EPSA';
    if (spinner) spinner.style.display = 'none';
  }
}
window.handleLogin = handleLogin;

async function changeStep(direction) {
  if (direction === -1) {
    if (currentStep <= 1) return;
    currentStep -= 1;
    renderStep(currentStep);
    return;
  }

  if (!validateStep(currentStep)) return;

  if (currentStep === 3) {
    currentStep = 4;
    renderStep(currentStep);
    await prepareFaceVerificationStep();
    return;
  }

  if (currentStep === 4) {
    currentStep = 5;
    renderStep(currentStep);
    populateReview();
    await sendOTP();
    return;
  }

  if (currentStep === TOTAL_STEPS) {
    const otpValue = [...document.querySelectorAll('.otp-input')].map((input) => input.value).join('');
    try {
      await API.verifyOTP(val('emailAddress'), otpValue);
      await submitRegistration();
    } catch (err) {
      if (byId('otp-err')) byId('otp-err').style.display = 'flex';
      showToast(err.message || 'Incorrect verification code.', 'error');
    }
    return;
  }

  currentStep += 1;
  renderStep(currentStep);
}
window.changeStep = changeStep;

function renderStep(step) {
  document.querySelectorAll('.reg-step-body').forEach((body) => body.classList.remove('active'));
  byId(`step${step}`)?.classList.add('active');

  document.querySelectorAll('.reg-step').forEach((item, index) => {
    item.classList.remove('active', 'completed');
    if (index + 1 < step) item.classList.add('completed');
    if (index + 1 === step) item.classList.add('active');
    const num = item.querySelector('.reg-step-num');
    if (num) num.textContent = index + 1 < step ? 'OK' : String(index + 1);
  });

  const prevBtn = byId('prevBtn');
  const nextBtn = byId('nextBtn');
  const progress = byId('regProgressText');
  if (prevBtn) prevBtn.style.display = step > 1 ? 'inline-flex' : 'none';
  if (progress) progress.textContent = `Step ${step} of ${TOTAL_STEPS}`;
  if (nextBtn) {
    nextBtn.textContent = step === TOTAL_STEPS ? 'Submit Application' : 'Next Step ->';
    nextBtn.className = step === TOTAL_STEPS ? 'btn btn-gold' : 'btn btn-primary';
  }

  if (step === 4) {
    updateReferencePreview();
    renderFaceChallenges();
    updateFaceMetricDisplay();
    renderAngleGallery();
    updateFaceHoldDisplay();
    updateFaceStatus(
      faceVerification.verified
        ? `Live face check already passed. Latest match score: <strong>${faceVerification.score}</strong>.`
        : 'Live face check is optional. If you want to use it, look into the camera and tap verify.',
      faceVerification.verified ? 'success' : 'info'
    );
    updateFaceActionButtons();
    updateFacePrompt();
    startFaceCamera();
  } else {
    stopFaceCamera();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(step) {
  let valid = true;

  if (step === 1) {
    valid = setError('firstName', 'firstName-err', val('firstName').length > 1) && valid;
    valid = setError('fatherName', 'fatherName-err', val('fatherName').length > 1) && valid;
    valid = setError('grandfatherName', 'grandfatherName-err', val('grandfatherName').length > 1) && valid;
    valid = setError('phoneNumber', 'phone-err', /^(?:\+251|251|0)?9\d{8}$/.test(normalizePhonePreview(val('phoneNumber')))) && valid;
    valid = setError('emailAddress', 'email-err', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('emailAddress'))) && valid;

    const password = byId('password1')?.value || '';
    const confirm = byId('password2')?.value || '';
    if (!passwordStrong(password)) {
      byId('password1')?.classList.add('error');
      showToast('Password must include uppercase, lowercase, number, and special character.', 'error');
      valid = false;
    } else {
      byId('password1')?.classList.remove('error');
    }
    if (!setError('password2', 'password2-err', password === confirm && !!confirm)) {
      valid = false;
    }
  }

  if (step === 2) {
    valid = setError('university', 'university-err', !!val('university')) && valid;
    valid = setError('programType', 'program-err', !!val('programType')) && valid;
    valid = setError('academicYear', 'year-err', !!val('academicYear')) && valid;
    if (val('university') === 'other') {
      const other = !!val('otherUniversity');
      byId('otherUniversity')?.classList.toggle('error', !other);
      valid = other && valid;
    }
  }

  if (step === 3) {
    const photoValid = !!byId('profilePhotoInput')?.files?.length;
    const slipValid = !!byId('regSlipInput')?.files?.length;
    if (byId('photo-err')) byId('photo-err').style.display = photoValid ? 'none' : 'flex';
    if (byId('slip-err')) byId('slip-err').style.display = slipValid ? 'none' : 'flex';
    valid = photoValid && slipValid && valid;
  }

  if (step === 4) {
    if (byId('face-err')) byId('face-err').style.display = 'none';
  }

  if (step === 5) {
    const otpValue = [...document.querySelectorAll('.otp-input')].map((input) => input.value).join('');
    if (otpValue.length < 6) {
      if (byId('otp-err')) byId('otp-err').style.display = 'flex';
      showToast('Enter the 6-digit verification code.', 'error');
      valid = false;
    }
    if (!byId('agreeTerms')?.checked) {
      showToast('Please agree to the membership terms before submitting.', 'error');
      valid = false;
    }
  }

  if (!valid) showToast('Please complete the required fields before continuing.', 'error');
  return valid;
}

function updateFaceStatus(message, type = 'neutral') {
  const box = byId('faceVerificationStatus');
  if (!box) return;
  const loginStatusCopy = byId('faceLoginStatusCopy');
  const palettes = {
    neutral: { background: 'white', border: '1px solid var(--light-200)', color: 'var(--text-secondary)' },
    success: { background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534' },
    error: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#991b1b' },
    info: { background: 'rgba(26,107,60,0.08)', border: '1px solid rgba(26,107,60,0.22)', color: 'var(--epsa-green)' },
    gold: { background: 'rgba(200,163,64,0.1)', border: '1px solid rgba(200,163,64,0.3)', color: '#8a6500' },
  };
  const palette = palettes[type] || palettes.neutral;
  box.style.background = palette.background;
  box.style.border = palette.border;
  box.style.color = palette.color;
  if (isFaceLoginMode() && loginStatusCopy) {
    loginStatusCopy.innerHTML = message;
  } else {
    box.innerHTML = message;
  }
}

function updateProfilePhotoStatus(message, tone = 'neutral') {
  const status = byId('profilePhotoFaceStatus');
  if (!status) return;
  status.textContent = message;
  const palettes = {
    neutral: { background: 'rgba(15,23,42,0.04)', border: 'rgba(15,23,42,0.08)', color: 'var(--text-secondary)' },
    info: { background: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.14)', color: '#1d4ed8' },
    success: { background: 'rgba(26,107,60,0.08)', border: 'rgba(26,107,60,0.14)', color: '#166534' },
    warning: { background: 'rgba(200,163,64,0.1)', border: 'rgba(200,163,64,0.24)', color: '#8a6500' },
    error: { background: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.16)', color: '#b91c1c' },
  };
  const palette = palettes[tone] || palettes.neutral;
  status.style.background = palette.background;
  status.style.borderColor = palette.border;
  status.style.color = palette.color;
}

function updateReferenceMeta(message, tone = 'neutral') {
  const meta = byId('faceReferenceMeta');
  if (!meta) return;
  meta.textContent = message;
  const palettes = {
    neutral: { background: 'rgba(15,23,42,0.06)', border: 'rgba(15,23,42,0.08)', color: 'var(--text-secondary)' },
    info: { background: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.14)', color: '#1d4ed8' },
    success: { background: 'rgba(26,107,60,0.08)', border: 'rgba(26,107,60,0.14)', color: '#166534' },
    warning: { background: 'rgba(200,163,64,0.1)', border: 'rgba(200,163,64,0.24)', color: '#8a6500' },
    error: { background: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.16)', color: '#b91c1c' },
  };
  const palette = palettes[tone] || palettes.neutral;
  meta.style.background = palette.background;
  meta.style.borderColor = palette.border;
  meta.style.color = palette.color;
}

function drawLocalizedFacePreview(imageSrc, analysis) {
  return new Promise((resolve) => {
    if (!analysis?.bbox) {
      resolve(imageSrc);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = 360;
      cropCanvas.height = 360;
      const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
      const bbox = analysis.bbox;
      const left = Math.max(0, (bbox.x_ratio || 0) * image.width);
      const top = Math.max(0, (bbox.y_ratio || 0) * image.height);
      const width = Math.max(40, (bbox.width_ratio || 1) * image.width);
      const height = Math.max(40, (bbox.height_ratio || 1) * image.height);
      const nose = analysis.landmarks?.nose;
      const eyeLeft = analysis.landmarks?.left_eye;
      const eyeRight = analysis.landmarks?.right_eye;
      const chin = analysis.landmarks?.chin;
      const noseX = nose ? nose.x_ratio * image.width : left + (width / 2);
      const eyesY = eyeLeft && eyeRight
        ? (((eyeLeft.y_ratio + eyeRight.y_ratio) / 2) * image.height)
        : top + (height * 0.34);
      const chinY = chin ? chin.y_ratio * image.height : top + height + (height * 0.05);
      const cropCenterX = noseX;
      const cropCenterY = (eyesY + chinY) / 2;
      const sourceSizeBase = Math.max(width * 1.58, (chinY - eyesY) * 1.75, height * 1.34);
      const preferredSize = Math.min(
        image.width,
        image.height,
        Math.max(180, sourceSizeBase)
      );
      const sourceLeft = Math.max(0, cropCenterX - (preferredSize / 2));
      const sourceTop = Math.max(0, cropCenterY - (preferredSize / 2.25));
      const sourceSize = Math.min(
        image.width - sourceLeft,
        image.height - sourceTop,
        preferredSize
      );
      ctx.filter = 'contrast(1.06) saturate(1.03)';
      ctx.drawImage(image, sourceLeft, sourceTop, sourceSize, sourceSize, 0, 0, cropCanvas.width, cropCanvas.height);
      ctx.filter = 'none';
      resolve(cropCanvas.toDataURL('image/jpeg', 0.95));
    };
    image.onerror = () => resolve(imageSrc);
    image.src = imageSrc;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function updateReferencePreview(src = faceVerification.profilePhotoDataUrl || '') {
  const img = byId('faceReferencePreview');
  const placeholder = byId('faceReferencePlaceholder');
  if (!img) return;
  if (!src) {
    img.removeAttribute('src');
    img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    updateReferenceMeta('Waiting for a profile photo face lock.', 'neutral');
    return;
  }
  img.src = src;
  img.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
}

async function analyzeUploadedProfilePhoto(file, sourceDataUrl) {
  faceVerification.profilePhotoAnalyzing = true;
  faceVerification.profilePhotoFaceReady = false;
  setFaceStageLoading(true, 'Locating the face in the uploaded photo...');
  updateProfilePhotoStatus('Locating the face in the uploaded photo...', 'info');
  updateReferenceMeta('Analyzing uploaded profile face', 'info');
  try {
    const analysis = await API.analyzeRegistrationFace(sourceDataUrl);
    const localizedPreview = await drawLocalizedFacePreview(sourceDataUrl, analysis);
    faceVerification.profilePhotoDataUrl = localizedPreview;
    faceVerification.profilePhotoFaceReady = !!analysis?.has_face;
    updateReferencePreview(localizedPreview);
    if (analysis?.has_face) {
      updateProfilePhotoStatus('Profile photo face located successfully. EPSA will use this face-focused reference during verification.', 'success');
      updateReferenceMeta(`Reference face locked • ${Number(analysis.face_count || 1)} face detected`, 'success');
    } else {
      updateProfilePhotoStatus('EPSA could not confidently locate a face in that photo. Upload a clearer front-facing profile photo.', 'warning');
      updateReferenceMeta('Reference face not locked yet', 'warning');
    }
  } catch (err) {
    faceVerification.profilePhotoDataUrl = sourceDataUrl;
    updateReferencePreview(sourceDataUrl);
    const message = err?.message?.includes('backend')
      ? 'Profile photo uploaded, but face analysis is waiting for the backend connection.'
      : 'EPSA could not analyze that profile photo yet. Try a clearer, front-facing image.';
    updateProfilePhotoStatus(message, err?.message?.includes('backend') ? 'warning' : 'error');
    updateReferenceMeta(err?.message?.includes('backend') ? 'Reference analysis waiting for backend' : 'Reference face analysis failed', err?.message?.includes('backend') ? 'warning' : 'error');
  } finally {
    faceVerification.profilePhotoAnalyzing = false;
    setFaceStageLoading(false);
    updateFaceActionButtons();
  }
}

function renderFaceChallenges() {
  const root = byId('faceChallengeList');
  if (!root) return;
  root.innerHTML = FACE_SCAN_TASKS.map((task, index) => {
    const done = faceVerification.tasks[task.key];
    const active = !done && faceVerification.challengeIndex === index;
    const holding = active && faceVerification.holdTaskKey === task.key;
    const remaining = holding ? Math.max(0, ((1 - faceVerification.holdProgress) * FACE_HOLD_DURATION_MS) / 1000).toFixed(1) : '';
    const meta = done
      ? '<div class="face-challenge-meta">Captured</div>'
      : active
        ? `<div class="face-challenge-meta">${holding ? `Hold steady ${remaining}s` : 'Position yourself'}</div>`
        : '';
    return `
      <div class="face-challenge-item ${done ? 'done' : ''} ${active ? 'active' : ''}" data-face-task="${task.key}">
        <div class="face-challenge-dot">${done ? 'OK' : index + 1}</div>
        <div class="face-challenge-text">
          <strong>${task.title}</strong>
          <span>${task.description}</span>
          ${meta}
        </div>
      </div>
    `;
  }).join('');
}

function getCurrentFaceTask() {
  return FACE_SCAN_TASKS.find((task) => !faceVerification.tasks[task.key]) || null;
}

function updateFacePrompt(message = '') {
  const promptEl = byId('faceScanPrompt');
  const currentTask = getCurrentFaceTask();
  const completedPrompt = isFaceLoginMode()
    ? 'Face capture is ready. EPSA can now sign you in.'
    : 'Face capture is ready. You can verify whenever you are ready.';
  if (promptEl) {
    promptEl.textContent = message || currentTask?.prompt || completedPrompt;
  }
  const stageTitle = byId('faceStageInstructionTitle');
  const stageCopy = byId('faceStageInstructionCopy');
  const stageReason = byId('faceStageInstructionReason');
  if (stageTitle) {
    stageTitle.textContent = currentTask ? currentTask.title : 'Identity map complete';
  }
  if (stageCopy) {
    stageCopy.textContent = message || currentTask?.prompt || `Your live facial map is ready to compare against the ${faceReferenceLabel()}.`;
  }
  if (stageReason) {
    stageReason.textContent = currentTask?.purpose || 'EPSA is using your tracked facial geometry and live crop for secure comparison.';
  }
  const badge = byId('faceStageTaskBadge');
  if (badge) {
    const hasProgress = FACE_SCAN_TASKS.some((task) => faceVerification.tasks[task.key]);
    if (!faceVerification.smartScanActive && !hasProgress && !faceVerification.verified) {
      badge.textContent = 'Ready when you are';
    } else {
      badge.textContent = currentTask
        ? `${currentTask.title}`
        : 'Face ready';
    }
  }
}

function getOverlayPoint(point) {
  if (!point || !Number.isFinite(point.x_ratio) || !Number.isFinite(point.y_ratio)) return null;
  // NOTE: The video element is CSS-mirrored (scaleX(-1)) for the user's natural
  // selfie experience. Landmark coordinates from the backend are in raw (unmirrored)
  // camera space, so we must mirror the X axis here to align with the visual feed.
  return {
    x: 100 - (point.x_ratio * 100),
    y: point.y_ratio * 100,
  };
}

function renderFaceLandmarkOverlay(analysis) {
  const overlay = byId('faceLandmarkOverlay');
  if (!overlay) return;
  if (!analysis?.hasFace || !analysis?.landmarks) {
    overlay.innerHTML = '';
    return;
  }

  const points = Object.fromEntries(
    Object.entries(analysis.landmarks)
      .map(([key, value]) => [key, getOverlayPoint(value)])
      .filter(([, value]) => !!value)
  );

  const drawPath = (items, className = 'face-landmark-link') => {
    const valid = items.filter(Boolean);
    if (valid.length < 2) return '';
    const pointsString = valid.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    return `<polyline class="${className}" points="${pointsString}" />`;
  };

  const nodeClass = (name) => {
    if (['nose', 'left_eye', 'right_eye', 'mouth_left', 'mouth_right'].includes(name)) return 'face-landmark-node primary';
    if (['left_brow', 'right_brow', 'chin'].includes(name)) return 'face-landmark-node secondary';
    return 'face-landmark-node derived';
  };

  overlay.innerHTML = `
    ${drawPath([points.left_brow, points.left_eye, points.nose, points.mouth_left, points.chin], 'face-landmark-link feature')}
    ${drawPath([points.right_brow, points.right_eye, points.nose, points.mouth_right, points.chin], 'face-landmark-link feature')}
    ${drawPath([points.right_cheek, points.nose, points.left_cheek], 'face-landmark-link')}
    ${drawPath([points.right_ear, points.right_cheek, points.chin, points.left_cheek, points.left_ear], 'face-landmark-link')}
    ${Object.entries(points).map(([name, point]) => `
      <circle class="${nodeClass(name)}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${['nose', 'left_eye', 'right_eye'].includes(name) ? '1.05' : '0.78'}"></circle>
    `).join('')}
  `;
}

function resetFaceHold() {
  faceVerification.holdTaskKey = '';
  faceVerification.holdStartedAt = 0;
  faceVerification.holdProgress = 0;
}

function setFaceStageLoading(active, message = 'Working...') {
  const loader = byId('faceStageLoader');
  const text = byId('faceStageLoaderText');
  if (loader) loader.style.display = active ? 'flex' : 'none';
  if (text) text.textContent = message;
}

function updateFaceHoldDisplay(task = getCurrentFaceTask()) {
  const title = byId('faceHoldTitle');
  const countdown = byId('faceHoldCountdown');
  const fill = byId('faceHoldBarFill');
  const caption = byId('faceHoldCaption');
  if (!title || !countdown || !fill || !caption) return;

  if (!task) {
    title.textContent = 'Face ready';
    countdown.textContent = 'Done';
    fill.style.width = '100%';
    caption.textContent = isFaceLoginMode()
      ? 'Your live face is ready. EPSA can compare it to your registered identity and sign you in.'
      : 'Your live face is ready. Verify it against your uploaded profile photo whenever you are ready.';
    return;
  }

  const holding = faceVerification.holdTaskKey === task.key && faceVerification.holdProgress > 0;
  const remaining = Math.max(0, ((1 - faceVerification.holdProgress) * FACE_HOLD_DURATION_MS) / 1000);
  title.textContent = holding ? `Holding: ${task.title}` : task.title;
  countdown.textContent = holding ? `${remaining.toFixed(1)}s` : '1.0s';
  fill.style.width = `${Math.round((faceVerification.holdProgress || 0) * 100)}%`;
  caption.textContent = holding
    ? 'Stay steady for a moment so EPSA can capture a clean frame.'
    : 'Center your face and hold still for a moment before capture.';
}

function updateFaceActionButtons() {
  const startBtn = byId('startSmartScanBtn');
  const captureBtn = byId('captureFaceBtn');
  const testBtn = byId('testFaceBtn');
  const retakeBtn = byId('retakeFaceBtn');
  const busy = !!faceVerification.busyAction;
  const ready = FACE_SCAN_TASKS.every((task) => faceVerification.tasks[task.key]);

  if (startBtn) {
    if (isFaceLoginMode()) {
      startBtn.style.display = 'none';
    } else {
      startBtn.style.display = '';
      startBtn.disabled = !faceVerification.stream || faceVerification.smartScanActive || busy;
      startBtn.textContent = faceVerification.smartScanActive ? 'Camera Active...' : 'Start Live Check';
    }
  }

  if (captureBtn) {
    captureBtn.disabled = !faceVerification.stream || busy;
    captureBtn.textContent = faceVerification.busyAction === 'verify'
      ? (isFaceLoginMode() ? 'Signing In...' : 'Verifying...')
      : isFaceLoginMode()
        ? 'Use Current Face'
        : 'Verify Live Face';
  }

  if (testBtn) {
    testBtn.style.display = 'none';
  }

  if (retakeBtn) {
    retakeBtn.style.display = faceVerification.smartScanActive || faceVerification.verified || faceVerification.bestCapture ? 'inline-flex' : 'none';
    retakeBtn.disabled = busy;
  }
}

function updateFaceMetricDisplay(analysis = faceVerification.latestAnalysis) {
  const lighting = byId('faceMetricLighting');
  const alignment = byId('faceMetricAlignment');
  const expression = byId('faceMetricExpression');
  const movement = byId('faceMetricMovement');
  const tracker = byId('faceTrackerStatus');
  const yaw = byId('faceMetricYaw');

  if (!analysis) {
    if (lighting) lighting.textContent = 'Analyzing';
    if (alignment) alignment.textContent = 'Waiting';
    if (expression) expression.textContent = 'Waiting';
    if (movement) movement.textContent = 'Waiting';
    if (tracker) tracker.textContent = 'Searching';
    if (yaw) yaw.textContent = '0 deg';
    return;
  }

  if (lighting) {
    if (analysis.faceBrightness >= 40) lighting.textContent = 'Balanced';
    else if (analysis.faceBrightness >= 20) lighting.textContent = 'Boosting';
    else lighting.textContent = 'Recovering';
  }
  if (alignment) {
    alignment.textContent = analysis.hasFace
      ? `${Math.round(Math.max(0, 100 - analysis.alignment * 100))}% locked`
      : 'Face not found';
  }
  if (expression) {
    const ff = analysis.facialFeatures;
    if (ff?.teeth_visible_likely) {
      expression.textContent = 'Teeth / smile visible';
    } else if (ff && ff.eyes_detected === false) {
      expression.textContent = 'Eyes need to be visible';
    } else if (analysis.smileDelta >= 0.08) {
      expression.textContent = 'Smile detected';
    } else {
      expression.textContent = 'Neutral expression';
    }
  }
  if (movement) {
    if (Math.abs(analysis.turnOffset) >= 0.07) movement.textContent = 'Head turn seen';
    else if (analysis.areaRatio > 0 && faceVerification.baseline.areaRatio && analysis.areaRatio > faceVerification.baseline.areaRatio * 1.12) movement.textContent = 'Closer';
    else movement.textContent = 'Tracking';
  }
  if (tracker) tracker.textContent = analysis.hasFace ? 'Locked' : 'Searching';
  if (yaw) {
    const direction = analysis.yawDegrees <= -7 ? 'Left' : analysis.yawDegrees >= 7 ? 'Right' : 'Center';
    yaw.textContent = `${direction} ${analysis.yawDegrees > 0 ? '+' : ''}${analysis.yawDegrees} deg`;
  }
}

function renderAngleGallery() {
  const root = byId('faceAngleGallery');
  if (!root) return;
  if (!faceVerification.angleSamples.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = faceVerification.angleSamples.map((sample) => `
    <div class="face-angle-card">
      <img src="${sample.image}" alt="${sample.label}">
      <span>${sample.label}</span>
    </div>
  `).join('');
}

async function prepareFaceVerificationStep() {
  resetFaceVerification(true);
  renderFaceChallenges();
  updateReferencePreview();
  updateFacePrompt();
  updateFaceMetricDisplay();
  renderAngleGallery();
  updateFaceHoldDisplay();
  updateFaceStatus('This live face check is optional. Look into the camera and tap verify if you want EPSA to compare your live face with your uploaded photo.', 'info');
  const photoFile = byId('profilePhotoInput')?.files?.[0];
  if (photoFile && !faceVerification.profilePhotoFaceReady && !faceVerification.profilePhotoAnalyzing) {
    try {
      const sourceDataUrl = faceVerification.profilePhotoDataUrl || await readFileAsDataUrl(photoFile);
      faceVerification.profilePhotoDataUrl = sourceDataUrl;
      updateReferencePreview(sourceDataUrl);
      await analyzeUploadedProfilePhoto(photoFile, sourceDataUrl);
    } catch (err) {
      updateProfilePhotoStatus(err.message || 'EPSA could not prepare the uploaded profile photo yet.', 'warning');
    }
  }
  await startFaceCamera();
}

async function initializeFaceDetector() {
  if (faceVerification.detectorReady) return faceVerification.detector;
  faceVerification.detectorReady = true;
  if (!('FaceDetector' in window)) return null;
  try {
    faceVerification.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
  } catch (err) {
    faceVerification.detector = null;
  }
  return faceVerification.detector;
}

async function startFaceCamera() {
  stopFaceCamera(false);
  const video = byId('faceVerifyVideo');
  const fallback = byId('faceCameraFallback');
  if (!video) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('camera_api_unavailable');
    }
    faceVerification.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = faceVerification.stream;
    await video.play().catch(() => {});
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((resolve) => {
        const finish = () => resolve();
        video.addEventListener('loadedmetadata', finish, { once: true });
        setTimeout(finish, 1200);
      });
    }
    if (fallback) fallback.style.display = 'none';
    updateFaceFocusHint(isFaceLoginMode()
      ? 'Camera ready. Look naturally into the guide for automatic sign-in.'
      : 'Camera ready. Look into the frame, then verify when you are ready.');
    await initializeFaceDetector();
  } catch (err) {
    if (fallback) fallback.style.display = 'flex';
    updateFaceStatus(
      err?.message === 'camera_api_unavailable'
        ? 'This browser cannot open the camera here. Use the locally served EPSA site on your computer or the secure HTTPS deployment link on your phone.'
        : 'Camera access failed. Allow camera permission and retry.',
      'error'
    );
  } finally {
    updateFaceActionButtons();
  }
}

function stopFaceAnalysis() {
  if (faceVerification.analysisTimer) {
    clearInterval(faceVerification.analysisTimer);
    faceVerification.analysisTimer = null;
  }
  faceVerification.smartScanActive = false;
  faceVerification.processing = false;
}

function stopFaceCamera(resetWorkflow = false) {
  stopFaceAnalysis();
  if (faceVerification.stream) {
    faceVerification.stream.getTracks().forEach((track) => track.stop());
    faceVerification.stream = null;
  }
  if (resetWorkflow) {
    resetFaceState();
    renderFaceChallenges();
    updateFaceMetricDisplay();
    updateFaceHoldDisplay();
  }
  updateFaceActionButtons();
}

function updateFaceFocusHint(message) {
  const hint = byId('faceFocusHint');
  if (hint) hint.textContent = message;
}

function createAnalysisBox(frameWidth, frameHeight, rawBox) {
  if (!rawBox) {
    const width = frameWidth * 0.46;
    const height = frameHeight * 0.66;
    return {
      x: (frameWidth - width) / 2,
      y: (frameHeight - height) / 2,
      width,
      height,
    };
  }
  return {
    x: Math.max(0, rawBox.x),
    y: Math.max(0, rawBox.y),
    width: Math.min(frameWidth, rawBox.width),
    height: Math.min(frameHeight, rawBox.height),
  };
}

function getLandmarkPoint(face, type) {
  const landmarks = Array.isArray(face?.landmarks) ? face.landmarks : [];
  const matches = landmarks.filter((landmark) => {
    const name = String(landmark?.type || landmark?.kind || '').toLowerCase();
    return name.includes(type);
  });
  if (!matches.length) return null;
  const points = matches
    .flatMap((landmark) => landmark.locations || landmark.points || [landmark.location || landmark])
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return null;
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return { x, y };
}

function computeAverageLuminance(imageData) {
  const { data, width, height } = imageData;
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;
      total += (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function computeRegionSignature(imageData, size = 8) {
  const stepX = Math.max(1, Math.floor(imageData.width / size));
  const stepY = Math.max(1, Math.floor(imageData.height / size));
  const signature = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let total = 0;
      let count = 0;
      const startX = col * stepX;
      const startY = row * stepY;
      const endX = Math.min(imageData.width, startX + stepX);
      const endY = Math.min(imageData.height, startY + stepY);
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const index = (y * imageData.width + x) * 4;
          total += (imageData.data[index] * 0.299) + (imageData.data[index + 1] * 0.587) + (imageData.data[index + 2] * 0.114);
          count += 1;
        }
      }
      signature.push(count ? total / count : 0);
    }
  }
  return signature;
}

function computeSignatureDifference(current, previous) {
  if (!current || !previous || current.length !== previous.length) return 0;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) {
    total += Math.abs(current[index] - previous[index]);
  }
  return total / current.length;
}

function getImageRegion(ctx, x, y, width, height) {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const safeWidth = Math.max(4, Math.round(width));
  const safeHeight = Math.max(4, Math.round(height));
  return ctx.getImageData(left, top, safeWidth, safeHeight);
}

function getSmileRegion(box) {
  return {
    x: box.x + (box.width * 0.2),
    y: box.y + (box.height * 0.58),
    width: box.width * 0.6,
    height: box.height * 0.18,
  };
}

function computeHalfBalance(imageData) {
  let left = 0;
  let right = 0;
  let leftCount = 0;
  let rightCount = 0;
  const midpoint = imageData.width / 2;
  for (let y = 0; y < imageData.height; y += 4) {
    for (let x = 0; x < imageData.width; x += 4) {
      const index = (y * imageData.width + x) * 4;
      const luminance = (imageData.data[index] * 0.299) + (imageData.data[index + 1] * 0.587) + (imageData.data[index + 2] * 0.114);
      if (x < midpoint) {
        left += luminance;
        leftCount += 1;
      } else {
        right += luminance;
        rightCount += 1;
      }
    }
  }
  const leftAvg = leftCount ? left / leftCount : 0;
  const rightAvg = rightCount ? right / rightCount : 0;
  return (rightAvg - leftAvg) / 255;
}

function storeAngleSample(label, image) {
  if (!image || faceVerification.sampleLabels[label]) return;
  faceVerification.sampleLabels[label] = true;
  faceVerification.angleSamples.push({ label, image });
  faceVerification.angleSamples = faceVerification.angleSamples.slice(-6);
  renderAngleGallery();
}

function updateGuideFrame(analysis) {
  const frame = byId('faceGuideFrame');
  if (!frame) return;

  if (!analysis) {
    renderFaceLandmarkOverlay(null);
    frame.classList.remove('detected');
    frame.style.left = '50%';
    frame.style.top = '50%';
    frame.style.width = 'min(58%, 270px)';
    frame.style.height = 'min(72%, 320px)';
    frame.style.transform = 'translate(-50%, -50%)';
    return;
  }

  if (!analysis.hasFace) {
    renderFaceLandmarkOverlay(null);
    frame.classList.remove('detected');
    frame.style.left = '50%';
    frame.style.top = '50%';
    frame.style.width = 'min(58%, 270px)';
    frame.style.height = 'min(72%, 320px)';
    frame.style.transform = 'translate(-50%, -50%)';
    return;
  }

  const mirroredLeft = ((analysis.frameWidth - analysis.box.x - analysis.box.width) / analysis.frameWidth) * 100;
  const top = (analysis.box.y / analysis.frameHeight) * 100;
  const width = (analysis.box.width / analysis.frameWidth) * 100;
  const height = (analysis.box.height / analysis.frameHeight) * 100;

  frame.classList.add('detected');
  frame.style.left = `${mirroredLeft}%`;
  frame.style.top = `${top}%`;
  frame.style.width = `${width}%`;
  frame.style.height = `${height}%`;
  frame.style.transform = 'translate(0, 0)';
  renderFaceLandmarkOverlay(analysis);
}

function buildVerificationCapture(sourceCanvas, box, faceBrightness) {
  const paddingX = box.width * 0.26;
  const paddingY = box.height * 0.22;
  const left = Math.max(0, box.x - paddingX);
  const top = Math.max(0, box.y - paddingY);
  const size = Math.min(
    sourceCanvas.width - left,
    sourceCanvas.height - top,
    Math.max(box.width + (paddingX * 2), box.height + (paddingY * 2))
  );

  const dest = document.createElement('canvas');
  dest.width = 420;
  dest.height = 420;
  const destCtx = dest.getContext('2d', { willReadFrequently: true });
  const brightnessBoost = faceBrightness < 38 ? 1.42 : faceBrightness < 54 ? 1.18 : 1.04;
  const contrastBoost = faceBrightness < 38 ? 1.2 : 1.1;
  const saturationBoost = faceBrightness < 38 ? 1.08 : 1.04;
  destCtx.filter = `brightness(${brightnessBoost}) contrast(${contrastBoost}) saturate(${saturationBoost})`;
  destCtx.drawImage(sourceCanvas, left, top, size, size, 0, 0, dest.width, dest.height);
  destCtx.filter = 'none';
  return dest.toDataURL('image/jpeg', 0.94);
}

function buildAnalysisCapture(sourceCanvas) {
  const maxWidth = 480;
  const scale = Math.min(1, maxWidth / Math.max(sourceCanvas.width, 1));
  if (scale >= 0.98) {
    return sourceCanvas.toDataURL('image/jpeg', 0.74);
  }
  const dest = document.createElement('canvas');
  dest.width = Math.max(160, Math.round(sourceCanvas.width * scale));
  dest.height = Math.max(120, Math.round(sourceCanvas.height * scale));
  const ctx = dest.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, dest.width, dest.height);
  return dest.toDataURL('image/jpeg', 0.72);
}

function captureCurrentAngleSample(label, analysis) {
  const canvas = byId('faceVerifyCanvas');
  if (!canvas || !analysis?.box) return;
  const image = buildVerificationCapture(canvas, analysis.box, analysis.faceBrightness);
  storeAngleSample(label, image);
}

async function analyzeCurrentFrame() {
  const video = byId('faceVerifyVideo');
  const canvas = byId('faceVerifyCanvas');
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const detector = faceVerification.detector;
  let faces = [];
  let primaryFace = null;
  let rawBox = null;
  let backendMetrics = null;

  if (detector) {
    try {
      faces = await detector.detect(video);
    } catch (err) {
      faces = [];
    }
    primaryFace = Array.isArray(faces) && faces.length === 1 ? faces[0] : null;
    rawBox = primaryFace?.boundingBox
      ? {
          x: primaryFace.boundingBox.x,
          y: primaryFace.boundingBox.y,
          width: primaryFace.boundingBox.width,
          height: primaryFace.boundingBox.height,
        }
      : null;
  }

  try {
    backendMetrics = await API.analyzeRegistrationFace(buildAnalysisCapture(canvas));
  } catch (err) {
    backendMetrics = { has_face: false, face_count: 0 };
  }

  const backendHasFace = !!backendMetrics?.has_face && Number(backendMetrics?.face_count || 0) >= 1;
  if (backendHasFace && backendMetrics?.bbox) {
    rawBox = {
      x: backendMetrics.bbox.x_ratio * canvas.width,
      y: backendMetrics.bbox.y_ratio * canvas.height,
      width: backendMetrics.bbox.width_ratio * canvas.width,
      height: backendMetrics.bbox.height_ratio * canvas.height,
    };
  }

  const activeFaceCount = backendHasFace
    ? Number(backendMetrics?.face_count || 1)
    : (detector ? faces.length : 0);

  const hasLockedFace = backendHasFace || !!primaryFace;
  const box = createAnalysisBox(canvas.width, canvas.height, rawBox);
  const faceImage = getImageRegion(ctx, box.x, box.y, box.width, box.height);
  const faceBrightness = computeAverageLuminance(faceImage);
  const frameBrightness = computeAverageLuminance(getImageRegion(ctx, 0, 0, canvas.width, canvas.height));
  const faceSignature = computeRegionSignature(faceImage, 8);
  const faceMotion = computeSignatureDifference(faceSignature, faceVerification.previousFaceSignature);
  faceVerification.previousFaceSignature = faceSignature;

  const mouthRegion = getSmileRegion(box);
  const mouthImage = getImageRegion(ctx, mouthRegion.x, mouthRegion.y, mouthRegion.width, mouthRegion.height);
  const mouthSignature = computeRegionSignature(mouthImage, 6);
  const mouthMotion = computeSignatureDifference(mouthSignature, faceVerification.previousMouthSignature);
  faceVerification.previousMouthSignature = mouthSignature;

  const faceCenterX = box.x + (box.width / 2);
  const frameCenterX = canvas.width / 2;
  const areaRatio = (box.width * box.height) / (canvas.width * canvas.height);
  const alignment = Math.abs(faceCenterX - frameCenterX) / canvas.width;
  const nosePoint = primaryFace ? getLandmarkPoint(primaryFace, 'nose') : null;
  let yawDegrees = Number(backendMetrics?.yaw_degrees || 0);
  let turnOffset = yawDegrees / 130;
  if (!backendHasFace && detector) {
    const rawGeometricTurn = nosePoint
      ? (nosePoint.x - faceCenterX) / Math.max(box.width, 1)
      : faceVerification.baseline.faceCenterX != null
        ? (faceCenterX - faceVerification.baseline.faceCenterX) / canvas.width
        : 0;
    const balanceOffset = computeHalfBalance(faceImage);
    if (faceVerification.baseline.yawBalance == null && faceBrightness >= 26) {
      faceVerification.baseline.yawBalance = balanceOffset;
    }
    const relativeBalance = balanceOffset - (faceVerification.baseline.yawBalance || 0);
    const rawTurnOffset = (rawGeometricTurn * 0.72) + (relativeBalance * 0.55);
    turnOffset = -rawTurnOffset;
    yawDegrees = Math.max(-32, Math.min(32, Math.round(turnOffset * 130)));
  }

  const smileSignal = backendHasFace
    ? Number(backendMetrics?.smile_score || 0)
    : detector
      ? mouthMotion
      : 0;
  if (faceVerification.baseline.smileScore == null && faceBrightness >= 26) {
    faceVerification.baseline.smileScore = smileSignal || 0.01;
  }
  const baselineSmile = faceVerification.baseline.smileScore || 0.01;
  const smileDelta = detector
    ? Math.max(0, (smileSignal - baselineSmile) / Math.max(baselineSmile, 0.01))
    : Math.max(0, smileSignal - baselineSmile);

  const qualityScore = Math.max(0, 1 - alignment) + Math.max(0, faceBrightness / 100) + (areaRatio * 3);
  if (faceBrightness >= 18 && alignment <= 0.18 && areaRatio >= 0.08) {
    const improvedCapture = buildVerificationCapture(canvas, box, faceBrightness);
    if (qualityScore >= faceVerification.bestCaptureQuality) {
      faceVerification.bestCapture = improvedCapture;
      faceVerification.bestCaptureQuality = qualityScore;
    }
  }

  return {
    box,
    frameWidth: canvas.width,
    frameHeight: canvas.height,
    landmarks: backendHasFace ? backendMetrics?.landmarks || null : null,
    facialFeatures: backendHasFace ? backendMetrics?.facial_features || null : null,
    hasFace: hasLockedFace,
    faceCount: activeFaceCount,
    brightness: backendHasFace ? Number(backendMetrics?.brightness || frameBrightness) : frameBrightness,
    faceBrightness: backendHasFace ? Number(backendMetrics?.brightness || faceBrightness) : faceBrightness,
    alignment,
    smileDelta,
    movement: faceMotion,
    turnOffset,
    yawDegrees,
    areaRatio,
    faceCenterX,
  };
}

function markFaceTaskComplete(key, statusMessage) {
  if (faceVerification.tasks[key]) return;
  resetFaceHold();
  faceVerification.tasks[key] = true;
  const nextIncomplete = FACE_SCAN_TASKS.findIndex((task) => !faceVerification.tasks[task.key]);
  faceVerification.challengeIndex = nextIncomplete === -1 ? FACE_SCAN_TASKS.length : nextIncomplete;
  renderFaceChallenges();
  updateFacePrompt(statusMessage || '');
  updateFaceHoldDisplay();
}

function getFaceTaskSignal(taskKey, analysis) {
  switch (taskKey) {
    case 'lighting':
      return analysis.faceBrightness >= 18;
    case 'centered':
      return analysis.alignment <= 0.18 && analysis.areaRatio >= 0.07 && analysis.areaRatio <= 0.6;
    case 'smile':
      return analysis.smileDelta >= (faceVerification.detector ? 0.08 : 0.22) || (analysis.movement >= 4 && analysis.faceBrightness >= 26);
    case 'turnLeft':
      return (
        (!faceVerification.detector && analysis.movement >= 6) ||
        analysis.yawDegrees <= -7 ||
        analysis.turnOffset <= -0.035 ||
        analysis.faceCenterX <= (faceVerification.baseline.faceCenterX || analysis.faceCenterX) - (analysis.frameWidth * 0.03)
      );
    case 'turnRight':
      return (
        (!faceVerification.detector && analysis.movement >= 6) ||
        analysis.yawDegrees >= 7 ||
        analysis.turnOffset >= 0.035 ||
        analysis.faceCenterX >= (faceVerification.baseline.faceCenterX || analysis.faceCenterX) + (analysis.frameWidth * 0.03)
      );
    case 'moveCloser':
      return (
        (!faceVerification.detector && analysis.movement >= 5) ||
        (faceVerification.baseline.areaRatio && analysis.areaRatio >= faceVerification.baseline.areaRatio * 1.14)
      );
    default:
      return false;
  }
}

function finalizeFaceTask(taskKey, analysis) {
  switch (taskKey) {
    case 'lighting':
      faceVerification.baseline.brightness = analysis.faceBrightness;
      markFaceTaskComplete('lighting', 'Adaptive lighting locked. The scanner will now keep recovering facial detail in darker environments.');
      return;
    case 'centered':
      faceVerification.baseline.areaRatio = analysis.areaRatio;
      faceVerification.baseline.faceCenterX = analysis.faceCenterX;
      faceVerification.baseline.smileScore = Math.max(faceVerification.baseline.smileScore || 0.01, analysis.movement || 0.01);
      captureCurrentAngleSample('Front', analysis);
      markFaceTaskComplete('centered', 'Front face captured. Next, give a natural smile and hold it.');
      return;
    case 'smile':
      captureCurrentAngleSample('Smile', analysis);
      markFaceTaskComplete('smile', 'Smile captured. Turn slightly to your left and hold still for the next shot.');
      return;
    case 'turnLeft':
      captureCurrentAngleSample('Left view', analysis);
      markFaceTaskComplete('turnLeft', 'Left-side structure captured. Turn slightly to your right and hold it.');
      return;
    case 'turnRight':
      captureCurrentAngleSample('Right view', analysis);
      markFaceTaskComplete('turnRight', 'Right-side structure captured. Move a little closer for the final focused capture.');
      return;
    case 'moveCloser':
      captureCurrentAngleSample('Close focus', analysis);
      markFaceTaskComplete('moveCloser', 'Smart scan complete. Your guided face map is ready for the final match.');
      if (isFaceLoginMode()) {
        updateFaceStatus('Smart liveness scan complete. EPSA is verifying your registered face map and preparing portal access.', 'success');
        setTimeout(() => {
          if (isFaceLoginMode() && !faceVerification.busyAction) {
            runFaceLogin({ autoTriggered: true });
          }
        }, 420);
      } else {
        updateFaceStatus('Live camera is ready. Click <strong>Verify Live Face</strong> to compare the current live frame against your uploaded profile photo.', 'success');
      }
      return;
    default:
      return;
  }
}

function advanceFaceTaskHold(task, analysis) {
  if (faceVerification.holdTaskKey !== task.key) {
    faceVerification.holdTaskKey = task.key;
    faceVerification.holdStartedAt = Date.now();
    faceVerification.holdProgress = 0;
    renderFaceChallenges();
    updateFaceHoldDisplay(task);
  }

  const elapsed = Date.now() - (faceVerification.holdStartedAt || Date.now());
  faceVerification.holdProgress = Math.max(0, Math.min(1, elapsed / FACE_HOLD_DURATION_MS));
  renderFaceChallenges();
  updateFaceHoldDisplay(task);

  if (faceVerification.holdProgress < 1) {
    updateFaceStatus(`Hold steady for ${task.title.toLowerCase()}. EPSA will capture this step automatically in one second.`, 'info');
    return false;
  }

  finalizeFaceTask(task.key, analysis);
  return true;
}

function evaluateFaceAnalysis(analysis) {
  if (!analysis) return;

  faceVerification.metrics = { ...analysis };
  faceVerification.latestAnalysis = analysis;
  updateGuideFrame(analysis);
  updateFaceMetricDisplay(analysis);

  if (analysis.faceCount > 1) {
    resetFaceHold();
    renderFaceChallenges();
    updateFaceHoldDisplay();
    updateFaceFocusHint('Only one face should be visible in the camera.');
    updateFaceStatus('More than one face was detected. Move to a private frame and continue the scan.', 'gold');
    return;
  }

  if (!analysis.hasFace) {
    resetFaceHold();
    renderFaceChallenges();
    updateFaceHoldDisplay();
    faceVerification.lockMissCount += 1;
    const scanElapsed = faceVerification.scanStartedAt ? Date.now() - faceVerification.scanStartedAt : 0;
    if (faceVerification.lockMissCount >= 12 && scanElapsed >= 9000) {
      updateFaceFocusHint('The scanner still needs a clearer face. You can keep adjusting, then tap Verify Live Face whenever the frame looks clear.');
      updateFaceStatus('Live face lock is still unstable, but this step is optional. If you want to continue with it, steady the camera and try verifying again.', 'gold');
    } else {
      updateFaceFocusHint('Bring your face inside the guide and hold still for a moment.');
      updateFaceStatus('EPSA is locating your face. Keep the camera steady, stay inside the guide, and avoid strong backlight.', 'info');
    }
    return;
  }

  faceVerification.lockMissCount = 0;

  const currentTask = getCurrentFaceTask();
  if (!currentTask) {
    resetFaceHold();
    updateFaceHoldDisplay(null);
    updateFaceFocusHint(isFaceLoginMode() ? 'Smart scan complete. EPSA is ready to sign you in.' : 'Smart scan complete. Run the final identity match.');
    updateFaceStatus(
      isFaceLoginMode()
        ? 'Liveness checks complete. EPSA is ready to compare your live scan with your registered identity and sign you in.'
        : 'Liveness checks complete. Run the final identity match to compare your live scan with the uploaded photo.',
      'success'
    );
    updateFaceActionButtons();
    return;
  }

  updateFaceFocusHint(faceVerification.detector ? currentTask.prompt : `${currentTask.prompt} Server-grade face tracking is assisting this scan.`);
  updateFaceHoldDisplay(currentTask);

  if (getFaceTaskSignal(currentTask.key, analysis)) {
    if (advanceFaceTaskHold(currentTask, analysis)) {
      updateFaceActionButtons();
    }
    return;
  }

  if (faceVerification.holdTaskKey === currentTask.key) {
    resetFaceHold();
    renderFaceChallenges();
    updateFaceHoldDisplay(currentTask);
  }

  updateFaceStatus(`Position for ${currentTask.title.toLowerCase()}, then hold steady for one second and EPSA will capture it automatically.`, 'info');

  updateFaceActionButtons();
}

async function runFaceAnalysisTick() {
  if (!faceVerification.smartScanActive || faceVerification.processing) return;
  faceVerification.processing = true;
  try {
    const analysis = await analyzeCurrentFrame();
    evaluateFaceAnalysis(analysis);
  } finally {
    faceVerification.processing = false;
  }
}

async function startSmartFaceScan() {
  if (!faceVerification.stream) {
    await startFaceCamera();
  }
  stopFaceAnalysis();
  resetFaceVerification(true);
  await initializeFaceDetector();
  renderFaceChallenges();
  updateFacePrompt();
  updateFaceMetricDisplay();
  updateFaceHoldDisplay();
  updateFaceStatus(
    isFaceLoginMode()
      ? 'Camera started. Keep your face in the frame and EPSA will sign you in as soon as a clear live capture is ready.'
      : 'Camera started. Center your face and tap Verify Live Face whenever you are ready.',
    'info'
  );
  faceVerification.smartScanActive = true;
  faceVerification.scanStartedAt = Date.now();
  updateFaceActionButtons();
  await runFaceAnalysisTick();
  faceVerification.analysisTimer = setInterval(runFaceAnalysisTick, faceVerification.detector ? 420 : 650);
}

// ── Login-mode: seamless continuous scan ────────────────────────────────────
// In login mode we do NOT require the 6-step guided liveness scan.
// We run a quiet polling loop: every 700ms grab a frame, check face stability,
// and once we see FACE_LOGIN_STABLE_NEEDED consecutive clear-face frames,
// auto-call runFaceLogin(). The backend matches against ALL enrolled faces.
const FACE_LOGIN_STABLE_NEEDED = 3;

async function runLoginScanTick() {
  const modal = byId('faceLoginModal');
  if (!modal?.classList.contains('active')) return;
  if (faceVerification.busyAction) return;
  if (!faceVerification.stream) return;

  try {
    const analysis = await analyzeCurrentFrame();
    if (!analysis) return;

    // Update guide frame and metrics silently
    updateGuideFrame(analysis);
    updateFaceMetricDisplay(analysis);
    faceVerification.latestAnalysis = analysis;

    if (analysis.faceCount > 1) {
      faceVerification.loginStableFrames = 0;
      updateFaceStatus('Only one face must be visible. Please be in a private space.', 'gold');
      updateFaceFocusHint('Multiple faces detected — please be alone.');
      return;
    }

    if (!analysis.hasFace || analysis.alignment > 0.25 || analysis.areaRatio < 0.045) {
      faceVerification.loginStableFrames = 0;
      faceVerification.loginVisibleFrames = 0;
      updateFaceFocusHint('Center your face inside the guide and hold still.');
      if ((faceVerification.loginVisibleFrames || 0) === 0) {
        updateFaceStatus('Looking for your face… Center yourself in the guide for automatic sign-in.', 'info');
      }
      return;
    }

    // Face is detected and reasonably centered
    faceVerification.loginVisibleFrames = (faceVerification.loginVisibleFrames || 0) + 1;
    faceVerification.loginStableFrames = (faceVerification.loginStableFrames || 0) + 1;

    const stabilityPct = Math.min(100, Math.round((faceVerification.loginStableFrames / FACE_LOGIN_STABLE_NEEDED) * 100));
    updateFaceFocusHint('Face locked — scanning ' + stabilityPct + '%…');
    updateFaceStatus('Face detected. Scanning identity…', 'info');

    // Save best quality capture while building stable frames
    const canvas = byId('faceVerifyCanvas');
    if (canvas && analysis.box) {
      const capture = buildVerificationCapture(canvas, analysis.box, analysis.faceBrightness || 42);
      const quality = Math.max(0, 1 - analysis.alignment) + (analysis.faceBrightness / 100) + (analysis.areaRatio * 3);
      if (quality >= (faceVerification.bestCaptureQuality || 0)) {
        faceVerification.bestCapture = capture;
        faceVerification.bestCaptureQuality = quality;
      }
    }

    if (faceVerification.loginStableFrames >= FACE_LOGIN_STABLE_NEEDED) {
      stopFaceAnalysis();
      await runFaceLogin({ autoTriggered: true });
    }
  } catch (err) {
    // Silently ignore individual frame errors
  }
}

async function startInstantFaceLoginScan() {
  if (!faceVerification.stream) {
    await startFaceCamera();
  }
  stopFaceAnalysis();
  faceVerification.loginStableFrames = 0;
  faceVerification.loginVisibleFrames = 0;
  faceVerification.bestCapture = '';
  faceVerification.bestCaptureQuality = 0;
  faceVerification.smartScanActive = true;
  await initializeFaceDetector();
  updateFaceStatus('Looking for your face… Hold still and look directly at the camera.', 'info');
  updateFaceFocusHint('Center your face and hold still for automatic sign-in.');
  updateFaceActionButtons();
  await runLoginScanTick();
  faceVerification.analysisTimer = setInterval(runLoginScanTick, 700);
}

async function runFaceComparison({ testOnly = false } = {}) {
  const photo = byId('profilePhotoInput')?.files?.[0];
  if (!photo) {
    showToast('Upload a profile photo first.', 'error');
    return;
  }

  if (!faceVerification.profilePhotoFaceReady && !faceVerification.profilePhotoAnalyzing) {
    try {
      const sourceDataUrl = faceVerification.profilePhotoDataUrl || await readFileAsDataUrl(photo);
      faceVerification.profilePhotoDataUrl = sourceDataUrl;
      await analyzeUploadedProfilePhoto(photo, sourceDataUrl);
    } catch (err) {
      updateProfilePhotoStatus(err.message || 'EPSA could not prepare the uploaded profile photo for matching.', 'error');
    }
  }

  const analysis = await analyzeCurrentFrame();
  if (!analysis) {
    showToast('Camera is not ready yet. Please retry.', 'error');
    return;
  }
  evaluateFaceAnalysis(analysis);
  if (!analysis.hasFace || analysis.faceCount !== 1) {
    updateFaceStatus('EPSA needs one clear, current face in the camera before it can compare identity.', 'error');
    showToast('A clear live face is required before comparison.', 'error');
    return;
  }

  const canvas = byId('faceVerifyCanvas');
  let liveCapture = '';
  if (canvas) {
    const currentBox = analysis?.box || createAnalysisBox(canvas.width, canvas.height, null);
    liveCapture = buildVerificationCapture(canvas, currentBox, analysis?.faceBrightness || 42);
  }
  if (!liveCapture) {
    showToast('No face capture is ready yet. Retake the smart scan.', 'error');
    return;
  }

  faceVerification.capture = liveCapture;
  faceVerification.busyAction = testOnly ? 'test' : 'verify';
  setFaceStageLoading(true, testOnly ? 'Testing your live face against the uploaded profile photo...' : 'Comparing your live face to the uploaded profile photo...');
  if (!FACE_SCAN_TASKS.every((task) => faceVerification.tasks[task.key])) {
    updateFaceStatus(testOnly
      ? 'Guided capture is incomplete, but EPSA is still running a test comparison from the current live frame.'
      : 'Tracker guidance is incomplete, but EPSA is running the direct identity match from the live frame anyway.', 'gold');
  } else {
    updateFaceStatus(testOnly
      ? 'Running a smart test comparison against the uploaded profile photo...'
      : 'Running the final identity match against the uploaded profile photo...', 'info');
  }
  updateFaceActionButtons();

  const formData = new FormData();
  formData.append('profile_photo', photo);
  formData.append('live_capture', liveCapture);
  formData.append('angle_samples', JSON.stringify(faceVerification.angleSamples.map((sample) => sample.image)));

  try {
    const result = await API.verifyRegistrationFace(formData);
    if (!testOnly) {
      faceVerification.verified = !!result.verified;
      faceVerification.score = result.score;
      faceVerification.threshold = result.threshold;
    }
    if (result.verified) {
      if (!testOnly) {
        stopFaceAnalysis();
        updateFaceStatus(`Identity verified successfully. Match score: <strong>${result.score}</strong>. Your smart scan is now linked to the uploaded profile photo.`, 'success');
        if (byId('face-err')) byId('face-err').style.display = 'none';
        showToast('Smart face verification passed.', 'success');
      } else {
        updateFaceStatus(`Test match passed. Match score: <strong>${result.score}</strong>. This environment looks compatible with your uploaded profile photo.`, 'success');
        showToast('Test match passed.', 'success');
      }
    } else {
      if (!testOnly) {
        updateFaceStatus(`Verification failed. Match score: <strong>${result.score}</strong>. Retake the smart scan and keep your face inside the guide during the final movement step.`, 'error');
        showToast(result.message || 'Face verification failed.', 'error');
      } else {
        updateFaceStatus(`Test match did not pass yet. Match score: <strong>${result.score}</strong>. Try another room angle, a steadier frame, or slightly better light and test again.`, 'gold');
        showToast(result.message || 'Test match did not pass.', 'gold');
      }
    }
  } catch (err) {
    if (!testOnly) {
      faceVerification.verified = false;
    }
    updateFaceStatus(err.message || 'Face verification failed. Please retry the smart scan.', 'error');
    showToast(err.message || 'Face verification failed.', 'error');
  } finally {
    faceVerification.busyAction = '';
    setFaceStageLoading(false);
    updateFaceActionButtons();
  }
}

async function captureAndVerifyFace() {
  await runFaceComparison({ testOnly: false });
}

async function testFaceMatch() {
  await runFaceComparison({ testOnly: true });
}

function resetFaceLoginProfile() {
  const empty = byId('faceLoginProfileEmpty');
  const content = byId('faceLoginProfileContent');
  const image = byId('faceLoginProfileImage');
  const overlay = byId('faceLoginSuccessOverlay');
  const successImage = byId('faceLoginSuccessImage');
  const countdown = byId('faceLoginSuccessCountdown');
  clearTimeout(faceLoginRedirectTimer);
  clearInterval(faceLoginCountdownTimer);
  faceLoginRedirectTimer = null;
  faceLoginCountdownTimer = null;
  if (empty) empty.style.display = 'block';
  if (content) content.style.display = 'none';
  if (image) image.removeAttribute('src');
  if (overlay) overlay.style.display = 'none';
  if (successImage) successImage.removeAttribute('src');
  if (countdown) countdown.textContent = 'Entering portal in 5s...';
}

function showFaceLoginProfile(user, score) {
  const empty = byId('faceLoginProfileEmpty');
  const content = byId('faceLoginProfileContent');
  const image = byId('faceLoginProfileImage');
  const name = byId('faceLoginProfileName');
  const meta = byId('faceLoginProfileMeta');
  const details = byId('faceLoginProfileDetails');
  const note = byId('faceLoginSuccessNote');
  const successImage = byId('faceLoginSuccessImage');
  const successName = byId('faceLoginSuccessName');
  const successMeta = byId('faceLoginSuccessMeta');
  const successDetails = byId('faceLoginSuccessDetails');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'grid';
  const displayName = [user.first_name, user.father_name].filter(Boolean).join(' ') || user.username || 'EPSA Student';
  const metaText = [user.university, user.academic_year].filter(Boolean).join(' • ') || 'Verified EPSA student';
  const detailText = [user.student_id, user.program_type].filter(Boolean).join(' • ') || 'Secure portal access approved';
  if (name) {
    name.textContent = displayName;
  }
  if (meta) {
    meta.textContent = metaText;
  }
  if (details) {
    details.textContent = detailText;
  }
  if (note) {
    note.textContent = `Verified with score ${score}. Redirecting to your portal...`;
  }
  if (successName) successName.textContent = displayName;
  if (successMeta) successMeta.textContent = metaText;
  if (successDetails) successDetails.textContent = detailText;
  const src = API.resolveUploadUrl('profiles', user.profile_photo);
  if (src) {
    if (image) image.src = src;
    if (successImage) successImage.src = src;
  }
}

function showFaceLoginSuccessOverlay(user) {
  const overlay = byId('faceLoginSuccessOverlay');
  const countdown = byId('faceLoginSuccessCountdown');
  if (!overlay) return;
  let remaining = 5;
  overlay.style.display = 'flex';
  if (countdown) countdown.textContent = `Entering portal in ${remaining}s...`;
  clearInterval(faceLoginCountdownTimer);
  faceLoginCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (countdown) countdown.textContent = `Entering portal in ${Math.max(remaining, 0)}s...`;
    if (remaining <= 0) {
      clearInterval(faceLoginCountdownTimer);
      faceLoginCountdownTimer = null;
    }
  }, 1000);
  clearTimeout(faceLoginRedirectTimer);
  faceLoginRedirectTimer = setTimeout(() => {
    const role = user?.role;
    if (typeof EPSA_TG !== 'undefined' && EPSA_TG.isTelegramWebApp()) {
      EPSA_TG.showLinkingModal();
    } else if (role === 'admin' || role === 'super_admin') {
      window.location.href = 'admin/dashboard.html';
    } else if (role === 'teacher') {
      window.location.href = 'teacher.html';
    } else {
      window.location.href = 'dashboard.html';
    }
  }, 5000);
}

function getFaceLoginSampleSet(liveCapture) {
  const samples = [];
  const seen = new Set();
  [liveCapture, faceVerification.bestCapture, ...faceVerification.angleSamples.map((sample) => sample.image)]
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      samples.push(item);
    });
  return samples.slice(0, 6);
}

async function runFaceLogin({ autoTriggered = false } = {}) {
  const modal = byId('faceLoginModal');
  if (!modal?.classList.contains('active')) return;
  if (faceVerification.busyAction) return;

  // In login mode we do NOT require the guided scan tasks — the backend
  // matches live capture against ALL enrolled faces to identify the person.
  // We just need a clear single-face frame.
  let analysis = faceVerification.latestAnalysis;
  if (!analysis || !analysis.hasFace) {
    // Take one fresh frame if no recent analysis
    analysis = await analyzeCurrentFrame();
  }

  if (!analysis || !analysis.hasFace || analysis.faceCount !== 1) {
    updateFaceStatus('Could not get a clear face frame. Please center your face and try again.', 'error');
    showToast('Position your face clearly in the camera.', 'error');
    // Restart the scan loop
    if (isFaceLoginMode()) {
      faceVerification.loginStableFrames = 0;
      await startInstantFaceLoginScan();
    }
    return;
  }

  // Build the best capture we have
  const canvas = byId('faceVerifyCanvas');
  let liveCapture = faceVerification.bestCapture || '';
  if (!liveCapture && canvas) {
    const box = analysis.box || createAnalysisBox(canvas.width, canvas.height, null);
    liveCapture = buildVerificationCapture(canvas, box, analysis.faceBrightness || 42);
  }
  if (!liveCapture) {
    showToast('No face capture ready. Move closer to the camera and retry.', 'error');
    return;
  }

  faceVerification.capture = liveCapture;
  faceVerification.busyAction = 'verify';
  setFaceStageLoading(true, autoTriggered
    ? 'Matching your face against enrolled EPSA profiles…'
    : 'Verifying your identity…');
  updateFaceStatus(
    'Checking your face against all enrolled EPSA profiles. This takes just a moment…',
    'info'
  );
  updateFaceActionButtons();

  try {
    const samples = getFaceLoginSampleSet(liveCapture);
    const result = await API.faceLogin(liveCapture, samples);
    faceVerification.verified = true;
    faceVerification.score = result.score;
    faceVerification.threshold = result.threshold;
    stopFaceAnalysis();
    showFaceLoginProfile(result.user, result.score);
    updateFaceStatus(
      `Identity confirmed. Match score: <strong>${result.score}</strong>. Preparing your portal…`,
      'success'
    );
    showToast('Face sign-in successful!', 'success');
    showFaceLoginSuccessOverlay(result.user);
  } catch (err) {
    faceVerification.verified = false;
    faceVerification.busyAction = '';
    faceVerification.loginStableFrames = 0;
    setFaceStageLoading(false);
    const errMsg = err.message || 'Face sign-in failed.';
    updateFaceStatus(errMsg + ' Please reposition your face and the system will retry automatically.', 'error');
    showToast(errMsg, 'error');
    // Wait a moment then restart the scan loop so user doesn't have to press anything
    setTimeout(() => {
      if (byId('faceLoginModal')?.classList.contains('active') && !faceVerification.busyAction) {
        startInstantFaceLoginScan();
      }
    }, 2500);
    updateFaceActionButtons();
    return;
  } finally {
    if (faceVerification.busyAction === 'verify') {
      faceVerification.busyAction = '';
      setFaceStageLoading(false);
      updateFaceActionButtons();
    }
  }
}

async function openFaceLoginModal() {
  const modal = byId('faceLoginModal');
  if (!modal) return;
  activeFaceMode = 'login';
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  resetFaceLoginProfile();
  resetFaceVerification(false);
  renderFaceChallenges();
  updateFacePrompt('Center your face inside the guide. EPSA will identify you automatically.');
  updateFaceMetricDisplay();
  updateFaceHoldDisplay();
  await startFaceCamera();
  setTimeout(() => {
    if (byId('faceLoginModal')?.classList.contains('active') && !faceVerification.smartScanActive && !faceVerification.busyAction) {
      startInstantFaceLoginScan();
    }
  }, 220);
}

function closeFaceLoginModal() {
  const modal = byId('faceLoginModal');
  if (!modal) return;
  modal.classList.remove('active');
  document.body.style.overflow = '';
  clearTimeout(faceLoginRedirectTimer);
  clearInterval(faceLoginCountdownTimer);
  faceLoginRedirectTimer = null;
  faceLoginCountdownTimer = null;
  stopFaceCamera(true);
  resetFaceLoginProfile();
  activeFaceMode = 'registration';
}

function resetFaceVerification(keepCamera = false) {
  stopFaceAnalysis();
  const existingStream = keepCamera ? faceVerification.stream : null;
  const profilePhotoDataUrl = faceVerification.profilePhotoDataUrl;
  const profilePhotoFaceReady = faceVerification.profilePhotoFaceReady;
  const profilePhotoAnalyzing = faceVerification.profilePhotoAnalyzing;
  resetFaceState();
  faceVerification.stream = existingStream;
  faceVerification.profilePhotoDataUrl = profilePhotoDataUrl;
  faceVerification.profilePhotoFaceReady = profilePhotoFaceReady;
  faceVerification.profilePhotoAnalyzing = profilePhotoAnalyzing;
  renderFaceChallenges();
  updateFacePrompt();
  updateFaceMetricDisplay();
  updateFaceHoldDisplay();
  renderAngleGallery();
  updateGuideFrame(null);
  renderFaceLandmarkOverlay(null);
  if (byId('face-err')) byId('face-err').style.display = 'none';
  updateFaceFocusHint('Camera ready. Your face guide will lock here.');
  updateFaceStatus(
    isFaceLoginMode()
      ? 'Center your face in the guide. EPSA will recognize you automatically.'
      : 'Live face check is optional. Look into the camera and tap verify if you want to use it.',
    'info'
  );
  updateReferencePreview(profilePhotoDataUrl);
  if (profilePhotoFaceReady) {
    updateReferenceMeta('Reference face locked and ready', 'success');
  }
  updateFaceActionButtons();
}

function populateReview() {
  const rows = [
    ['Full Name', `${val('firstName')} ${val('fatherName')} ${val('grandfatherName')}`],
    ['Email', val('emailAddress')],
    ['Phone', val('phoneNumber')],
    ['University', val('university') === 'other' ? val('otherUniversity') : val('university')],
    ['Program', val('programType')],
    ['Academic Year', val('academicYear')],
    ['Face Verification', faceVerification.verified ? `Completed (${faceVerification.score})` : 'Optional - skipped'],
  ];
  const container = byId('reviewSummary');
  if (!container) return;
  container.innerHTML = rows.map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;padding:6px 0;border-bottom:1px solid var(--light-200);gap:16px;">
      <span style="color:var(--text-muted);font-weight:500;">${label}</span>
      <span style="color:var(--text-primary);font-weight:600;text-align:right;">${value || '-'}</span>
    </div>
  `).join('');
  if (byId('emailDisplay')) byId('emailDisplay').textContent = val('emailAddress');
}
window.populateReview = populateReview;

async function sendOTP() {
  const email = val('emailAddress');
  if (!email) return;
  const nextBtn = byId('nextBtn');
  try {
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Sending code...';
    }
    const response = await API.sendOTP(email);
    if (response && response.otp) {
      const digits = String(response.otp).replace(/\D/g, '').slice(0, 6).split('');
      const inputs = [...document.querySelectorAll('.otp-input')];
      inputs.forEach((input, index) => {
        input.value = digits[index] || '';
      });
      if (byId('otp-err')) byId('otp-err').style.display = 'none';
      showToast(`Verification code: ${response.otp}`, 'gold');
    } else {
      showToast(`Verification code sent to ${email}`, 'gold');
    }
    startOTPTimer(60);
  } catch (err) {
    showToast(err.message || 'Failed to send verification code.', 'error');
  } finally {
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Submit Application';
    }
  }
}
window.sendOTP = sendOTP;

function startOTPTimer(seconds) {
  clearInterval(otpTimer);
  const timerEl = byId('otpTimerCount');
  const timerBlock = byId('otpTimerBlock');
  const resendBlock = byId('resendBlock');
  let remaining = seconds;

  if (timerBlock) timerBlock.style.display = 'block';
  if (resendBlock) resendBlock.style.display = 'none';
  if (timerEl) timerEl.textContent = String(remaining);

  otpTimer = setInterval(() => {
    remaining -= 1;
    if (timerEl) timerEl.textContent = String(Math.max(remaining, 0));
    if (remaining <= 0) {
      clearInterval(otpTimer);
      if (timerBlock) timerBlock.style.display = 'none';
      if (resendBlock) resendBlock.style.display = 'block';
    }
  }, 1000);
}

async function submitRegistration() {
  const nextBtn = byId('nextBtn');
  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Submitting...';
  }

  try {
    const formData = new FormData();
    formData.append('first_name', val('firstName'));
    formData.append('father_name', val('fatherName'));
    formData.append('grandfather_name', val('grandfatherName'));
    formData.append('phone', val('phoneNumber'));
    formData.append('email', val('emailAddress'));
    formData.append('password', byId('password1')?.value || '');
    formData.append('university', val('university') === 'other' ? val('otherUniversity') : val('university'));
    formData.append('program_type', val('programType'));
    formData.append('academic_year', val('academicYear'));
    formData.append('field_of_study', val('fieldOfStudy'));
    formData.append('graduation_year', val('graduationYear'));
    if (faceVerification.capture) {
      formData.append('live_capture', faceVerification.capture);
    }
    if (faceVerification.angleSamples.length) {
      formData.append('angle_samples', JSON.stringify(faceVerification.angleSamples.map((sample) => sample.image)));
    }

    const photoFile = byId('profilePhotoInput')?.files?.[0];
    const slipFile = byId('regSlipInput')?.files?.[0];
    if (photoFile) formData.append('profile_photo', photoFile);
    if (slipFile) formData.append('reg_slip', slipFile);

    await API.register(formData);
    document.querySelectorAll('.reg-step-body').forEach((body) => body.classList.remove('active'));
    byId('stepPending')?.classList.add('active');
    if (byId('regNav')) byId('regNav').style.display = 'none';
    if (byId('stepIndicator')) byId('stepIndicator').style.display = 'none';
    stopFaceCamera();
    showToast('Application submitted successfully. You can sign in while admin review is pending.', 'success');
  } catch (err) {
    showToast(err.message || 'Registration failed.', 'error');
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Submit Application';
    }
  }
}
window.submitRegistration = submitRegistration;

function wireOtpInputs() {
  const inputs = document.querySelectorAll('.otp-input');
  inputs.forEach((input, index) => {
    input.addEventListener('input', (event) => {
      const value = event.target.value.replace(/\D/g, '');
      event.target.value = value.slice(0, 1);
      if (value && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && index > 0) {
        inputs[index - 1].focus();
      }
    });
    input.addEventListener('paste', (event) => {
      event.preventDefault();
      const digits = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, inputs.length);
      digits.split('').forEach((digit, digitIndex) => {
        if (inputs[digitIndex]) inputs[digitIndex].value = digit;
      });
      const focusIndex = Math.min(digits.length, inputs.length - 1);
      inputs[focusIndex]?.focus();
    });
  });
}

function setupRegistrationUI() {
  const uniSelect = byId('university');
  uniSelect?.addEventListener('change', () => {
    const visible = uniSelect.value === 'other';
    if (byId('otherUniversityGroup')) byId('otherUniversityGroup').style.display = visible ? 'block' : 'none';
  });

  const photoInput = byId('profilePhotoInput');
  photoInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (readerEvent) => {
      const sourceDataUrl = readerEvent.target.result;
      const image = byId('photoPreview');
      const placeholder = byId('photoPlaceholder');
      if (image) {
        image.src = sourceDataUrl;
        image.classList.add('visible');
      }
      if (placeholder) placeholder.style.display = 'none';
      if (byId('photo-err')) byId('photo-err').style.display = 'none';
      faceVerification.profilePhotoDataUrl = sourceDataUrl;
      updateReferencePreview(sourceDataUrl);
      await analyzeUploadedProfilePhoto(file, sourceDataUrl);
    };
    reader.readAsDataURL(file);
    resetFaceVerification(true);
  });

  const slipInput = byId('regSlipInput');
  slipInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (byId('slipPreview')) byId('slipPreview').classList.add('visible');
    if (byId('slipName')) byId('slipName').textContent = file.name;
    if (byId('slip-err')) byId('slip-err').style.display = 'none';
  });

  byId('slipRemove')?.addEventListener('click', () => {
    if (byId('regSlipInput')) byId('regSlipInput').value = '';
    byId('slipPreview')?.classList.remove('visible');
  });

  const slipZone = byId('slipZone');
  slipZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    slipZone.classList.add('dragover');
  });
  slipZone?.addEventListener('dragleave', () => slipZone.classList.remove('dragover'));
  slipZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    slipZone.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (!file || !byId('regSlipInput')) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    byId('regSlipInput').files = transfer.files;
    byId('regSlipInput').dispatchEvent(new Event('change'));
  });

  if (photoInput && byId('step4')) {
    byId('startSmartScanBtn')?.addEventListener('click', startSmartFaceScan);
    byId('captureFaceBtn')?.addEventListener('click', captureAndVerifyFace);
    byId('testFaceBtn')?.addEventListener('click', testFaceMatch);
    byId('retakeFaceBtn')?.addEventListener('click', async () => {
      resetFaceVerification(true);
      renderFaceChallenges();
      updateFacePrompt();
      await startFaceCamera();
    });
    byId('restartFaceCameraBtn')?.addEventListener('click', startFaceCamera);
  }
}

function setupLoginFaceUI() {
  const openBtn = byId('openFaceLoginBtn');
  const modal = byId('faceLoginModal');
  if (!openBtn || !modal) return;

  openBtn.addEventListener('click', openFaceLoginModal);
  byId('closeFaceLoginBtn')?.addEventListener('click', closeFaceLoginModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeFaceLoginModal();
  });
  byId('startSmartScanBtn')?.addEventListener('click', startInstantFaceLoginScan);
  byId('captureFaceBtn')?.addEventListener('click', () => runFaceLogin({ autoTriggered: false }));
  byId('retakeFaceBtn')?.addEventListener('click', async () => {
    resetFaceVerification(true);
    resetFaceLoginProfile();
    await startInstantFaceLoginScan();
  });
  byId('restartFaceCameraBtn')?.addEventListener('click', async () => {
    await startFaceCamera();
    await startInstantFaceLoginScan();
  });
}

function openForgotModal() {
  byId('forgotModal')?.classList.add('active');
}
window.openForgotModal = openForgotModal;

function closeForgotModal() {
  byId('forgotModal')?.classList.remove('active');
}
window.closeForgotModal = closeForgotModal;

async function submitForgotPassword() {
  const email = (byId('reset-email')?.value || '').trim();
  if (!email) {
    showToast('Enter your registered email address first.', 'error');
    return;
  }
  try {
    await API.forgotPassword(email);
    closeForgotModal();
    showToast('If that email exists in EPSA, a reset link has been sent.', 'gold');
  } catch (err) {
    showToast(err.message || 'Unable to start password reset.', 'error');
  }
}
window.submitForgotPassword = submitForgotPassword;

function openResetModal(token = '') {
  if (byId('reset-token')) byId('reset-token').value = token;
  byId('resetModal')?.classList.add('active');
}
window.openResetModal = openResetModal;

function closeResetModal() {
  byId('resetModal')?.classList.remove('active');
}
window.closeResetModal = closeResetModal;

async function submitResetPassword() {
  const token = (byId('reset-token')?.value || '').trim();
  const password = byId('new-reset-password')?.value || '';
  const confirm = byId('confirm-reset-password')?.value || '';
  if (!token) {
    showToast('Reset token is missing or expired.', 'error');
    return;
  }
  if (!passwordStrong(password)) {
    showToast('Password must include uppercase, lowercase, number, and special character.', 'error');
    return;
  }
  if (password !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  try {
    await API.resetPassword(token, password);
    closeResetModal();
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', url.toString());
    showToast('Password updated. You can now sign in.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to reset password.', 'error');
  }
}
window.submitResetPassword = submitResetPassword;

function setupPasswordRecoveryUI() {
  byId('forgotPasswordLink')?.addEventListener('click', (event) => {
    event.preventDefault();
    openForgotModal();
  });
  byId('forgotModal')?.addEventListener('click', (event) => {
    if (event.target === byId('forgotModal')) closeForgotModal();
  });
  byId('resetModal')?.addEventListener('click', (event) => {
    if (event.target === byId('resetModal')) closeResetModal();
  });
  const resetToken = new URLSearchParams(window.location.search).get('reset_token');
  if (resetToken) openResetModal(resetToken);
}

function setupTelegramMiniAppGuide() {
  const guide = byId('telegramMiniAppGuide');
  if (!guide) return;
  const inTelegram = typeof EPSA_TG !== 'undefined' && typeof EPSA_TG.isTelegramWebApp === 'function' && EPSA_TG.isTelegramWebApp();
  guide.style.display = inTelegram ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  wireOtpInputs();
  setupRegistrationUI();
  setupLoginFaceUI();
  setupPasswordRecoveryUI();
  setupTelegramMiniAppGuide();
  renderStep(currentStep);
});

window.addEventListener('beforeunload', stopFaceCamera);
