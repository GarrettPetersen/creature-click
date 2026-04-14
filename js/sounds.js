/** Camera sounds: prefer files in /sounds/, fall back to Web Audio where noted. */

const SOUNDS = {
  beep: 'sounds/beep.mp3',
  focus: 'sounds/focus.ogg',
  shutter: 'sounds/shutter.ogg',
  print: 'sounds/instant_camera_print.mp3',
};

/** @type {Record<string, HTMLAudioElement | null>} */
const cache = {};

function soundUrl(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

/**
 * @param {keyof typeof SOUNDS} key
 * @returns {HTMLAudioElement | null}
 */
function getClip(key) {
  if (cache[key] !== undefined) return cache[key];
  const path = SOUNDS[key];
  if (!path) {
    cache[key] = null;
    return null;
  }
  const audio = new Audio(soundUrl(path));
  audio.preload = 'auto';
  cache[key] = audio;
  return audio;
}

/**
 * @param {keyof typeof SOUNDS} key
 */
async function playFile(key, volume = 1) {
  const base = getClip(key);
  if (!base) return false;
  const a = base.cloneNode(true);
  a.volume = Math.min(1, Math.max(0, volume));
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

let ctx = null;

function getCtx() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

export async function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') await c.resume();
  getClip('beep');
  getClip('focus');
  getClip('shutter');
  getClip('print');
}

/** State (1): entering unfocused camera view */
export async function playBeepUnfocused() {
  if (await playFile('beep', 0.85)) return;
  playSynthBeep();
}

function playSynthBeep() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}

/** Focus sound — file or rising tones */
export async function playFocusSound() {
  if (await playFile('focus', 0.9)) return;
  playSynthFocus();
}

function playSynthFocus() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const mkBeep = (freq, t0, dur) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };
  mkBeep(880, now, 0.06);
  mkBeep(1320, now + 0.07, 0.08);
}

/** Shutter — file or noise burst */
export async function playShutterSound() {
  if (await playFile('shutter', 0.95)) return;
  playSynthShutter();
}

function playSynthShutter() {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const dur = 0.14;
  const bufferSize = c.sampleRate * dur;
  const noiseBuffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.7;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.35, now + 0.008);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  noise.connect(band);
  band.connect(ng);
  ng.connect(c.destination);
  noise.start(now);
  noise.stop(now + dur);

  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(g2);
  g2.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

/** Instant print motor — file only (long); no small fallback */
export async function playPrintSound() {
  await playFile('print', 1);
}
