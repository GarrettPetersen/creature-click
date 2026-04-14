import { loadCatalog, pickRandomAnimal } from './catalog.js';
import {
  COOLDOWN_MS,
  getCooldownUntil,
  setCooldownUntil,
  getPhotos,
  addPhoto,
} from './storage.js';
import { unlockAudio, playFocusSound, playShutterSound } from './sounds.js';

const els = {
  cooldownPanel: document.getElementById('cooldown-panel'),
  playPanel: document.getElementById('play-panel'),
  cooldownRemaining: document.getElementById('cooldown-remaining'),
  viewfinder: document.getElementById('viewfinder'),
  creatureImg: document.getElementById('creature-img'),
  phaseHint: document.getElementById('phase-hint'),
  animalLabel: document.getElementById('animal-label'),
  newCreatureBtn: document.getElementById('new-creature-btn'),
  loadError: document.getElementById('load-error'),
  collectionEmpty: document.getElementById('collection-empty'),
  collectionGrid: document.getElementById('collection-grid'),
};

/** @type {'blurred' | 'focused' | 'snapped'} */
let phase = 'blurred';
let currentCreature = null;
let cooldownTimer = null;
let loadLock = false;

function formatWait(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return 'less than a minute';
  const min = Math.ceil(sec / 60);
  if (min === 60) return 'about one hour';
  if (min > 60) {
    const h = Math.floor(min / 60);
    const r = min % 60;
    if (r === 0) return `${h} hour${h === 1 ? '' : 's'}`;
    return `${h} hour${h === 1 ? '' : 's'} and ${r} minute${r === 1 ? '' : 's'}`;
  }
  return `${min} minute${min === 1 ? '' : 's'}`;
}

function isCooldownActive() {
  return Date.now() < getCooldownUntil();
}

function showCooldownUI() {
  els.cooldownPanel.classList.remove('hidden');
  els.playPanel.classList.add('hidden');
  updateCooldownLabel();
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    if (!isCooldownActive()) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      showPlayUI();
      beginRound();
      return;
    }
    updateCooldownLabel();
  }, 1000);
}

function updateCooldownLabel() {
  const until = getCooldownUntil();
  const left = until - Date.now();
  els.cooldownRemaining.textContent = formatWait(left);
}

function showPlayUI() {
  els.cooldownPanel.classList.add('hidden');
  els.playPanel.classList.remove('hidden');
}

function setLoadError(message) {
  if (!message) {
    els.loadError.classList.add('hidden');
    els.loadError.textContent = '';
    return;
  }
  els.loadError.textContent = message;
  els.loadError.classList.remove('hidden');
}

function shufflePhaseUI() {
  els.viewfinder.classList.remove('is-focused');
  els.phaseHint.textContent = 'Tap the picture to focus your camera.';
  els.animalLabel.classList.add('hidden');
  els.animalLabel.textContent = '';
  els.newCreatureBtn.classList.remove('hidden');
  phase = 'blurred';
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
  setLoadError('');
  els.creatureImg.removeAttribute('src');
  currentCreature = null;
  shufflePhaseUI();
  els.newCreatureBtn.disabled = true;
  try {
    const data = pickAnimalPayload(null);
    currentCreature = data;
    els.creatureImg.alt = `${data.creature.name} — out of focus`;
    els.creatureImg.src = data.fullUrl;
    await els.creatureImg.decode().catch(() => {});
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : 'Something went wrong.');
  } finally {
    loadLock = false;
    els.newCreatureBtn.disabled = false;
  }
}

async function swapCreature() {
  if (phase !== 'blurred' || !currentCreature || loadLock) return;
  loadLock = true;
  setLoadError('');
  els.newCreatureBtn.disabled = true;
  const excludeId = currentCreature.creature.id;
  try {
    const data = pickAnimalPayload(excludeId);
    currentCreature = data;
    els.creatureImg.alt = `${data.creature.name} — out of focus`;
    els.creatureImg.src = data.fullUrl;
    await els.creatureImg.decode().catch(() => {});
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : 'Something went wrong.');
  } finally {
    loadLock = false;
    els.newCreatureBtn.disabled = false;
  }
}

function renderCollection() {
  const photos = getPhotos();
  els.collectionEmpty.classList.toggle('hidden', photos.length > 0);
  els.collectionGrid.replaceChildren();
  for (const p of photos) {
    const li = document.createElement('li');
    li.className = 'collection-item';
    const wrap = document.createElement('div');
    wrap.className = 'collection-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'collection-thumb';
    img.src = p.thumbUrl || p.imageUrl;
    img.alt = p.animalName;
    img.width = 200;
    img.height = 200;
    img.loading = 'lazy';
    wrap.appendChild(img);
    const cap = document.createElement('p');
    cap.className = 'collection-caption';
    cap.textContent = p.animalName;
    li.appendChild(wrap);
    li.appendChild(cap);
    els.collectionGrid.appendChild(li);
  }
}

async function onViewfinderActivate() {
  if (loadLock || isCooldownActive() || !currentCreature) return;
  await unlockAudio();

  if (phase === 'blurred') {
    playFocusSound();
    phase = 'focused';
    els.viewfinder.classList.add('is-focused');
    els.phaseHint.textContent = 'Tap again to take the picture!';
    els.creatureImg.alt = `${currentCreature.creature.name} — in focus`;
    els.newCreatureBtn.classList.add('hidden');
    return;
  }

  if (phase === 'focused') {
    playShutterSound();
    phase = 'snapped';
    const photo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      animalName: currentCreature.creature.name,
      imageUrl: currentCreature.fullUrl,
      thumbUrl: currentCreature.thumbUrl,
      takenAt: new Date().toISOString(),
    };
    addPhoto(photo);
    renderCollection();
    els.animalLabel.textContent = `You photographed a ${currentCreature.creature.name}!`;
    els.animalLabel.classList.remove('hidden');
    els.phaseHint.textContent = 'Nice shot! Your camera needs a long rest.';
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    setTimeout(() => {
      showCooldownUI();
    }, 2200);
  }
}

async function bootstrap() {
  try {
    await loadCatalog();
  } catch (e) {
    setLoadError(e instanceof Error ? e.message : 'Could not load animals.');
    els.playPanel.classList.add('hidden');
    els.cooldownPanel.classList.add('hidden');
    return;
  }

  renderCollection();
  if (isCooldownActive()) {
    showCooldownUI();
  } else {
    showPlayUI();
    beginRound();
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
}

els.viewfinder.tabIndex = 0;
els.viewfinder.setAttribute('role', 'button');
els.viewfinder.setAttribute(
  'aria-label',
  'Camera view — tap to focus, tap again to take a picture'
);

bootstrap();
