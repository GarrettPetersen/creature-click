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

const PRINT_FALLBACK_MS = 7200;
const PRINT_FALLBACK_REDUCED_MS = 80;
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

const TRANS_EXPAND =
  'left 0.52s cubic-bezier(0.22, 1, 0.36, 1), top 0.52s cubic-bezier(0.22, 1, 0.36, 1), width 0.52s cubic-bezier(0.22, 1, 0.36, 1), height 0.52s cubic-bezier(0.22, 1, 0.36, 1), transform 0.52s cubic-bezier(0.22, 1, 0.36, 1)';

const RUSH_LERP = 0.32;
const RUSH_DONE_DIST = 6;
const RUSH_DONE_SIZE = 6;
const RUSH_DONE_ROT = 2.5;
const COLLAPSE_CLICK_MS = 540;

const FOCUS_OBJECT_POSITION = {
  left: 'left center',
  right: 'right center',
  up: 'center top',
  down: 'center bottom',
};

/** @param {HTMLImageElement | null | undefined} img @param {string | undefined} direction */
function applyImageFocus(img, direction) {
  if (!img) return;
  const pos = direction && FOCUS_OBJECT_POSITION[direction];
  if (pos) img.style.objectPosition = pos;
  else img.style.removeProperty('object-position');
}
/** Past this scroll delta from open, treat as “moved away” → same close as tapping the photo. */
const SCROLL_AWAY_TO_COLLAPSE_PX = 80;

/** Dev: Ctrl+Shift+Alt+R = full reset. Ctrl+Shift+Alt+T = skip countdown (keep photos). */

const els = {
  creatureBg: document.getElementById('creature-bg'),
  creatureImg: document.getElementById('creature-img'),
  cameraHit: document.getElementById('camera-hit'),
  shutterFlash: document.getElementById('shutter-flash'),
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
};

/**
 * @type {'camera_unfocused' | 'camera_focused' | 'taking_picture' | 'waiting'}
 */
let gameState = 'camera_unfocused';
let currentCreature = null;
let cooldownTimer = null;
let loadLock = false;

/** Next round’s image payload after decode(); consumed by beginRound. */
let preloadedNextCreature = null;
let preloadGeneration = 0;

/** @type {{ polaroid: HTMLElement; placeholder: HTMLElement; btn: HTMLButtonElement; tilt: number; thumbSrc: string; ow: number; oh: number; rushRotDeg: number; collapseTimerId: ReturnType<typeof setTimeout> | null; rushRafId: number | null; expandScrollTop: number; photo: { direction?: string; imageUrl: string; thumbUrl?: string; animalName?: string } } | null} */
let expandedState = null;

let touchScrollLastY = null;

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

function triggerShutterFlash() {
  const el = els.shutterFlash;
  el.classList.remove('is-on');
  void el.offsetHeight;
  el.classList.add('is-on');
  setTimeout(() => {
    el.classList.remove('is-on');
  }, 85);
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
}

function getPhotographedCreatureIds() {
  return getPhotos()
    .map((p) => p.creatureId)
    .filter((id) => id != null && id !== '');
}

function randomTiltDeg() {
  return Math.round((Math.random() * 30 - 15) * 10) / 10;
}

/** Stable tilt for legacy saves without tiltDeg */
function tiltFromPhoto(photo) {
  if (typeof photo.tiltDeg === 'number' && Number.isFinite(photo.tiltDeg)) {
    return Math.max(-15, Math.min(15, photo.tiltDeg));
  }
  let h = 0;
  const id = photo.id || '';
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 310) / 10) - 15;
}

function pickAnimalPayload(excludeOverride) {
  const exclude = excludeOverride ?? getPhotographedCreatureIds();
  const row = pickRandomAnimal(exclude);
  if (!row) throw new Error('No animals in catalog.');
  return {
    creature: row,
    fullUrl: row.imageUrl,
    thumbUrl: row.thumbUrl,
  };
}

function invalidatePreloads() {
  preloadGeneration += 1;
  preloadedNextCreature = null;
}

/** Cross-origin Commons URLs can make `decode()` never settle in some browsers; never block the UI on it. */
function withDecodeTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

async function decodeImageUrl(url) {
  const img = new Image();
  img.src = url;
  if (img.decode) {
    await withDecodeTimeout(img.decode().catch(() => {}), 5000);
  } else {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Preload failed'));
    });
  }
}

