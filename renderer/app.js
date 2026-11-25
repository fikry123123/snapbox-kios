// ==================== APPLICATION STATE ====================
const TOTAL_SHOTS_REQUIRED = 10;
const MAX_RETAKES_PER_SHOT = 2;
const SESSION_DURATION_MS = 25 * 60 * 1000;

let sessionTimerDeadline = null;
let sessionTimerInterval = null;
let stripRenderVersion = 0;

function startSessionTimer() {
  if (sessionTimerDeadline !== null) return;
  sessionTimerDeadline = Date.now() + SESSION_DURATION_MS;
  updateSessionTimer();
  sessionTimerInterval = setInterval(updateSessionTimer, 10);
}

function stopSessionTimer() {
  if (sessionTimerInterval !== null) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
  sessionTimerDeadline = null;
  updateSessionTimer();
}

function updateSessionTimer() {
  const remaining = sessionTimerDeadline === null
    ? SESSION_DURATION_MS
    : Math.max(0, sessionTimerDeadline - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const milliseconds = remaining % 1000;

  document.getElementById('global-timer').textContent =
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('session-timer-minutes').textContent = String(minutes).padStart(2, '0');
  document.getElementById('session-timer-seconds').textContent = String(seconds).padStart(2, '0');
  document.getElementById('session-timer-milliseconds').textContent = String(milliseconds).padStart(3, '0');

  if (remaining === 0 && sessionTimerInterval !== null) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

function toggleSessionTimerDetails() {
  const details = document.getElementById('session-timer-details');
  const button = document.getElementById('session-timer-button');
  const isOpening = details.classList.contains('hidden');
  details.classList.toggle('hidden', !isOpening);
  button.setAttribute('aria-expanded', isOpening);
  if (isOpening) updateSessionTimer();
}

const appState = {
  currentStep: 0,
  audioEnabled: true,
  packageKey: 'classic',
  packageName: 'Classic 2-Strip',
  basePrice: 35000,
  baseCopies: 2,
  extraCopies: 0,
  extraCopyPrice: 10000,
  voucherCode: '',
  discountAmount: 0,
  template: {
    id: 'classic-black',
    name: 'Classic Black (4 Pose)',
    slots: 4,
    bg: '#070235',
    text: '#ffffff',
    accent: '#62fae3',
  },
  gridLayout: 'two-rows',
  gridSelectionMade: false,
  templateSelected: false,
  capturedPhotos: [],
  capturedMotionFrames: [],
  currentShotMotionFrames: [],
  motionCaptureCanvas: null,
  retakesUsedForCurrent: 0,
  inspectedPhotoIndex: 0,
  selectedIndices: [0, 1, 2, 3],
  activeStripSlot: 0,
  selectionHint: '',
  activeFilter: 'glow',
  finalStripDataUrl: '',
  zipBlob: null,
  animatedStripPreviewUrl: null,
  deliveryReady: false,
  printSucceeded: null,
  printError: null,
  printErrorMessage: null,
  availablePrinters: [],
  emailSending: false,
  webcamStream: null,
  countdownTimer: null,
  motionCaptureTimer: null,
  reviewAutoTimer: null,
};

// ==================== NAVIGATION & STEP CONTROLLER ====================
function goToStep(step) {
  if (step === 5 && appState.capturedPhotos.length < TOTAL_SHOTS_REQUIRED) return;
  if (step === 7 && !appState.deliveryReady) return;
  appState.currentStep = step;

  document.querySelectorAll('.step-view').forEach((el) => el.classList.add('hidden'));
  const target = document.getElementById(`step-${step}`);
  if (target) target.classList.remove('hidden');
  const header = document.getElementById('main-header');
  const footer = document.getElementById('main-footer');
  if (step === 0) {
    header.classList.add('hidden');
    footer.classList.add('hidden');
    stopCameraAndTimers();
  } else {
    header.classList.remove('hidden');
    footer.classList.remove('hidden');
  }

  if (step === 1) recalculateOrder();
  if (step === 2) syncQRISScreen();
  if (step === 4) initAutoPhotoSession();
  else stopCameraAndTimers();
  if (step === 5) initSelectionScreen();
  if (step === 6) initDeliveryScreen();
}

// ==================== AUDIO BEEP ====================
function toggleAudioGuide() {
  appState.audioEnabled = !appState.audioEnabled;
  document.getElementById('audio-icon').textContent = appState.audioEnabled ? 'volume_up' : 'volume_off';
  document.getElementById('audio-text').textContent = appState.audioEnabled
    ? 'Panduan Suara ON'
    : 'Panduan Suara OFF';
}

function playBeep(freq = 880, duration = 0.12) {
  if (!appState.audioEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

// ==================== STEP 1: PACKAGE & VOUCHER ====================
function formatRupiah(num) {
  return 'Rp ' + num.toLocaleString('id-ID');
}

function selectPackage(el) {
  const packageChanged = appState.packageKey !== el.dataset.package;
  document.querySelectorAll('.package-card').forEach((c) => {
    c.classList.remove('ring-4', 'ring-secondary-container');
    c.querySelector('.check-icon').className =
      'check-icon w-6 h-6 rounded-full bg-surface-container-high flex items-center justify-center text-outline-variant';
  });

  el.classList.add('ring-4', 'ring-secondary-container');
  el.querySelector('.check-icon').className =
    'check-icon w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-on-secondary';

  appState.packageKey = el.dataset.package;
  appState.packageName = el.dataset.name;
  appState.basePrice = parseInt(el.dataset.price, 10);
  appState.baseCopies = parseInt(el.dataset.baseCopies, 10);
  if (packageChanged) {
    appState.gridLayout = 'two-rows';
    appState.gridSelectionMade = false;
    appState.templateSelected = false;
  }
  updateTemplateAvailability();
  recalculateOrder();
}

function updateQty(delta) {
  const next = appState.extraCopies + delta;
  if (next >= 0 && next <= 10) {
    appState.extraCopies = next;
    document.getElementById('qty-display').textContent = next;
    recalculateOrder();
  }
}

function voucherKeyPress(char) {
  if (appState.voucherCode.length < 10) {
    appState.voucherCode += char.toUpperCase();
    document.getElementById('voucher-input').textContent = appState.voucherCode;
  }
}

function voucherBackspace() {
  appState.voucherCode = appState.voucherCode.slice(0, -1);
  document.getElementById('voucher-input').textContent = appState.voucherCode;
}

function clearVoucher() {
  appState.voucherCode = '';
  document.getElementById('voucher-input').textContent = '';
}

function quickApplyVoucher(code) {
  appState.voucherCode = code;
  document.getElementById('voucher-input').textContent = code;
  applyVoucher();
}

function applyVoucher() {
  const code = appState.voucherCode.trim().toUpperCase();
  const badge = document.getElementById('voucher-badge');
  const row = document.getElementById('summary-discount-row');
  const val = document.getElementById('summary-discount-val');

  if (code === 'SNAP10') {
    appState.discountAmount = 10000;
    badge.textContent = 'HEMAT 10K';
    badge.classList.remove('hidden');
    row.classList.remove('hidden');
    row.classList.add('flex');
    val.textContent = '- Rp 10.000';
  } else if (code === 'WEEKEND5') {
    appState.discountAmount = 5000;
    badge.textContent = 'HEMAT 5K';
    badge.classList.remove('hidden');
    row.classList.remove('hidden');
    row.classList.add('flex');
    val.textContent = '- Rp 5.000';
  } else {
    appState.discountAmount = 0;
    badge.classList.add('hidden');
    row.classList.add('hidden');
  }
  recalculateOrder();
}

function getFinalTotal() {
  const extra = appState.extraCopies * appState.extraCopyPrice;
  return Math.max(0, appState.basePrice + extra - appState.discountAmount);
}

function recalculateOrder() {
  const extra = appState.extraCopies * appState.extraCopyPrice;
  const total = getFinalTotal();
  document.getElementById('summary-pkg-name').textContent = 'Paket ' + appState.packageName;
  document.getElementById('summary-pkg-price').textContent = formatRupiah(appState.basePrice);
  document.getElementById('summary-qty').textContent = appState.extraCopies;
  document.getElementById('summary-extra-price').textContent = formatRupiah(extra);
  document.getElementById('total-price-display').textContent = formatRupiah(total);
}

// ==================== STEP 2: QRIS ====================
function syncQRISScreen() {
  const totalCopies = appState.baseCopies + appState.extraCopies;
  document.getElementById('qris-pkg-title').textContent = appState.packageName;
  document.getElementById('qris-copies-info').textContent = `Total ${totalCopies} Lembar Cetak Fisik + Foto Digital`;
  document.getElementById('qris-amount-display').textContent = formatRupiah(getFinalTotal());
}

function simulateQRISSuccess() {
  playBeep(1046, 0.2);
  startSessionTimer();
  goToStep(3);
}

// ==================== STEP 3: TEMPLATE SELECTION ====================
function selectTemplate(el) {
  if (el.classList.contains('hidden')) return;
  appState.template = templateFromElement(el);
  appState.templateSelected = true;
  renderTemplatePreview();
}

function getGridShape(slots = appState.template.slots) {
  if (appState.gridLayout === 'horizontal') {
    return { rows: 1, columns: slots, label: '1 baris mendatar', detail: `${slots} foto dalam satu baris` };
  }
  if (appState.gridLayout === 'vertical') {
    return {
      rows: slots,
      columns: 1,
      label: '1 kolom menjalar ke bawah',
      detail: `${slots} foto dalam satu kolom`,
    };
  }
  const columns = Math.ceil(slots / 2);
  return { rows: 2, columns, label: '2 baris', detail: `${columns} foto per baris` };
}

function selectGridLayout(layout) {
  if (!['horizontal', 'vertical', 'two-rows'].includes(layout)) return;
  appState.gridLayout = layout;
  appState.gridSelectionMade = true;
  renderGridChoice();
}

function renderGridChoice() {
  const slots = appState.template.slots;
  const columnsForTwoRows = Math.ceil(slots / 2);
  const previews = [
    {
      layout: 'horizontal',
      rows: 1,
      columns: slots,
      label: `Contoh ${slots} foto dalam satu baris mendatar`,
    },
    {
      layout: 'vertical',
      rows: slots,
      columns: 1,
      label: `Contoh ${slots} foto memanjang dari atas ke bawah`,
    },
    {
      layout: 'two-rows',
      rows: 2,
      columns: columnsForTwoRows,
      label: `Contoh ${slots} foto, ${columnsForTwoRows} di setiap baris`,
    },
  ];

  ['horizontal', 'vertical', 'two-rows'].forEach((layout) => {
    const option = document.getElementById(`grid-option-${layout}`);
    const selected = appState.gridSelectionMade && layout === appState.gridLayout;
    option.setAttribute('aria-pressed', selected);
    option.className = `text-left p-5 rounded-2xl bg-surface-container-lowest shadow-[4px_4px_0px_#1E1B4B] border-2 transition-all ${
      selected ? 'border-secondary-container ring-4 ring-secondary-container' : 'border-transparent'
    }`;
  });
  previews.forEach(({ layout, rows, columns, label }) => {
    const preview = document.getElementById(`grid-preview-${layout}`);
    preview.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    preview.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    preview.innerHTML = Array.from({ length: slots }, (_, index) =>
      `<span class="rounded-lg bg-primary/${index % 2 ? '30' : '20'} border-2 border-primary/20"></span>`,
    ).join('');
    document.getElementById(`grid-preview-label-${layout}`).textContent = label;
  });
  document.getElementById('continue-to-template-button').disabled = !appState.gridSelectionMade;
}

function continueToTemplateSelection() {
  if (!appState.gridSelectionMade) return;
  updateTemplateAvailability();
  document.getElementById('grid-choice-view').classList.add('hidden');
  document.getElementById('template-choice-view').classList.remove('hidden');
}

function backToGridSelection() {
  document.getElementById('template-choice-view').classList.add('hidden');
  document.getElementById('grid-choice-view').classList.remove('hidden');
  renderGridChoice();
}

function resetTemplateSetup() {
  appState.gridSelectionMade = false;
  appState.templateSelected = false;
  appState.gridLayout = 'two-rows';
  document.getElementById('grid-choice-view').classList.remove('hidden');
  document.getElementById('template-choice-view').classList.add('hidden');
  updateTemplateAvailability();
}

function getCompatibleTemplateIds() {
  if (appState.packageKey === 'wide') return ['cyber-y2k'];
  if (appState.packageKey === 'classic') return ['classic-black', 'blossom-pink', 'cloud-white'];
  return ['classic-black', 'blossom-pink', 'cyber-y2k', 'cloud-white'];
}

function templateFromElement(el) {
  return {
    id: el.dataset.id,
    name: el.dataset.name,
    slots: parseInt(el.dataset.slots, 10) || 4,
    bg: el.dataset.bg,
    text: el.dataset.text,
    accent: el.dataset.accent,
  };
}

function updateTemplateAvailability() {
  const allowedIds = getCompatibleTemplateIds();
  const cards = [...document.querySelectorAll('.template-card')];
  cards.forEach((card) => {
    card.classList.toggle('hidden', !allowedIds.includes(card.dataset.id));
  });

  if (!allowedIds.includes(appState.template.id)) {
    const firstAllowedTemplate = cards.find((card) => allowedIds.includes(card.dataset.id));
    appState.template = templateFromElement(firstAllowedTemplate);
    appState.templateSelected = false;
  }

  document.getElementById('template-package-summary').textContent =
    `${appState.packageName} • ${allowedIds.length} template sesuai paket`;
  renderTemplatePreview();
  renderGridChoice();
}

function renderTemplatePreview() {
  const { slots, name, bg, text } = appState.template;
  const { rows, columns, label, detail } = getGridShape(slots);
  const mockup = document.getElementById('tpl-mockup-box');
  const slotsContainer = document.getElementById('tpl-mockup-slots');

  document.getElementById('tpl-preview-badge').textContent = appState.templateSelected
    ? `${name} • ${label}`
    : `Contoh grid • ${label}`;
  document.getElementById('tpl-selected-grid-label').textContent = `${appState.packageName} • ${detail}`;
  mockup.className = `rounded-lg p-2.5 flex flex-col justify-between shadow-[4px_4px_0px_#1E1B4B] transition-colors ${
    appState.gridLayout === 'horizontal'
      ? 'w-full max-w-sm aspect-[3/1]'
      : appState.gridLayout === 'vertical'
      ? appState.packageKey === 'classic'
        ? 'w-32 h-80'
        : 'w-52 h-80'
      : 'w-48 h-72'
  }`;
  mockup.style.backgroundColor = appState.templateSelected ? bg : '#e3dfff';
  mockup.style.color = appState.templateSelected ? text : '#181445';
  slotsContainer.className = 'grid flex-1 my-2 gap-1';
  slotsContainer.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  slotsContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  slotsContainer.innerHTML = Array.from({ length: slots })
    .map(
      (_, i) =>
        `<div class="bg-white/20 rounded-sm flex items-center justify-center min-w-0 text-[9px]">#${i + 1}</div>`,
    )
    .join('');

  document.querySelectorAll('.template-card').forEach((card) => {
    const selected = appState.templateSelected && card.dataset.id === appState.template.id;
    card.classList.toggle('ring-4', selected);
    card.classList.toggle('ring-secondary-container', selected);
  });
  document.getElementById('btn-start-photo-session').disabled = !appState.templateSelected;
}

function readyAndStartPhotoSession() {
  if (!appState.gridSelectionMade || !appState.templateSelected) return;
  appState.capturedPhotos = [];
  appState.capturedMotionFrames = [];
  appState.currentShotMotionFrames = [];
  appState.retakesUsedForCurrent = 0;
  goToStep(4);
}

// ==================== STEP 4: FULL-CAMERA AUTO 5s COUNTDOWN + 10 SHOTS + RETAKE 2X ====================
async function initAutoPhotoSession() {
  const video = document.getElementById('webcam-video');
  const statusText = document.getElementById('camera-status-text');

  try {
    appState.webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = appState.webcamStream;
    statusText.textContent = 'Kamera HD Aktif • Hitung mundur otomatis berjalan';
  } catch (err) {
    statusText.textContent = 'Mode Simulasi Kamera Aktif';
  }

  startCountdownForNextShot();
}

function stopCameraAndTimers() {
  if (appState.countdownTimer) {
    clearInterval(appState.countdownTimer);
    appState.countdownTimer = null;
  }
  stopMotionFrameCapture();
  if (appState.reviewAutoTimer) {
    clearInterval(appState.reviewAutoTimer);
    appState.reviewAutoTimer = null;
  }
  if (appState.webcamStream) {
    appState.webcamStream.getTracks().forEach((track) => track.stop());
    appState.webcamStream = null;
  }
}

function stopMotionFrameCapture() {
  if (appState.motionCaptureTimer) {
    clearInterval(appState.motionCaptureTimer);
    appState.motionCaptureTimer = null;
  }
}

function captureMotionFrame() {
  const video = document.getElementById('webcam-video');
  if (!video.srcObject || video.readyState < 2) return;

  if (!appState.motionCaptureCanvas) {
    appState.motionCaptureCanvas = document.createElement('canvas');
    appState.motionCaptureCanvas.width = 320;
    appState.motionCaptureCanvas.height = 240;
  }

  const canvas = appState.motionCaptureCanvas;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  appState.currentShotMotionFrames.push(canvas.toDataURL('image/jpeg', 0.78));
}

function startCountdownForNextShot() {
  if (appState.capturedPhotos.length >= TOTAL_SHOTS_REQUIRED) {
    goToStep(5);
    return;
  }

  document.getElementById('shot-review-overlay').classList.add('hidden');
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');

  const currentShotNum = appState.capturedPhotos.length + 1;
  appState.currentShotMotionFrames = [];
  stopMotionFrameCapture();
  document.getElementById('shot-progress-label').textContent = `Foto ke-${currentShotNum} dari ${TOTAL_SHOTS_REQUIRED}`;
  document.getElementById('retake-remaining-label').textContent = `${
    MAX_RETAKES_PER_SHOT - appState.retakesUsedForCurrent
  }x`;

  let count = 5;
  numEl.textContent = count;
  overlay.classList.remove('hidden');
  playBeep(660, 0.1);

  if (appState.countdownTimer) clearInterval(appState.countdownTimer);

  appState.countdownTimer = setInterval(() => {
    count--;
    if (count === 2) {
      captureMotionFrame();
      appState.motionCaptureTimer = setInterval(captureMotionFrame, 250);
    }
    if (count > 0) {
      numEl.textContent = count;
      playBeep(count <= 2 ? 880 : 660, 0.1);
    } else {
      clearInterval(appState.countdownTimer);
      captureMotionFrame();
      stopMotionFrameCapture();
      overlay.classList.add('hidden');
      capturePhotoAndShowReview();
    }
  }, 1000);
}

function triggerFlashEffect() {
  const flash = document.getElementById('flash-overlay');
  flash.style.opacity = '1';
  playBeep(1200, 0.15);
  setTimeout(() => {
    flash.style.opacity = '0';
  }, 150);
}

function capturePhotoAndShowReview() {
  triggerFlashEffect();
  const video = document.getElementById('webcam-video');
  const canvas = document.getElementById('capture-canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = 800;
  canvas.height = 600;

  if (video.srcObject && video.readyState >= 2) {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  } else {
    const colors = ['#ff5d73', '#3cddc7', '#c4c1fb', '#ffb2b7', '#62fae3', '#8683ba'];
    const idx = appState.capturedPhotos.length;
    ctx.fillStyle = colors[idx % colors.length];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#070235';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`POSE #${idx + 1} (Ulang: ${appState.retakesUsedForCurrent})`, canvas.width / 2, canvas.height / 2);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  appState.capturedPhotos.push(dataUrl);
  appState.capturedMotionFrames.push(appState.currentShotMotionFrames);
  appState.currentShotMotionFrames = [];

  showPostCaptureReview(dataUrl);
}

function showPostCaptureReview(photoDataUrl) {
  const shotIndex = appState.capturedPhotos.length;
  const remainingRetakes = MAX_RETAKES_PER_SHOT - appState.retakesUsedForCurrent;

  document.getElementById('review-shot-num').textContent = shotIndex;
  document.getElementById('review-shot-img').src = photoDataUrl;

  const retakeBtn = document.getElementById('btn-retake-shot');
  const retakeText = document.getElementById('btn-retake-text');

  if (remainingRetakes > 0) {
    retakeBtn.disabled = false;
    retakeText.textContent = `Ulangi Foto Ini (Sisa ${remainingRetakes}x)`;
  } else {
    retakeBtn.disabled = true;
    retakeText.textContent = 'Batas Ulang Habis (0x)';
  }

  document.getElementById('shot-review-overlay').classList.remove('hidden');

  let autoSec = 4;
  document.getElementById('review-auto-sec').textContent = autoSec;
  if (appState.reviewAutoTimer) clearInterval(appState.reviewAutoTimer);

  appState.reviewAutoTimer = setInterval(() => {
    autoSec--;
    document.getElementById('review-auto-sec').textContent = autoSec;
    if (autoSec <= 0) {
      clearInterval(appState.reviewAutoTimer);
      confirmAndProceedNextShot();
    }
  }, 1000);
}

function retakeCurrentPhoto() {
  if (appState.retakesUsedForCurrent >= MAX_RETAKES_PER_SHOT) return;
  if (appState.reviewAutoTimer) clearInterval(appState.reviewAutoTimer);

  appState.capturedPhotos.pop();
  appState.capturedMotionFrames.pop();
  appState.currentShotMotionFrames = [];
  appState.retakesUsedForCurrent++;

  startCountdownForNextShot();
}

function confirmAndProceedNextShot() {
  if (appState.reviewAutoTimer) clearInterval(appState.reviewAutoTimer);
  appState.retakesUsedForCurrent = 0;

  if (appState.capturedPhotos.length >= TOTAL_SHOTS_REQUIRED) {
    goToStep(5);
  } else {
    startCountdownForNextShot();
  }
}

// ==================== STEP 5: PILIH FOTO + DUAL PREVIEW (FOTO SATUAN & STRIP) ====================
function initSelectionScreen() {
  const requiredSlots = appState.template.slots;
  document.getElementById('required-slots-title').textContent = requiredSlots;
  appState.selectedIndices = Array.from({ length: requiredSlots }, () => null);
  appState.activeStripSlot = 0;
  appState.inspectedPhotoIndex = 0;
  appState.selectionHint = 'Klik foto untuk mengisi Slot #1. Slot berikutnya dipilih otomatis.';

  renderCandidateGrid();
  renderStripSlotSelector();
  updateSinglePhotoPreview();
  renderFinalStripCanvas();
}

function renderCandidateGrid() {
  const grid = document.getElementById('candidate-grid');
  grid.innerHTML = '';
  const requiredSlots = appState.template.slots;

  appState.capturedPhotos.forEach((src, idx) => {
    const selectedPos = appState.selectedIndices.indexOf(idx);
    const isSelected = selectedPos !== -1;
    const isInspected = appState.inspectedPhotoIndex === idx;

    const card = document.createElement('button');
    card.type = 'button';
    card.onclick = () => onCandidateCardClick(idx);
    card.setAttribute('aria-label', `Lihat foto ${idx + 1}${isSelected ? `, digunakan di slot ${selectedPos + 1}` : ''}`);
    card.setAttribute('aria-pressed', String(isInspected));
    card.className = `relative w-full h-full text-left rounded-lg overflow-hidden cursor-pointer shadow-sm transition-all ${
      isInspected
        ? 'ring-4 ring-primary scale-[1.02]'
        : isSelected
        ? 'ring-2 ring-secondary-container'
        : 'opacity-75 hover:opacity-100'
    }`;

    card.innerHTML = `
      <img src="${src}" class="w-full h-full object-cover filter-${appState.activeFilter}" />
      ${
        isSelected
          ? `<div class="absolute top-1 left-1 w-5 h-5 rounded-full bg-secondary-container text-white font-bold flex items-center justify-center text-[10px] shadow">${
              selectedPos + 1
            }</div>`
          : ''
      }
      <div class="absolute bottom-1 right-1 bg-primary/85 text-white text-[9px] font-mono px-1.5 py-0.2 rounded">#${
        idx + 1
      }</div>
    `;
    grid.appendChild(card);
  });

  const selectedCount = appState.selectedIndices.filter((photoIndex) => photoIndex !== null).length;
  document.getElementById('selection-counter').textContent = `${selectedCount}/${requiredSlots} Foto Dipilih`;
  document.getElementById('proceed-to-delivery-button').disabled = selectedCount !== requiredSlots;
}

function onCandidateCardClick(idx) {
  if (!appState.capturedPhotos[idx]) return;
  appState.inspectedPhotoIndex = idx;

  const destinationSlot = appState.activeStripSlot;
  const sourceSlot = appState.selectedIndices.indexOf(idx);
  if (destinationSlot === -1) {
    if (sourceSlot !== -1) {
      appState.activeStripSlot = sourceSlot;
      appState.selectionHint = `Foto #${idx + 1} sudah berada di Slot #${sourceSlot + 1}.`;
    } else {
      appState.selectionHint = 'Semua slot terisi. Pilih slot pada preview strip untuk mengganti foto.';
    }
  } else if (sourceSlot === destinationSlot) {
    appState.selectionHint = `Foto #${idx + 1} sudah berada di Slot #${destinationSlot + 1}.`;
  } else {
    const replacedPhotoIndex = appState.selectedIndices[destinationSlot];
    appState.selectedIndices[destinationSlot] = idx;
    if (sourceSlot !== -1) {
      appState.selectedIndices[sourceSlot] = replacedPhotoIndex;
      appState.selectionHint = `Foto ditukar antara Slot #${destinationSlot + 1} dan Slot #${sourceSlot + 1}.`;
    } else if (replacedPhotoIndex === null) {
      appState.selectionHint = `Foto #${idx + 1} ditambahkan ke Slot #${destinationSlot + 1}.`;
    } else {
      appState.selectionHint = `Foto #${idx + 1} menggantikan foto di Slot #${destinationSlot + 1}.`;
    }
    appState.activeStripSlot = appState.selectedIndices.findIndex((photoIndex) => photoIndex === null);
    if (appState.activeStripSlot === -1 && replacedPhotoIndex === null) {
      appState.selectionHint += ' Semua slot terisi; pilih slot untuk mengganti foto.';
    }
  }

  renderCandidateGrid();
  renderStripSlotSelector();
  updateSinglePhotoPreview();
  renderFinalStripCanvas();
}

function selectStripSlot(slotIndex) {
  if (slotIndex < 0 || slotIndex >= appState.selectedIndices.length) return;
  appState.activeStripSlot = slotIndex;
  const selectedPhotoIndex = appState.selectedIndices[slotIndex];
  if (selectedPhotoIndex !== null) {
    appState.inspectedPhotoIndex = selectedPhotoIndex;
  }
  appState.selectionHint = selectedPhotoIndex === null
    ? `Slot #${slotIndex + 1} kosong. Klik foto untuk mengisinya.`
    : `Slot #${slotIndex + 1} dipilih. Klik foto lain untuk mengganti atau menukar.`;
  renderCandidateGrid();
  renderStripSlotSelector();
  updateSinglePhotoPreview();
}

function renderStripSlotSelector() {
  const selector = document.getElementById('strip-slot-selector');
  const columnCount = appState.selectedIndices.length <= 4 ? appState.selectedIndices.length : 3;
  const hasEmptySlot = appState.selectedIndices.some((photoIndex) => photoIndex === null);
  selector.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  document.getElementById('strip-slot-selector-hint').textContent = hasEmptySlot
    ? 'Klik foto untuk mengisi slot kosong berikutnya.'
    : 'Pilih slot, lalu klik foto lain untuk mengganti atau menukar.';
  selector.innerHTML = '';

  appState.selectedIndices.forEach((photoIndex, slotIndex) => {
    const button = document.createElement('button');
    const isActive = slotIndex === appState.activeStripSlot;
    button.type = 'button';
    button.setAttribute('aria-pressed', String(isActive));
    button.setAttribute(
      'aria-label',
      photoIndex === null
        ? `Slot ${slotIndex + 1}, kosong`
        : `Slot ${slotIndex + 1}, foto ${photoIndex + 1}`,
    );
    button.className = `h-8 flex items-center justify-center whitespace-nowrap rounded-lg px-1 text-[10px] font-bold transition-colors ${
      isActive
        ? 'bg-primary text-on-primary ring-2 ring-secondary-container'
        : photoIndex === null
        ? 'border-2 border-dashed border-outline-variant bg-surface-container-low text-on-surface-variant'
        : 'bg-surface-container-high text-primary'
    }`;
    button.textContent = photoIndex === null
      ? `Slot ${slotIndex + 1} · kosong`
      : `Slot ${slotIndex + 1} · #${photoIndex + 1}`;
    button.onclick = () => selectStripSlot(slotIndex);
    selector.appendChild(button);
  });
}

function updateSinglePhotoPreview() {
  const idx = appState.inspectedPhotoIndex;
  const src = appState.capturedPhotos[idx];
  const selectedPos = appState.selectedIndices.indexOf(idx);
  const isSelected = selectedPos !== -1;

  document.getElementById('single-preview-number').textContent = idx + 1;
  const imgEl = document.getElementById('single-photo-preview-img');
  imgEl.src = src;
  imgEl.className = `w-full h-full object-contain filter-${appState.activeFilter}`;

  const badgeEl = document.getElementById('single-preview-badge');
  badgeEl.textContent = isSelected ? `Dipakai di Slot #${selectedPos + 1}` : 'Belum dipilih';
  badgeEl.className = isSelected
    ? 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-secondary-container text-white'
    : 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-surface-container-high text-on-surface-variant';

  const activeSlot = appState.activeStripSlot;
  document.getElementById('active-strip-slot-label').textContent = activeSlot === -1
    ? 'Semua slot sudah terisi'
    : `Slot tujuan #${activeSlot + 1} • ${appState.selectedIndices[activeSlot] === null ? 'kosong' : `Foto #${appState.selectedIndices[activeSlot] + 1}`}`;
  document.getElementById('selection-action-hint').textContent = appState.selectionHint;
}

function setGlobalFilter(filterName, btnEl) {
  appState.activeFilter = filterName;
  document.querySelectorAll('.filter-tab').forEach((b) => {
    b.className = 'filter-tab px-4 py-1.5 rounded-full text-xs font-bold text-on-surface-variant';
  });
  btnEl.className = 'filter-tab px-4 py-1.5 rounded-full text-xs font-bold bg-primary-container text-on-primary';

  renderCandidateGrid();
  updateSinglePhotoPreview();
  renderFinalStripCanvas();
}

function getCanvasFilterString(filterName) {
  switch (filterName) {
    case 'bw':
      return 'grayscale(100%) contrast(125%) brightness(95%)';
    case 'peach':
      return 'sepia(35%) hue-rotate(-15deg) saturate(125%) brightness(105%)';
    case 'vintage':
      return 'contrast(115%) sepia(20%) brightness(90%) saturate(85%)';
    default:
      return 'contrast(105%) brightness(105%) saturate(110%)';
  }
}

function getStripGridLayout() {
  const { rows, columns } = getGridShape();
  const landscape = appState.gridLayout === 'horizontal';
  const classicPackage = appState.packageKey === 'classic';
  const width = landscape ? 1800 : classicPackage ? 600 : 1200;
  const baseHeight = landscape ? (classicPackage ? 600 : 1200) : 1800;
  const marginX = classicPackage ? 40 : 50;
  const gridTop = baseHeight < 1000 ? 130 : 150;
  const bottomMargin = baseHeight < 1000 ? 130 : 150;
  const gap = appState.gridLayout === 'two-rows' ? 28 : 20;
  const maxCellWidth = (width - marginX * 2 - gap * (columns - 1)) / columns;
  const maxCellHeight = (baseHeight - gridTop - bottomMargin - gap * (rows - 1)) / rows;
  const cellWidth = Math.min(maxCellWidth, maxCellHeight * (4 / 3));
  const cellHeight = cellWidth * (3 / 4);
  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const compactClassicGrid = classicPackage && !landscape && appState.gridLayout === 'two-rows';
  const height = compactClassicGrid
    ? Math.min(baseHeight, gridTop + gridHeight + bottomMargin)
    : baseHeight;
  const gridBottom = height - bottomMargin;
  const gridLeft = (width - gridWidth) / 2;
  const gridStartY = gridTop + (gridBottom - gridTop - gridHeight) / 2;
  const cells = Array.from({ length: appState.template.slots }, (_, index) => ({
    x: gridLeft + (index % columns) * (cellWidth + gap),
    y: gridStartY + Math.floor(index / columns) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight,
  }));

  return { width, height, cells, orientation: landscape ? 'landscape' : 'portrait' };
}

async function renderFinalStripCanvas() {
  const renderVersion = ++stripRenderVersion;
  const canvas = document.getElementById('final-strip-canvas');
  const layout = getStripGridLayout();
  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = layout.width;
  renderCanvas.height = layout.height;
  const ctx = renderCanvas.getContext('2d');
  const template = { ...appState.template };
  const selectedIndices = [...appState.selectedIndices];
  const capturedPhotos = [...appState.capturedPhotos];
  const activeFilter = appState.activeFilter;

  ctx.fillStyle = template.bg;
  ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
  ctx.fillStyle = template.text;
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SNAPBOX STUDIO', renderCanvas.width / 2, renderCanvas.height < 1000 ? 75 : 85);

  ctx.filter = getCanvasFilterString(activeFilter);
  for (let i = 0; i < layout.cells.length; i++) {
    const src = capturedPhotos[selectedIndices[i]];
    const cell = layout.cells[i];
    if (src) {
      await drawImagePromise(ctx, src, cell.x, cell.y, cell.width, cell.height);
    } else {
      ctx.save();
      ctx.filter = 'none';
      ctx.strokeStyle = template.accent;
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(cell.x, cell.y, cell.width, cell.height);
      ctx.setLineDash([]);
      ctx.fillStyle = template.text;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`PILIH FOTO ${i + 1}`, cell.x + cell.width / 2, cell.y + cell.height / 2);
      ctx.restore();
    }
  }

  ctx.filter = 'none';
  ctx.fillStyle = template.accent;
  ctx.font = 'bold 24px monospace';
  const today = new Date().toLocaleDateString('id-ID');
  ctx.fillText(`SNAPBOX BOOTH #04 • ${today}`, renderCanvas.width / 2, renderCanvas.height - 36);

  if (renderVersion !== stripRenderVersion) return;
  canvas.width = renderCanvas.width;
  canvas.height = renderCanvas.height;
  canvas.getContext('2d').drawImage(renderCanvas, 0, 0);
  appState.finalStripDataUrl = canvas.toDataURL('image/png');
}

function drawImagePromise(ctx, src, x, y, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, w, h);
      resolve();
    };
    img.src = src;
  });
}

async function proceedToDelivery() {
  if (
    appState.selectedIndices.length !== appState.template.slots ||
    appState.selectedIndices.some((photoIndex) => photoIndex === null)
  ) {
    return;
  }
  await renderFinalStripCanvas();
  appState.deliveryReady = false;
  goToStep(6);
}

// ==================== STEP 6: PREPARE DIGITAL PHOTOS & PRINT ====================
async function initDeliveryScreen() {
  document.getElementById('final-output-preview').src = appState.finalStripDataUrl;
  document.getElementById('printer-status-label').textContent = 'Menyiapkan cetak...';
  appState.printSucceeded = null;
  appState.printError = null;
  appState.printErrorMessage = null;
  appState.availablePrinters = [];

  const animationStartedAt = Date.now();
  const printStartedAt = Date.now();
  const estimatedPrintDuration = Math.max(
    8000,
    (appState.baseCopies + appState.extraCopies) * 5000,
  );
  let printProgress = 5;
  updatePrintProgress(printProgress, 'Menghubungkan ke printer...');
  const progressTimer = setInterval(() => {
    printProgress = Math.min(
      95,
      Math.floor(5 + ((Date.now() - printStartedAt) / estimatedPrintDuration) * 90),
    );
    updatePrintProgress(printProgress, 'Sedang mencetak...');
  }, 250);
  const printPromise = triggerHardwarePrint().then((result) => {
    clearInterval(progressTimer);
    appState.printSucceeded = result.success;
    appState.printError = result.errorType;
    appState.printErrorMessage = result.errorMessage;
    appState.availablePrinters = result.availablePrinters || [];
    if (result.success) {
      printProgress = 100;
      updatePrintProgress(printProgress, 'Cetak selesai');
    } else {
      updatePrintProgress(printProgress, 'Cetak gagal');
    }
    return result;
  });
  await Promise.all([printPromise, buildCompleteZipBundle()]);
  const minimumAnimationDuration = 2200;
  const remainingAnimationTime = minimumAnimationDuration - (Date.now() - animationStartedAt);
  if (remainingAnimationTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingAnimationTime));
  }

  if (appState.currentStep === 6) {
    const resultIcon = document.getElementById('delivery-result-icon');
    const resultBadge = document.getElementById('delivery-result-badge');
    const resultTitle = document.getElementById('delivery-result-title');
    const resultMessage = document.getElementById('delivery-result-message');
    if (appState.printSucceeded === false) {
      resultIcon.textContent = 'warning';
      resultIcon.className = 'material-symbols-outlined text-4xl';
      resultBadge.className = 'w-16 h-16 rounded-full bg-secondary-fixed text-secondary flex items-center justify-center mb-5';
      if (appState.printError === 'no-physical-printer') {
        resultTitle.textContent = 'Printer fisik tidak ditemukan';
        const availablePrinters = appState.availablePrinters.join(', ');
        resultMessage.textContent = availablePrinters
          ? `Printer terdeteksi: ${availablePrinters}. Sambungkan printer foto fisik untuk mencetak.`
          : 'Sambungkan printer foto fisik ke komputer booth, lalu ulangi sesi cetak.';
      } else {
        resultTitle.textContent = 'Cetak perlu diperiksa';
        const errorDetail = appState.printErrorMessage || appState.printError || 'Printer tidak merespons';
        resultMessage.textContent = `Printer gagal mencetak (${errorDetail}). Periksa koneksi dan kertas printer, lalu hubungi operator booth.`;
      }
    } else {
      resultIcon.textContent = 'check';
      resultIcon.className = 'material-symbols-outlined text-4xl';
      resultBadge.className = 'w-16 h-16 rounded-full bg-tertiary-fixed/40 text-on-tertiary-fixed flex items-center justify-center mb-5';
      resultTitle.textContent = 'Proses cetak selesai!';
      resultMessage.textContent = 'Ambil hasil cetak di dispenser, lalu masukkan email untuk menerima foto digital.';
    }
    appState.deliveryReady = true;
    goToStep(7);
  }
}

