/** Simple camera-style cues via Web Audio (no external files). */

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
}

/** Autofocus / lens motor-ish: short rising tones */
export function playFocusSound() {
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

/** Shutter: noise burst + soft thump */
export function playShutterSound() {
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