/** Warm every URL the album modal will show (existing rows + this capture’s thumb/full). */
async function preloadAlbumModalImagesForCapture(creature) {
  const urls = new Set();
  for (const p of getPhotos()) {
    const u = p.thumbUrl || p.imageUrl;
    if (u) urls.add(u);
  }
  if (creature.thumbUrl) urls.add(creature.thumbUrl);
  if (creature.fullUrl) urls.add(creature.fullUrl);
  await Promise.all([...urls].map((url) => decodeImageUrl(url).catch(() => {})));
}

/** Warm the next full-size image in the background (decode in a separate Image). */
async function preloadNextRound(excludeOverride) {
  const gen = ++preloadGeneration;
  try {
    const data = pickAnimalPayload(excludeOverride);
    await decodeImageUrl(data.fullUrl);
    if (gen === preloadGeneration) {
      preloadedNextCreature = data;
    }
  } catch {
    if (gen === preloadGeneration) {
      preloadedNextCreature = null;
    }
  }
}

async function beginRound() {
  loadLock = true;
  setLoadError(false);
  els.creatureImg.removeAttribute('src');
  els.creatureImg.alt = '';
  applyImageFocus(els.creatureImg, undefined);
  currentCreature = null;
  resetCameraUnfocusedUI();
  setPhaseCamera();
  try {
    const photographed = new Set(getPhotographedCreatureIds());
    let data = null;
    if (preloadedNextCreature && !photographed.has(preloadedNextCreature.creature.id)) {
      data = preloadedNextCreature;
      preloadedNextCreature = null;
    } else {
      preloadedNextCreature = null;
      data = pickAnimalPayload();
    }
    currentCreature = data;
    els.creatureImg.src = data.fullUrl;
    applyImageFocus(els.creatureImg, data.creature.direction);
    await withDecodeTimeout(els.creatureImg.decode().catch(() => {}), 2500);
    await unlockAudio();
    await playBeepUnfocused();
    void preloadNextRound();
  } catch {
    setLoadError(true);
    setCameraLive(false);
  } finally {
    loadLock = false;
  }
}

function runPrintEmergence(imageUrl, caption, direction) {
  const el = els.emergingPolaroid;
  const img = els.printImg;
  const refocus = () => applyImageFocus(img, direction);

  img.alt = '';
  img.addEventListener(
    'load',
    () => {
      refocus();
      void img.decode().then(refocus).catch(() => refocus());
    },
    { once: true }
  );
  img.src = imageUrl;
  if (img.complete && img.naturalWidth > 0) {
    refocus();
    void img.decode().then(refocus).catch(() => refocus());
  } else {
    refocus();
  }

  els.printCaption.textContent = caption;
  els.printStage.classList.remove('hidden');
  els.printStage.setAttribute('aria-hidden', 'false');
  /* Re-apply after the stage is visible so layout/object-position isn’t skipped (e.g. display:none). */
  requestAnimationFrame(() => {
    refocus();
    requestAnimationFrame(refocus);
  });

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
  applyImageFocus(els.printImg, undefined);
  els.printStage.classList.add('hidden');
  els.printStage.setAttribute('aria-hidden', 'true');
  els.emergingPolaroid.classList.remove('is-emerged');
}

