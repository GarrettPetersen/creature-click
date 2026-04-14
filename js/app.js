import { loadCatalog, pickRandomAnimal } from './catalog.js';
import {
  COOLDOWN_MS,
  getCooldownUntil,
  setCooldownUntil,
  getPhotos,
  addPhoto,
  clearCooldown,
  clearPhotos,
  setLastBackgroundUrl,
  getLastBackgroundUrl,
} from './storage.js';
import {
  unlockAudio,
  playBeepUnfocused,
  playFocusSound,
  playShutterSound,
  playPrintSound,
} from './sounds.js';

const PRINT_DURATION_MS = 7000;
const PRINT_FALLBACK_MS = 7200;
const PRINT_FALLBACK_REDUCED_MS = 80;
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

/** Dev: Ctrl+Shift+Alt+R */

const els = {
  creatureBg: document.getElementById('creature-bg'),
  creatureDrift: document.getElementById('creature-drift'),
  creatureImg: document.getElementById('creature-img'),
  cameraHit: document.getElementById('camera-hit'),
  swapBtn: document.getElementById('swap-btn'),
  albumModal: document.getElementById('album-modal'),
  albumScroll: document.getElementById('album-scroll'),
  albumList: document.getElementById('album-list'),
  modalCountdown: document.getElementById('modal-countdown'),
  donutProgress: document.getElementById('donut-progress'),
  printStage: document.getElementById('print-stage'),
  emergingPolaroid: document.getElementById('emerging-polaroid'),
  printImg: document.getElementById('print-img'),
  printCaption: document.getElementById('print-caption'),
  expandLayer: document.getElementById('expand-layer'),
  expandBackdrop: document.getElementById('expand-backdrop'),
  expandFly: document.getElementById('expand-fly'),
};

/**
 * @type {'camera_unfocused' | 'camera_focused' | 'taking_picture' | 'waiting'}
 */
let gameState = 'camera_unfocused';
let currentCreature = null;
let cooldownTimer = null;
let loadLock = false;

/** @type {{ btn: HTMLButtonElement; clone: HTMLElement; source: HTMLElement } | null} */
let expandedState = null;

function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function isCooldownActive() {
  return Date.now() < getCooldownUntil();
}

function setPhaseCamera() {
  document.body.classList.remove('phase-waiting');
  document.body.classList.add('phase-camera');
  els.albumModal.classList.add('hidden');
  els.albumModal.setAttribute('aria-hidden', 'true');
}

function setPhaseWaiting() {
  document.body.classList.remove('phase-camera');
  document.body.classList.add('phase-waiting');
  els.albumModal.classList.remove('hidden');
  els.albumModal.setAttribute('aria-hidden', 'false');
}

function setCameraLive(on) {
  document.body.classList.toggle('is-camera-live', on);
}

function setCameraPrinting(on) {
  document.body.classList.toggle('is-printing', on);
}

function setFocused(on) {
  document.body.classList.toggle('is-focused', on);
}

function setLoadError(on) {
  document.body.classList.toggle('has-load-error', !!on);
}

function updateAlbumCountdown() {
  const until = getCooldownUntil();
  const left = Math.max(0, until - Date.now());
  els.modalCountdown.textContent = formatClock(left);
  const ratio = COOLDOWN_MS > 0 ? left / COOLDOWN_MS : 0;
  els.donutProgress.style.strokeDasharray = `${DONUT_C}`;
  els.donutProgress.style.strokeDashoffset = `${DONUT_C * (1 - ratio)}`;
}

function startCooldownTimer() {
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    if (!isCooldownActive()) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      setLastBackgroundUrl('');
      setPhaseCamera();
      beginRound();
      return;
    }
    updateAlbumCountdown();
  }, 250);
}

function showWaitingUI() {
  gameState = 'waiting';
  setPhaseWaiting();
  updateAlbumCountdown();
  startCooldownTimer();
}

function resetCameraUnfocusedUI() {
  gameState = 'camera_unfocused';
  setFocused(false);
  setCameraPrinting(false);
  setCameraLive(true);
  els.swapBtn.classList.remove('hidden');
}

function pickAnimalPayload(excludeId) {
  const row = pickRandomAnimal(excludeId);
  if (!row) throw new Error('No animals in catalog.');
  return {
    creature: row,
    fullUrl: row.imageUrl,
    thumbUrl: row.thumbUrl,
  };
}