async function buildAnimatedStripFrames() {
  const layout = getStripGridLayout();
  const sourceWidth = layout.width;
  const sourceHeight = layout.height;
  const width = 320;
  const height = Math.round((width * sourceHeight) / sourceWidth);
  const scaleX = width / sourceWidth;
  const scaleY = height / sourceHeight;
  const selectedMotionFrames = appState.selectedIndices.map(
    (photoIndex) => appState.capturedMotionFrames[photoIndex] || [],
  );
  const frameCount = Math.max(2, ...selectedMotionFrames.map((frames) => frames.length));
  const frames = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    await drawImagePromise(ctx, appState.finalStripDataUrl, 0, 0, width, height);
    ctx.filter = getCanvasFilterString(appState.activeFilter);

    for (let slot = 0; slot < appState.selectedIndices.length; slot++) {
      const cell = layout.cells[slot];
      const photoIndex = appState.selectedIndices[slot];
      const motionFrames = selectedMotionFrames[slot];
      const frameSrc = motionFrames.length
        ? motionFrames[frameIndex % motionFrames.length]
        : appState.capturedPhotos[photoIndex];
      await drawImagePromise(
        ctx,
        frameSrc,
        cell.x * scaleX,
        cell.y * scaleY,
        cell.width * scaleX,
        cell.height * scaleY,
      );
    }

    ctx.filter = 'none';
    frames.push(canvas.toDataURL('image/png'));
  }

  return { frames, width, height };
}

