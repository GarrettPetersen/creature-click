const STORAGE_REMOVE = 'creatureClick.cull.removeIds';
const STORAGE_FOCUS = 'creatureClick.cull.focusOverrides';

const FOCUS_POS = {
  left: 'left center',
  right: 'right center',
  up: 'center top',
  down: 'center bottom',
};

function fileFromCommonsTitle(title) {
  if (!title) return '';
  return title.replace(/^File:/i, '').trim();
}

function loadRemoveSet() {
  try {
    const raw = sessionStorage.getItem(STORAGE_REMOVE);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveRemoveSet(set) {
  sessionStorage.setItem(STORAGE_REMOVE, JSON.stringify([...set]));
}

/** @returns {Record<string, string | null>} */
function loadFocusOverrides() {
  try {
    const raw = sessionStorage.getItem(STORAGE_FOCUS);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function saveFocusOverrides(map) {
  sessionStorage.setItem(STORAGE_FOCUS, JSON.stringify(map));
}

function applyPreviewFocus(img, direction) {
  if (!img) return;
  const pos = direction && FOCUS_POS[direction];
  if (pos) img.style.objectPosition = pos;
  else img.style.removeProperty('object-position');
}

function effectiveDirection(animal, overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, animal.id)) {
    const v = overrides[animal.id];
    return v === null ? undefined : v;
  }
  return animal.direction;
}

function buildSourcesJson(animals, removeIds, overrides) {
  const kept = animals.filter((a) => !removeIds.has(a.id));
  return kept.map((a) => {
    const row = {
      name: a.name,
      file: fileFromCommonsTitle(a.commonsTitle),
    };
    let dir;
    if (Object.prototype.hasOwnProperty.call(overrides, a.id)) {
      const o = overrides[a.id];
      if (o === null) {
        /* omit */
      } else if (o) {
        dir = o;
      }
    } else if (a.direction) {
      dir = a.direction;
    }
    if (dir) row.direction = dir;
    return row;
  });
}

function updateStats(els, total, removeCount) {
  const keep = total - removeCount;
  els.stats.textContent = '';
  els.stats.append(
    document.createTextNode('Keeping '),
    Object.assign(document.createElement('strong'), { textContent: String(keep) }),
    document.createTextNode(', marking '),
    Object.assign(document.createElement('strong'), { textContent: String(removeCount) }),
    document.createTextNode(' to remove.')
  );
}

async function main() {
  const els = {
    list: document.getElementById('cull-list'),
    stats: document.getElementById('cull-stats'),
    msg: document.getElementById('cull-msg'),
    btnCopy: document.getElementById('cull-copy'),
    btnDownload: document.getElementById('cull-download'),
    btnClear: document.getElementById('cull-clear-checks'),
    btnClearFocus: document.getElementById('cull-clear-focus'),
  };

  let animals = [];
  try {
    const res = await fetch(new URL('../data/animals.json', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    animals = data.animals ?? [];
  } catch {
    els.list.innerHTML = `<p class="cull-error">Could not load data/animals.json. Open this page from the same site as the game (e.g. <code>wrangler dev</code> or your static server), not as a raw file.</p>`;
    return;
  }

  const removeIds = loadRemoveSet();
  let focusOverrides = loadFocusOverrides();

  for (const a of animals) {
    const card = document.createElement('article');
    card.className = 'cull-card';
    card.dataset.id = a.id;

    const img = document.createElement('img');
    img.className = 'cull-card__img';
    img.src = a.thumbUrl || a.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    applyPreviewFocus(img, effectiveDirection(a, focusOverrides));

    const body = document.createElement('div');
    body.className = 'cull-card__body';

    const nameEl = document.createElement('h2');
    nameEl.className = 'cull-card__name';
    nameEl.textContent = a.name;

    const fileEl = document.createElement('p');
    fileEl.className = 'cull-card__file';
    fileEl.textContent = fileFromCommonsTitle(a.commonsTitle);

    const focusLabel = document.createElement('p');
    focusLabel.className = 'cull-card__focus-label';
    focusLabel.textContent = 'Square crop — show more from:';

    const pad = document.createElement('div');
    pad.className = 'cull-focus-pad';

    const mkBtn = (label, dir, extraClass = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cull-focus-btn ${extraClass}`.trim();
      b.textContent = label;
      b.setAttribute('aria-label', dir === 'center' ? 'Center crop' : `Show more from ${dir}`);
      return b;
    };

    const centerBtn = mkBtn('⊙', 'center', 'cull-focus-btn--center');
    const upBtn = mkBtn('↑', 'up', 'cull-focus-btn--up');
    const leftBtn = mkBtn('←', 'left', 'cull-focus-btn--side');
    const rightBtn = mkBtn('→', 'right', 'cull-focus-btn--side');
    const downBtn = mkBtn('↓', 'down', 'cull-focus-btn--down');

    pad.append(upBtn);
    const mid = document.createElement('div');
    mid.className = 'cull-focus-pad__mid';
    mid.append(leftBtn, centerBtn, rightBtn);
    pad.append(mid, downBtn);

    function syncFocusButtons() {
      const eff = effectiveDirection(a, focusOverrides);
      [centerBtn, upBtn, leftBtn, rightBtn, downBtn].forEach((btn) => btn.classList.remove('is-active'));
      if (!eff) centerBtn.classList.add('is-active');
      else if (eff === 'up') upBtn.classList.add('is-active');
      else if (eff === 'down') downBtn.classList.add('is-active');
      else if (eff === 'left') leftBtn.classList.add('is-active');
      else if (eff === 'right') rightBtn.classList.add('is-active');
      applyPreviewFocus(img, eff);
    }

    function setDir(value) {
      focusOverrides[a.id] = value;
      saveFocusOverrides(focusOverrides);
      syncFocusButtons();
    }

    centerBtn.addEventListener('click', () => setDir(null));
    upBtn.addEventListener('click', () => setDir('up'));
    downBtn.addEventListener('click', () => setDir('down'));
    leftBtn.addEventListener('click', () => setDir('left'));
    rightBtn.addEventListener('click', () => setDir('right'));

    syncFocusButtons();

    const row = document.createElement('div');
    row.className = 'cull-card__row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `rm-${a.id}`;
    cb.checked = removeIds.has(a.id);
    cb.addEventListener('change', () => {
      if (cb.checked) removeIds.add(a.id);
      else removeIds.delete(a.id);
      saveRemoveSet(removeIds);
      updateStats(els, animals.length, removeIds.size);
    });
    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.textContent = 'Remove from catalog';
    row.append(cb, label);

    body.append(nameEl, fileEl, focusLabel, pad, row);
    card.append(img, body);
    els.list.appendChild(card);
  }

  const end = document.createElement('p');
  end.className = 'cull-end';
  end.textContent = 'End of catalog — use the bar below to export.';
  els.list.appendChild(end);

  updateStats(els, animals.length, removeIds.size);

  els.btnClear.addEventListener('click', () => {
    removeIds.clear();
    saveRemoveSet(removeIds);
    els.list.querySelectorAll('input[type="checkbox"]').forEach((c) => {
      c.checked = false;
    });
    updateStats(els, animals.length, 0);
    els.msg.textContent = 'All remove ticks cleared.';
  });

  els.btnClearFocus?.addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_FOCUS);
    location.reload();
  });

  const prettyJson = () =>
    JSON.stringify(buildSourcesJson(animals, removeIds, focusOverrides), null, 2) + '\n';

  els.btnDownload.addEventListener('click', () => {
    const blob = new Blob([prettyJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animal-sources.json';
    a.click();
    URL.revokeObjectURL(url);
    els.msg.textContent =
      'Downloaded animal-sources.json — replace scripts/animal-sources.json, then npm run verify:animals && npm run build:animals.';
  });

  els.btnCopy.addEventListener('click', async () => {
    const text = prettyJson();
    try {
      await navigator.clipboard.writeText(text);
      els.msg.textContent =
        'Copied to clipboard. Paste into scripts/animal-sources.json, then verify + build.';
    } catch {
      els.msg.textContent =
        'Clipboard failed. Use Download instead.';
    }
  });
}

main();