async function beginRound() {
  loadLock = true;
  setLoadError(false);
  els.creatureImg.removeAttribute('src');
  els.creatureImg.alt = '';
  currentCreature = null;
  resetCameraUnfocusedUI();
  els.swapBtn.disabled = true;
  setPhaseCamera();
  try {
    const data = pickAnimalPayload(null);
    currentCreature = data;
    els.creatureImg.src = data.fullUrl;
    await els.creatureImg.decode().catch(() => {});
    await unlockAudio();
    await playBeepUnfocused();
  } catch {
    setLoadError(true);
    setCameraLive(false);
  } finally {
    loadLock = false;
    els.swapBtn.disabled = false;
  }
}

async function swapCreature() {
  if (gameState !== 'camera_unfocused' || !currentCreature || loadLock) return;
  loadLock = true;
  setLoadError(false);
  els.swapBtn.disabled = true;
  const excludeId = currentCreature.creature.id;
  try {
    const data = pickAnimalPayload(excludeId);
    currentCreature = data;
    els.creatureImg.src = data.fullUrl;
    await els.creatureImg.decode().catch(() => {});
    await unlockAudio();
    await playBeepUnfocused();
    resetCameraUnfocusedUI();
  } catch {
    setLoadError(true);
  } finally {
    loadLock = false;
    els.swapBtn.disabled = false;
  }
}

function runPrintEmergence(imageUrl, caption) {
  const el = els.emergingPolaroid;
  els.printImg.src = imageUrl;
  els.printImg.alt = '';
  els.printCaption.textContent = caption;
  els.printStage.classList.remove('hidden');
  els.printStage.setAttribute('aria-hidden', 'false');
  el.classList.remove('is-emerged');
  void el.offsetHeight;

  return new Promise((resolve) => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fallbackMs = prefersReduced ? PRINT_FALLBACK_REDUCED_MS : PRINT_FALLBACK_MS;

    const done = () => {
      el.removeEventListener('transitionend', onEnd);
      clearTimeout(fallback);
      resolve();
    };

    const onEnd = (e) => {
      if (e.target === el && e.propertyName === 'transform') done();
    };

    el.addEventListener('transitionend', onEnd);
    const fallback = setTimeout(done, fallbackMs);

    requestAnimationFrame(() => {
      el.classList.add('is-emerged');
    });
  });
}

function hidePrintStage() {
  els.printStage.classList.add('hidden');
  els.printStage.setAttribute('aria-hidden', 'true');
  els.emergingPolaroid.classList.remove('is-emerged');
}

function buildPolaroidEl(photo, fullRes = false, layout = 'thumb') {
  const wrap = document.createElement('div');
  wrap.className = layout === 'expand' ? 'polaroid polaroid--expand' : 'polaroid polaroid--thumb';
  const photoWrap = document.createElement('div');
  photoWrap.className = 'polaroid__photo';
  const img = document.createElement('img');
  img.className = 'polaroid__img';
  img.src = fullRes ? photo.imageUrl : photo.thumbUrl || photo.imageUrl;
  img.alt = '';
  photoWrap.appendChild(img);
  const cap = document.createElement('p');
  cap.className = 'polaroid__caption';
  cap.textContent = photo.animalName;
  wrap.appendChild(photoWrap);
  wrap.appendChild(cap);
  return wrap;
}

function renderAlbumList() {
  const photos = getPhotos();
  els.albumList.replaceChildren();
  for (const p of photos) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'album-item';
    btn.appendChild(buildPolaroidEl(p, false));
    btn.addEventListener('click', () => expandPhoto(btn, p));
    els.albumList.appendChild(btn);
  }
}

function expandPhoto(btn, photo) {
  if (expandedState || loadLock) return;
  const source = btn.querySelector('.polaroid');
  if (!source) return;

  const first = source.getBoundingClientRect();
  source.classList.add('is-source-hidden');

  const clone = buildPolaroidEl(photo, true, 'expand');
  const lastW = Math.min(window.innerWidth * 0.9, 340);
  const lastH = Math.min(window.innerHeight * 0.82, lastW * 1.28);
  const lastLeft = (window.innerWidth - lastW) / 2;
  const lastTop = (window.innerHeight - lastH) / 2;

  clone.style.position = 'fixed';
  clone.style.left = `${lastLeft}px`;
  clone.style.top = `${lastTop}px`;
  clone.style.width = `${lastW}px`;
  clone.style.height = `${lastH}px`;
  clone.style.margin = '0';
  clone.style.zIndex = '3';
  clone.style.transformOrigin = 'top left';
  clone.style.boxSizing = 'border-box';

  const dx = first.left - lastLeft;
  const dy = first.top - lastTop;
  const sx = first.width / lastW;
  const sy = first.height / lastH;
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

  els.expandFly.replaceChildren(clone);
  els.expandLayer.classList.remove('hidden');
  els.expandLayer.setAttribute('aria-hidden', 'false');
  expandedState = { btn, clone, source };

  clone.addEventListener('click', (e) => {
    e.stopPropagation();
    collapsePhoto();
  });

  requestAnimationFrame(() => {
    clone.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
    clone.style.transform = 'none';
  });
}

