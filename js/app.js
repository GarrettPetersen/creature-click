import { loadCatalog, pickRandomAnimal } from './catalog.js';
import {
  COOLDOWN_MS,
  getCooldownUntil,
  setCooldownUntil,
  getPhotos,
  addPhoto,
  clearCooldown,
  clearPhotos,
} from './storage.js';
import {
  unlockAudio,
  playBeepUnfocused,
  playFocusSound,
  playShutterSound,
  playPrintSound,
} from './sounds.js';

const PRINT_FALLBACK_MS = 1300;
const PRINT_FALLBACK_REDUCED_MS = 80;

/** Dev: Ctrl+Shift+Alt+R — clears cooldown & album, returns to camera (testing only). */

const els = {
  countdownBar: document.getElementById('countdown-bar'),
  countdownClock: document.getElementById('countdown-clock'),
  playPanel: document.getElementById('play-panel'),
  viewfinder: document.getElementById('viewfinder'),
  creatureImg: document.getElementById('creature-img'),
  newCreatureBtn: document.getElementById('new-creature-btn'),
  collectionGrid: document.getElementById('collection-grid'),
  printStage: document.getElementById('print-stage'),
  emergingPolaroid: document.getElementById('emerging-polaroid'),
  printImg: document.getElementById('print-img'),
  printCaption: document.getElementById('print-caption'),
  lightbox: document.getElementById('lightbox'),
  lightboxBackdrop: document.getElementById('lightbox-backdrop'),
  lightboxCard: document.getElementById('lightbox-card'),
  lightboxImg: document.getElementById('lightbox-img'),
  lightboxCaption: document.getElementById('lightbox-caption'),
};

/**
 * @type {'camera_unfocused' | 'camera_focused' | 'taking_picture' | 'waiting'}
 */
let gameState = 'camera_unfocused';
let currentCreature = null;
let cooldownTimer = null;
let loadLock = false;
let lightboxOpen = false;
let lastScrollYForLightbox = 0;
let lightboxTouchY = null;

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

function setWaitingChrome(visible) {
  els.countdownBar.classList.toggle('hidden', !visible);
  document.body.classList.toggle('is-waiting', visible);
}

function showWaitingUI() {
  gameState = 'waiting';
  els.playPanel.classList.add('hidden');
  setWaitingChrome(true);
  updateCooldownLabel();
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    if (!isCooldownActive()) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      setWaitingChrome(false);
      beginRound();
      return;
    }
    updateCooldownLabel();
  }, 250);
}

function updateCooldownLabel() {
  const until = getCooldownUntil();
  const left = until - Date.now();
  els.countdownClock.textContent = formatClock(left);
}

function setCameraLive(on) {
  els.viewfinder.classList.toggle('is-camera-live', on);
}

function setCameraPrinting(on) {
  els.viewfinder.classList.toggle('is-printing', on);
}

function setLoadError(on) {
  els.playPanel.classList.toggle('has-load-error', !!on);
}

function resetCameraUnfocusedUI() {
  gameState = 'camera_unfocused';
  els.viewfinder.classList.remove('is-focused');
  setCameraPrinting(false);
  setCameraLive(true);
  els.newCreatureBtn.classList.remove('hidden');
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
  els.newCreatureBtn.disabled = true;
  els.playPanel.classList.remove('hidden');
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
    els.newCreatureBtn.disabled = false;
  }
}