async function generateAnimatedGifBlob(photoDataUrls, w = 320, h = 240, frameDelay = 35) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const bytes = [];
  const writeStr = (s) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const writeU16 = (v) => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };

  writeStr('GIF89a');
  writeU16(w);
  writeU16(h);
  bytes.push(0xf7, 0, 0);

  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        bytes.push(r * 51, g * 51, b * 51);
      }
    }
  }
  for (let i = 216; i < 256; i++) bytes.push(0, 0, 0);

  bytes.push(0x21, 0xff, 0x0b);
  writeStr('NETSCAPE2.0');
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const src of photoDataUrls) {
    await drawImagePromise(ctx, src, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h).data;

    bytes.push(0x21, 0xf9, 0x04, 0x00, frameDelay, 0, 0, 0);
    bytes.push(0x2c);
    writeU16(0);
    writeU16(0);
    writeU16(w);
    writeU16(h);
    bytes.push(0x00);

    const minCodeSize = 8;
    bytes.push(minCodeSize);
    const totalPixels = w * h;
    const indexed = new Uint8Array(totalPixels);
    for (let p = 0; p < totalPixels; p++) {
      const r = Math.round(imgData[p * 4] / 51);
      const g = Math.round(imgData[p * 4 + 1] / 51);
      const b = Math.round(imgData[p * 4 + 2] / 51);
      indexed[p] = r * 36 + g * 6 + b;
    }

    let bitBuf = 0;
    let bitLen = 0;
    const subBlock = [];
    const pushCode = (code) => {
      bitBuf |= code << bitLen;
      bitLen += 9;
      while (bitLen >= 8) {
        subBlock.push(bitBuf & 0xff);
        bitBuf >>= 8;
        bitLen -= 8;
        if (subBlock.length === 255) {
          bytes.push(255, ...subBlock);
          subBlock.length = 0;
        }
      }
    };

    pushCode(256);
    for (let i = 0; i < indexed.length; i++) {
      pushCode(indexed[i]);
      if (i % 250 === 249) pushCode(256);
    }
    pushCode(257);
    if (bitLen > 0) subBlock.push(bitBuf & 0xff);
    if (subBlock.length > 0) bytes.push(subBlock.length, ...subBlock);
    bytes.push(0x00);
  }

  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