function collapsePhoto() {
  if (!expandedState) return;
  const { clone, source } = expandedState;
  const firstRect = clone.getBoundingClientRect();
  const lastRect = source.getBoundingClientRect();
  const dx = lastRect.left - firstRect.left;
  const dy = lastRect.top - firstRect.top;
  const sx = lastRect.width / firstRect.width;
  const sy = lastRect.height / firstRect.height;

  clone.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    clone.removeEventListener('transitionend', onEnd);
    source.classList.remove('is-source-hidden');
    els.expandFly.replaceChildren();
    els.expandLayer.classList.add('hidden');
    els.expandLayer.setAttribute('aria-hidden', 'true');
    expandedState = null;
  };

  const onEnd = (e) => {
    if (e.propertyName === 'transform') done();
  };
  clone.addEventListener('transitionend', onEnd);
  setTimeout(done, 520);
}

function onAlbumScroll() {
  if (expandedState) collapsePhoto();
}

async function onCameraActivate() {
  if (loadLock || isCooldownActive() || !currentCreature || gameState === 'taking_picture') return;
  await unlockAudio();

  if (gameState === 'camera_unfocused') {
    await playFocusSound();
    gameState = 'camera_focused';
    setFocused(true);
    els.swapBtn.classList.add('hidden');
    return;
  }

  if (gameState === 'camera_focused') {
    gameState = 'taking_picture';
    setCameraPrinting(true);
    loadLock = true;

    await playShutterSound();
    void playPrintSound();

    try {
      await runPrintEmergence(currentCreature.fullUrl, currentCreature.creature.name);

      const photo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        animalName: currentCreature.creature.name,
        imageUrl: currentCreature.fullUrl,
        thumbUrl: currentCreature.thumbUrl,
        takenAt: new Date().toISOString(),
      };
      addPhoto(photo);
      setLastBackgroundUrl(currentCreature.fullUrl);
      renderAlbumList();
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      hidePrintStage();
      setCameraLive(false);
      showWaitingUI();
    } finally {
      loadLock = false;
      setCameraPrinting(false);
    }
  }
}

async function devResetGame() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  collapsePhoto();
  hidePrintStage();
  setLoadError(false);
  clearCooldown();
  clearPhotos();
  setLastBackgroundUrl('');
  renderAlbumList();
  updateAlbumCountdown();
  expandedState = null;
  loadLock = false;
  setCameraPrinting(false);

  try {
    await loadCatalog();
    document.body.classList.remove('no-catalog');
  } catch {
    document.body.classList.add('no-catalog');
    return;
  }

  renderAlbumList();
  await beginRound();
}

function applyCooldownBootBackground() {
  const url = getLastBackgroundUrl() || getPhotos()[0]?.imageUrl;
  if (url) els.creatureImg.src = url;
}

async function bootstrap() {
  els.donutProgress.style.strokeDasharray = `${DONUT_C}`;

  try {
    await loadCatalog();
    renderAlbumList();
    if (isCooldownActive()) {
      applyCooldownBootBackground();
      setPhaseWaiting();
      gameState = 'waiting';
      updateAlbumCountdown();
      startCooldownTimer();
    } else {
      setPhaseCamera();
      beginRound();
    }
  } catch {
    document.body.classList.add('no-catalog');
  }

  els.cameraHit.addEventListener('click', () => {
    onCameraActivate();
  });

  els.cameraHit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCameraActivate();
    }
  });

  els.swapBtn.addEventListener('click', () => {
    swapCreature();
  });

  els.expandBackdrop.addEventListener('click', () => {
    collapsePhoto();
  });

  els.albumScroll.addEventListener('scroll', onAlbumScroll, { passive: true });

  window.addEventListener(
    'wheel',
    () => {
      if (expandedState) collapsePhoto();
    },
    { passive: true }
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expandedState) {
      e.preventDefault();
      collapsePhoto();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      void devResetGame();
    }
  });
}

bootstrap();