function buildAlbumPolaroid(photo, { eager = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'polaroid polaroid--thumb';
  const tilt = tiltFromPhoto(photo);
  wrap.style.transform = `rotate(${tilt}deg)`;
  wrap.style.transformOrigin = 'center center';

  const photoWrap = document.createElement('div');
  photoWrap.className = 'polaroid__photo';
  const img = document.createElement('img');
  img.className = 'polaroid__img';
  img.src = photo.thumbUrl || photo.imageUrl;
  img.alt = '';
  img.loading = eager ? 'eager' : 'lazy';
  applyImageFocus(img, photo.direction);
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
  photos.forEach((p, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'album-item';
    btn.appendChild(buildAlbumPolaroid(p, { eager: index === 0 }));
    btn.addEventListener('click', () => expandPhoto(btn, p));
    els.albumList.appendChild(btn);
  });
}

function cancelRushRaf() {
  if (expandedState?.rushRafId != null) {
    cancelAnimationFrame(expandedState.rushRafId);
    expandedState.rushRafId = null;
  }
}

function clearCollapseTimer() {
  if (expandedState?.collapseTimerId != null) {
    clearTimeout(expandedState.collapseTimerId);
    expandedState.collapseTimerId = null;
  }
}

/** If a click-close was in progress, stop it so scroll-rush can take over. */
function interruptClickCollapseForRush() {
  if (!expandedState?.collapseTimerId) return;
  clearCollapseTimer();
  els.expandLayer.classList.remove('expand-layer--backdrop-out');
  expandedState.polaroid.style.transition = 'none';
}

function finishCollapse() {
  if (!expandedState) return;
  cancelRushRaf();
  clearCollapseTimer();
  const { polaroid, placeholder, btn, tilt, thumbSrc, photo } = expandedState;
  polaroid.removeEventListener('click', onExpandedPolaroidClick);
  const img = polaroid.querySelector('img');
  if (img && thumbSrc) {
    img.src = thumbSrc;
    applyImageFocus(img, photo.direction);
  }

  els.expandLayer.classList.add('hidden');
  els.expandLayer.setAttribute('aria-hidden', 'true');
  els.expandLayer.classList.remove('expand-layer--backdrop-out');

  polaroid.remove();
  polaroid.removeAttribute('style');
  polaroid.style.transform = `rotate(${tilt}deg)`;
  polaroid.style.transformOrigin = 'center center';
  btn.insertBefore(polaroid, placeholder);
  placeholder.remove();

  expandedState = null;
}

/** Instant teardown (e.g. dev reset) so we do not orphan nodes mid-transition. */
function abortExpandInstant() {
  if (!expandedState) return;
  cancelRushRaf();
  clearCollapseTimer();
  const { polaroid, placeholder, btn, tilt, thumbSrc, photo } = expandedState;
  polaroid.removeEventListener('click', onExpandedPolaroidClick);
  polaroid.style.transition = 'none';
  const img = polaroid.querySelector('img');
  if (img && thumbSrc) {
    img.src = thumbSrc;
    applyImageFocus(img, photo.direction);
  }
  polaroid.removeAttribute('style');
  polaroid.style.transform = `rotate(${tilt}deg)`;
  polaroid.style.transformOrigin = 'center center';
  btn.insertBefore(polaroid, placeholder);
  placeholder.remove();
  els.expandLayer.classList.remove('expand-layer--backdrop-out');
  els.expandLayer.classList.add('hidden');
  els.expandLayer.setAttribute('aria-hidden', 'true');
  expandedState = null;
}

function expandPhoto(btn, photo) {
  if (expandedState || loadLock) return;
  const polaroid = btn.querySelector('.polaroid');
  if (!polaroid) return;

  const tilt = tiltFromPhoto(photo);
  const ow = polaroid.offsetWidth;
  const oh = polaroid.offsetHeight;
  const br = polaroid.getBoundingClientRect();
  const placeholder = document.createElement('div');
  placeholder.className = 'album-item__placeholder';
  placeholder.style.width = `${br.width}px`;
  placeholder.style.height = `${br.height}px`;
  placeholder.setAttribute('aria-hidden', 'true');

  btn.insertBefore(placeholder, polaroid);
  polaroid.remove();
  els.expandLayer.appendChild(polaroid);

  const img = polaroid.querySelector('img');
  const thumbSrc = img?.src || '';

  const cx0 = br.left + br.width / 2;
  const cy0 = br.top + br.height / 2;

  const pad = 16;
  const maxW = window.innerWidth - pad * 2;
  const maxH = window.innerHeight - pad * 2;
  const ar = oh / ow;
  let finalW = maxW;
  let finalH = finalW * ar;
  if (finalH > maxH) {
    finalH = maxH;
    finalW = finalH / ar;
  }

  const cx1 = window.innerWidth / 2;
  const cy1 = window.innerHeight / 2;

  polaroid.style.position = 'fixed';
  polaroid.style.left = `${cx0}px`;
  polaroid.style.top = `${cy0}px`;
  polaroid.style.width = `${ow}px`;
  polaroid.style.height = `${oh}px`;
  polaroid.style.margin = '0';
  polaroid.style.zIndex = '2';
  polaroid.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
  polaroid.style.transformOrigin = 'center center';
  polaroid.style.transition = 'none';
  polaroid.style.boxSizing = 'border-box';

  if (img) {
    img.src = photo.imageUrl;
    applyImageFocus(img, photo.direction);
  }

  els.expandLayer.classList.remove('expand-layer--backdrop-out', 'hidden');
  els.expandLayer.setAttribute('aria-hidden', 'false');
  expandedState = {
    polaroid,
    placeholder,
    btn,
    tilt,
    thumbSrc,
    ow,
    oh,
    rushRotDeg: 0,
    collapseTimerId: null,
    rushRafId: null,
    expandScrollTop: els.albumScroll.scrollTop,
    photo,
  };

  polaroid.addEventListener('click', onExpandedPolaroidClick);

  void polaroid.offsetHeight;
  requestAnimationFrame(() => {
    polaroid.style.transition = TRANS_EXPAND;
    polaroid.style.left = `${cx1}px`;
    polaroid.style.top = `${cy1}px`;
    polaroid.style.width = `${finalW}px`;
    polaroid.style.height = `${finalH}px`;
    polaroid.style.transform = 'translate(-50%, -50%) rotate(0deg)';
  });
}

function onExpandedPolaroidClick(e) {
  e.stopPropagation();
  collapseFromClick();
}

/** Backdrop fades while the card eases back (tap / backdrop / Escape). */
function collapseFromClick() {
  if (!expandedState) return;
  cancelRushRaf();
  clearCollapseTimer();

  const st = expandedState;
  const sr = st.placeholder.getBoundingClientRect();
  const cx = sr.left + sr.width / 2;
  const cy = sr.top + sr.height / 2;

  els.expandLayer.classList.remove('expand-layer--backdrop-out');
  void els.expandLayer.offsetHeight;
  els.expandLayer.classList.add('expand-layer--backdrop-out');

  st.polaroid.style.transition = TRANS_EXPAND;
  st.polaroid.style.left = `${cx}px`;
  st.polaroid.style.top = `${cy}px`;
  st.polaroid.style.width = `${st.ow}px`;
  st.polaroid.style.height = `${st.oh}px`;
  st.polaroid.style.transform = `translate(-50%, -50%) rotate(${st.tilt}deg)`;

  st.collapseTimerId = setTimeout(() => finishCollapse(), COLLAPSE_CLICK_MS);
}

function rushStep() {
  if (!expandedState) return;
  const st = expandedState;
  st.rushRafId = null;

  const sr = st.placeholder.getBoundingClientRect();
  const tcx = sr.left + sr.width / 2;
  const tcy = sr.top + sr.height / 2;
  const tw = st.ow;
  const th = st.oh;
  const { tilt, polaroid } = st;

  const pr = polaroid.getBoundingClientRect();
  let cx = pr.left + pr.width / 2;
  let cy = pr.top + pr.height / 2;
  let w = pr.width;
  let h = pr.height;

  const k = RUSH_LERP;
  cx += (tcx - cx) * k;
  cy += (tcy - cy) * k;
  w += (tw - w) * k;
  h += (th - h) * k;
  st.rushRotDeg += (tilt - st.rushRotDeg) * k;

  polaroid.style.transition = 'none';
  polaroid.style.left = `${cx}px`;
  polaroid.style.top = `${cy}px`;
  polaroid.style.width = `${w}px`;
  polaroid.style.height = `${h}px`;
  polaroid.style.transform = `translate(-50%, -50%) rotate(${st.rushRotDeg}deg)`;

  const dist = Math.hypot(tcx - cx, tcy - cy);
  if (
    dist < RUSH_DONE_DIST &&
    Math.abs(w - tw) < RUSH_DONE_SIZE &&
    Math.abs(h - th) < RUSH_DONE_SIZE &&
    Math.abs(st.rushRotDeg - tilt) < RUSH_DONE_ROT
  ) {
    polaroid.style.left = `${tcx}px`;
    polaroid.style.top = `${tcy}px`;
    polaroid.style.width = `${tw}px`;
    polaroid.style.height = `${th}px`;
    polaroid.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
    st.rushRotDeg = tilt;
    finishCollapse();
    return;
  }

  st.rushRafId = requestAnimationFrame(rushStep);
}

function kickRushHome() {
  if (!expandedState) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    interruptClickCollapseForRush();
    const st = expandedState;
    if (!st) return;
    const sr = st.placeholder.getBoundingClientRect();
    const cx = sr.left + sr.width / 2;
    const cy = sr.top + sr.height / 2;
    st.polaroid.style.transition = 'none';
    st.polaroid.style.left = `${cx}px`;
    st.polaroid.style.top = `${cy}px`;
    st.polaroid.style.width = `${st.ow}px`;
    st.polaroid.style.height = `${st.oh}px`;
    st.polaroid.style.transform = `translate(-50%, -50%) rotate(${st.tilt}deg)`;
    finishCollapse();
    return;
  }
  interruptClickCollapseForRush();
  if (expandedState.rushRafId == null) {
    expandedState.rushRafId = requestAnimationFrame(rushStep);
  }
}