function dataURLToBase64(dataUrl) {
  return dataUrl.split(',')[1];
}

async function buildCompleteZipBundle() {
  const zip = new JSZip();
  zip.file('FotoStrip_Statis.png', dataURLToBase64(appState.finalStripDataUrl), { base64: true });
  appState.capturedPhotos.forEach((src, idx) => {
    const poseNumber = String(idx + 1).padStart(2, '0');
    zip.file(`Foto_Pose_${poseNumber}.jpg`, dataURLToBase64(src), { base64: true });
  });

  const gifBlob = await generateAnimatedGifBlob(appState.capturedPhotos);
  zip.file('Animasi_Semua_Pose.gif', gifBlob);

  const animatedStrip = await buildAnimatedStripFrames();
  const animatedStripGif = await generateAnimatedGifBlob(
    animatedStrip.frames,
    animatedStrip.width,
    animatedStrip.height,
    22,
  );
  zip.file('FotoStrip_Animasi.gif', animatedStripGif);
  if (appState.animatedStripPreviewUrl) {
    URL.revokeObjectURL(appState.animatedStripPreviewUrl);
  }
  appState.animatedStripPreviewUrl = URL.createObjectURL(animatedStripGif);
  document.getElementById('live-gif-preview').src = appState.animatedStripPreviewUrl;

  appState.zipBlob = await zip.generateAsync({ type: 'blob' });
}