async function swapCreature() {
  if (gameState !== 'camera_unfocused' || !currentCreature || loadLock) return;
  loadLock = true;
  setLoadError(false);
  els.newCreatureBtn.disabled = true;
  const excludeId = currentCreature.creature.id;
  try {
    const data = pickAnimalPayload(excludeId);
    currentCreature = data;
    els.creatureImg.alt = '';
    els.creatureImg.src = data.fullUrl;
    await els.creatureImg.decode().catch(() => {});
    await unlockAudio();
    await playBeepUnfocused();
    resetCameraUnfocusedUI();
  } catch {
    setLoadError(true);
  } finally {
    loadLock = false;
    els.newCreatureBtn.disabled = false;
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

function renderCollection() {
  const photos = getPhotos();
  els.collectionGrid.replaceChildren();
  for (const p of photos) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'collection-item';

    const polaroid = document.createElement('div');
    polaroid.className = 'polaroid polaroid--thumb';

    const photoWrap = document.createElement('div');
    photoWrap.className = 'polaroid__photo';
    const img = document.createElement('img');
    img.className = 'polaroid__img';
    img.src = p.thumbUrl || p.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    photoWrap.appendChild(img);

    const cap = document.createElement('p');
    cap.className = 'polaroid__caption';
    cap.textContent = p.animalName;

    polaroid.appendChild(photoWrap);
    polaroid.appendChild(cap);
    btn.appendChild(polaroid);

    btn.addEventListener('click', () => openLightbox(p));
    els.collectionGrid.appendChild(btn);
  }
}

function openLightbox(photo) {
  lightboxOpen = true;
  lastScrollYForLightbox = window.scrollY;
  lightboxTouchY = null;
  els.lightboxImg.src = photo.imageUrl;
  els.lightboxImg.alt = '';
  els.lightboxCaption.textContent = photo.animalName;
  els.lightbox.classList.remove('hidden');
  els.lightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
  if (!lightboxOpen) return;
  lightboxOpen = false;
  lightboxTouchY = null;
  els.lightbox.classList.add('hidden');
  els.lightbox.setAttribute('aria-hidden', 'true');
  els.lightboxImg.removeAttribute('src');
}

function onWindowScroll() {
  if (!lightboxOpen) return;
  if (Math.abs(window.scrollY - lastScrollYForLightbox) > 12) {
    closeLightbox();
  }
}

async function devResetGame() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  closeLightbox();
  hidePrintStage();
  setLoadError(false);
  clearCooldown();
  clearPhotos();
  renderCollection();
  setWaitingChrome(false);
  els.playPanel.classList.remove('hidden');
  gameState = 'camera_unfocused';
  loadLock = false;
  setCameraPrinting(false);

  try {
    await loadCatalog();
    document.body.classList.remove('no-catalog');
  } catch {
    document.body.classList.add('no-catalog');
    els.playPanel.classList.add('hidden');
    return;
  }

  renderCollection();
  await beginRound();
}

async function onViewfinderActivate() {
  if (loadLock || isCooldownActive() || !currentCreature || gameState === 'taking_picture') return;
  await unlockAudio();

  if (gameState === 'camera_unfocused') {
    await playFocusSound();
    gameState = 'camera_focused';
    els.viewfinder.classList.add('is-focused');
    els.creatureImg.alt = '';
    els.newCreatureBtn.classList.add('hidden');
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
      renderCollection();
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

async function bootstrap() {
  try {
    await loadCatalog();
    renderCollection();
    if (isCooldownActive()) {
      showWaitingUI();
    } else {
      setWaitingChrome(false);
      beginRound();
    }
  } catch {
    document.body.classList.add('no-catalog');
    els.playPanel.classList.add('hidden');
  }

  els.viewfinder.addEventListener('click', () => {
    onViewfinderActivate();
  });

  els.viewfinder.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onViewfinderActivate();
    }
  });

  els.newCreatureBtn.addEventListener('click', () => {
    swapCreature();
  });

  els.lightboxBackdrop.addEventListener('click', () => closeLightbox());
  els.lightboxCard.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  window.addEventListener(
    'scroll',
    () => {
      onWindowScroll();
    },
    { passive: true }
  );

  window.addEventListener(
    'wheel',
    () => {
      if (lightboxOpen) closeLightbox();
    },
    { passive: true }
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxOpen) {
      e.preventDefault();
      closeLightbox();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      void devResetGame();
    }
  });

  document.addEventListener(
    'touchstart',
    (e) => {
      if (!lightboxOpen) return;
      lightboxTouchY = e.touches[0]?.clientY ?? null;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!lightboxOpen || lightboxTouchY == null) return;
      const y = e.touches[0]?.clientY;
      if (y != null && Math.abs(y - lightboxTouchY) > 28) closeLightbox();
    },
    { passive: true }
  );
}

bootstrap();