function onAlbumScroll() {
  if (!expandedState) return;
  const delta = Math.abs(els.albumScroll.scrollTop - expandedState.expandScrollTop);
  if (delta >= SCROLL_AWAY_TO_COLLAPSE_PX) {
    collapseFromClick();
    return;
  }
  kickRushHome();
}

async function onCameraActivate() {
  if (loadLock || isCooldownActive() || !currentCreature || gameState === 'taking_picture') return;
  await unlockAudio();

  if (gameState === 'camera_unfocused') {
    await playFocusSound();
    gameState = 'camera_focused';
    setFocused(true);
    return;
  }

  if (gameState === 'camera_focused') {
    gameState = 'taking_picture';
    setCameraPrinting(true);
    loadLock = true;

    triggerShutterFlash();
    await playShutterSound();
    void playPrintSound();

    try {
      const nextExclude = [...getPhotographedCreatureIds(), currentCreature.creature.id];
      void preloadNextRound(nextExclude);
      const albumPreload = preloadAlbumModalImagesForCapture(currentCreature);
      await Promise.all([
        runPrintEmergence(
          currentCreature.fullUrl,
          currentCreature.creature.name,
          currentCreature.creature.direction
        ),
        albumPreload,
      ]);

      const photo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        creatureId: currentCreature.creature.id,
        animalName: currentCreature.creature.name,
        imageUrl: currentCreature.fullUrl,
        thumbUrl: currentCreature.thumbUrl,
        tiltDeg: randomTiltDeg(),
        takenAt: new Date().toISOString(),
      };
      if (currentCreature.creature.direction) {
        photo.direction = currentCreature.creature.direction;
      }
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

function devSkipCountdown() {
  clearCooldown();
  updateAlbumCountdown();
  if (gameState !== 'waiting') return;
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  abortExpandInstant();
  setLastBackgroundUrl('');
  setPhaseCamera();
  void beginRound();
}

async function devResetGame() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
  abortExpandInstant();
  invalidatePreloads();
  hidePrintStage();
  setLoadError(false);
  clearCooldown();
  clearPhotos();
  setLastBackgroundUrl('');
  renderAlbumList();
  updateAlbumCountdown();
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
      void preloadNextRound();
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

  els.expandBackdrop.addEventListener('click', () => {
    collapseFromClick();
  });

  els.albumScroll.addEventListener('scroll', onAlbumScroll, { passive: true });

  els.expandLayer.addEventListener(
    'wheel',
    (e) => {
      if (!expandedState) return;
      e.preventDefault();
      els.albumScroll.scrollTop += e.deltaY;
    },
    { passive: false }
  );

  els.expandLayer.addEventListener(
    'touchstart',
    (e) => {
      if (!expandedState) return;
      touchScrollLastY = e.touches[0].clientY;
    },
    { passive: true }
  );

  els.expandLayer.addEventListener(
    'touchmove',
    (e) => {
      if (!expandedState || touchScrollLastY == null) return;
      const y = e.touches[0].clientY;
      const dy = touchScrollLastY - y;
      touchScrollLastY = y;
      e.preventDefault();
      els.albumScroll.scrollTop += dy;
    },
    { passive: false }
  );

  els.expandLayer.addEventListener('touchend', () => {
    touchScrollLastY = null;
  });

  els.expandLayer.addEventListener('touchcancel', () => {
    touchScrollLastY = null;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expandedState) {
      e.preventDefault();
      collapseFromClick();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      void devResetGame();
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyT') {
      e.preventDefault();
      devSkipCountdown();
    }
  });
}

bootstrap();