function triggerHardwarePrint() {
  const statusLabel = document.getElementById('printer-status-label');
  statusLabel.textContent = 'Mengirim ke Printer...';

  return new Promise((resolve) => {
    if (window.kioskAPI && window.kioskAPI.printPhotostrip) {
      window.kioskAPI.onPrintStatus((res) => {
        statusLabel.textContent = res.success ? 'Cetak Selesai!' : 'Cetak gagal';
        resolve({
          success: res.success,
          errorType: res.errorType,
          errorMessage: res.errorMessage,
          availablePrinters: res.availablePrinters,
        });
      });
      try {
        window.kioskAPI.printPhotostrip({
          imageDataUrl: appState.finalStripDataUrl,
          copies: appState.baseCopies + appState.extraCopies,
          orientation: appState.gridLayout === 'horizontal' ? 'landscape' : 'portrait',
        });
      } catch (error) {
        resolve({ success: false, errorType: error.message });
      }
    } else {
      setTimeout(() => {
        statusLabel.textContent = 'Cetak Selesai (Mode Browser)';
        resolve({ success: true, errorType: null });
      }, 1800);
    }
  });
}

function updatePrintProgress(progress, message) {
  const bar = document.getElementById('print-progress-bar');
  const value = document.getElementById('print-progress-value');
  const label = document.getElementById('print-progress-label');
  const boundedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  bar.style.width = `${boundedProgress}%`;
  bar.parentElement.setAttribute('aria-valuenow', boundedProgress);
  value.textContent = `${boundedProgress}%`;
  label.textContent = message;
}

