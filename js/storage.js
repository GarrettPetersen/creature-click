const PREFIX = 'creatureClick.v1';

export const COOLDOWN_MS = 60 * 60 * 1000;

export function getCooldownUntil() {
  const raw = localStorage.getItem(`${PREFIX}.cooldownUntil`);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export function setCooldownUntil(timestampMs) {
  localStorage.setItem(`${PREFIX}.cooldownUntil`, String(timestampMs));
}

export function getPhotos() {
  try {
    const raw = localStorage.getItem(`${PREFIX}.photos`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addPhoto(photo) {
  const photos = getPhotos();
  photos.unshift(photo);
  localStorage.setItem(`${PREFIX}.photos`, JSON.stringify(photos));
}