function emailKeyPress(char) {
  const input = document.getElementById('customer-email-input');
  if (input.value.length < 254) input.value += char;
  input.focus();
  clearEmailFeedback();
}

function emailBackspace() {
  const input = document.getElementById('customer-email-input');
  input.value = input.value.slice(0, -1);
  input.focus();
  clearEmailFeedback();
}

function clearEmail() {
  const input = document.getElementById('customer-email-input');
  input.value = '';
  input.focus();
  clearEmailFeedback();
}

function clearEmailFeedback() {
  document.getElementById('email-feedback-msg').classList.add('hidden');
}

function showEmailFeedback(message, success) {
  const feedback = document.getElementById('email-feedback-msg');
  feedback.textContent = message;
  feedback.className = success
    ? 'text-xs font-bold text-on-tertiary-fixed bg-tertiary-fixed/40 p-2.5 rounded-lg'
    : 'text-xs font-bold text-red-700 bg-red-100 p-2.5 rounded-lg';
}

async function sendPhotosToEmail() {
  const input = document.getElementById('customer-email-input');
  const email = input.value.trim();
  if (!email || !input.checkValidity()) {
    showEmailFeedback('Masukkan alamat email yang valid terlebih dahulu.', false);
    return;
  }
  if (!appState.zipBlob) {
    showEmailFeedback('Paket foto sesi belum siap. Tunggu proses cetak selesai, lalu coba lagi.', false);
    return;
  }
  if (!window.kioskAPI || !window.kioskAPI.sendPhotosToEmail) {
    showEmailFeedback('Pengiriman email hanya tersedia dari aplikasi kiosk.', false);
    return;
  }
  if (appState.emailSending) return;

  const button = document.getElementById('send-email-button');
  appState.emailSending = true;
  button.disabled = true;
  button.textContent = 'Mengirim foto...';

  try {
    const result = await window.kioskAPI.sendPhotosToEmail({
      email,
      zipData: await appState.zipBlob.arrayBuffer(),
    });
    if (result && result.success) {
      showEmailFeedback('Email berhasil dikirim. Silakan periksa inbox atau folder spam.', true);
    } else {
      const errorMessages = {
        'email-not-configured': 'Layanan email belum dikonfigurasi. Hubungi operator booth.',
        'email-config-invalid': 'Konfigurasi email tidak valid. Hubungi operator booth.',
        'invalid-email': 'Masukkan alamat email yang valid.',
        'invalid-email-attachment': 'File foto sesi belum valid. Ulangi proses atau hubungi operator.',
        'email-attachment-too-large': 'Ukuran lampiran melebihi 18 MB. Hubungi operator booth.',
        'email-send-failed': 'Email gagal dikirim. Periksa koneksi internet atau hubungi operator booth.',
        'email-request-rejected': 'Permintaan email ditolak. Mulai sesi baru dan coba lagi.',
      };
      showEmailFeedback(
        errorMessages[result && result.errorCode] || 'Email gagal dikirim. Hubungi operator booth.',
        false,
      );
    }
  } catch (error) {
    console.error('Email delivery request failed:', error);
    showEmailFeedback('Email gagal dikirim. Periksa koneksi internet atau hubungi operator booth.', false);
  } finally {
    appState.emailSending = false;
    button.disabled = false;
    button.textContent = 'Kirim Foto ke Email';
  }
}

async function downloadPhotosLocally() {
  if (!appState.zipBlob) {
    showEmailFeedback('Paket foto sesi belum siap. Tunggu proses cetak selesai, lalu coba lagi.', false);
    return;
  }

  const button = document.getElementById('download-photos-button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Menyiapkan unduhan...';

  try {
    if (window.kioskAPI && window.kioskAPI.savePhotosZip) {
      const result = await window.kioskAPI.savePhotosZip({
        zipData: await appState.zipBlob.arrayBuffer(),
      });
      if (result && result.success) {
        showEmailFeedback('Paket ZIP berhasil disimpan di perangkat.', true);
      } else if (result && result.cancelled) {
        showEmailFeedback('Penyimpanan dibatalkan.', true);
      } else {
        const errorMessages = {
          'download-request-rejected': 'Permintaan unduhan ditolak. Mulai sesi baru dan coba lagi.',
          'invalid-download-attachment': 'Paket foto belum valid. Hubungi operator booth.',
          'download-save-failed': 'Paket foto gagal disimpan. Coba lagi atau hubungi operator booth.',
        };
        showEmailFeedback(
          errorMessages[result && result.errorCode] || 'Paket foto gagal disimpan. Hubungi operator booth.',
          false,
        );
      }
    } else {
      const url = URL.createObjectURL(appState.zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'SnapBox_Foto_dan_GIF.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showEmailFeedback('Unduhan ZIP dimulai.', true);
    }
  } catch (error) {
    console.error('Local photo download failed:', error);
    showEmailFeedback('Paket foto gagal disimpan. Coba lagi atau hubungi operator booth.', false);
  } finally {
    button.disabled = false;
    button.textContent = 'Unduh Paket Foto (ZIP)';
  }
}

function toggleHelpModal(show) {
  const modal = document.getElementById('help-modal');
  if (show) modal.classList.remove('hidden');
  else modal.classList.add('hidden');
}

function toggleStripPreview(show) {
  const modal = document.getElementById('strip-preview-modal');
  if (show) {
    document.getElementById('strip-preview-modal-image').src = appState.finalStripDataUrl;
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function resetAllAndRestart() {
  stopCameraAndTimers();
  stopSessionTimer();
  appState.deliveryReady = false;
  appState.extraCopies = 0;
  appState.voucherCode = '';
  appState.discountAmount = 0;
  appState.capturedPhotos = [];
  appState.capturedMotionFrames = [];
  appState.currentShotMotionFrames = [];
  appState.retakesUsedForCurrent = 0;
  resetTemplateSetup();
  appState.inspectedPhotoIndex = 0;
  appState.zipBlob = null;
  if (appState.animatedStripPreviewUrl) {
    URL.revokeObjectURL(appState.animatedStripPreviewUrl);
    appState.animatedStripPreviewUrl = null;
  }
  document.getElementById('live-gif-preview').removeAttribute('src');
  document.getElementById('qty-display').textContent = '0';
  document.getElementById('voucher-input').textContent = '';
  document.getElementById('customer-email-input').value = '';
  document.getElementById('email-feedback-msg').classList.add('hidden');
  goToStep(0);
}

updateTemplateAvailability();