// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL =
  "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443";
const SERVER = "http://localhost:3001";
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiNDcyMmEyZDYtNjZjZC00Mzk1LWIzY2QtMGQ1MDlkZDU3YmVkIiwicm9sZXMiOlsiVVNFUiJdfQ.KgwVbxM3zaG71O3eul9R3NVINhdeS180fvEYTlQEi3A";
const HEADERS = { "codinggame-id": TOKEN, "Content-Type": "application/json" };

// Délai en ms entre chaque flush des cellules modifiées
const SAVE_DEBOUNCE_MS = 1500;

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  ship: null,
  resources: {},
  gold: 0,
  quotient: 0,
  homeName: "—",
  movesLeft: "?",
  position: null,
  lastSavedPosition: null,
  shipLevel: null,
  discoveredIslands: [],
  cellMemory: new Map(),
  viewX: 0,
  viewY: 0,
  cellSize: 36,
  moving: false,
  nextStorageLevel: null,
  nextShipLevel: null,
  currentStorageLevel: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function api(method, path, body = null) {
  const opts = { method, headers: { ...HEADERS } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, opts);
  if (!res.ok) {
    let err;
    try {
      err = await res.json();
    } catch {
      err = { message: res.statusText };
    }
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP PERSISTENCE  (via serveur local localhost:3001)
// ─────────────────────────────────────────────────────────────────────────────

const _pendingCells = new Map();
let _flushTimer = null;

async function loadMapMemory() {
  try {
    const res = await fetch(`${SERVER}/map`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.cells) && data.cells.length > 0) {
      data.cells.forEach(cell => {
        state.cellMemory.set(`${cell.x},${cell.y}`, cell);
      });
    }
    if (data.position) {
      state.lastSavedPosition = data.position;
      state.position = data.position;
    }
    if (data.cells?.length > 0) {
      notify(`🗺️ Carte restaurée (${data.cells.length} cellules)`, "info");
    }
  } catch {
    // Serveur pas lancé → on continue sans persistance
  }
}

function saveMapMemory() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(async () => {
    const cells = Array.from(_pendingCells.values());
    _pendingCells.clear();
    try {
      await fetch(`${SERVER}/map`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells, position: state.position }),
      });
    } catch {
      // Silencieux – pas bloquant
    }
  }, 1500);
}

async function clearMapMemory() {
  try {
    await fetch(`${SERVER}/map`, { method: "DELETE" });
    state.cellMemory.clear();
    _pendingCells.clear();
    notify("🗑️ Carte réinitialisée", "info");
  } catch (e) {
    notify("Impossible de contacter le serveur : " + e.message, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
function notify(msg, type = "info") {
  const area = document.getElementById("notif-area");
  const el = document.createElement("div");
  el.className = `notif ${type}`;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS MAP
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");

// Offscreen canvas : fond + grille + cellules
// Double buffer : on dessine sur _back, on swape sur _front quand c'est prêt
const _front = document.createElement("canvas");
const _fctx  = _front.getContext("2d");
const _back  = document.createElement("canvas");
const _octx  = _back.getContext("2d");

let _staticDirty = true;
let _lastView = { px: null, py: null, vx: null, vy: null, cs: null, cells: 0, islands: 0 };

function markDirty() { _staticDirty = true; }

function _viewChanged() {
  const p = state.position;
  return (
    _lastView.px      !== p?.x                    ||
    _lastView.py      !== p?.y                    ||
    _lastView.vx      !== state.viewX             ||
    _lastView.vy      !== state.viewY             ||
    _lastView.cs      !== state.cellSize          ||
    _lastView.cells   !== state.cellMemory.size   ||
    _lastView.islands !== state.discoveredIslands.length
  );
}

function _snapView() {
  const p = state.position;
  _lastView = {
    px: p?.x, py: p?.y,
    vx: state.viewX, vy: state.viewY,
    cs: state.cellSize,
    cells: state.cellMemory.size,
    islands: state.discoveredIslands.length,
  };
}

function resizeCanvas() {
  const area = document.getElementById("map-area");
  const w = area.clientWidth;
  const h = area.clientHeight;
  canvas.width  = w;  canvas.height  = h;
  _front.width  = w;  _front.height  = h;
  _back.width   = w;  _back.height   = h;
  markDirty();
}

function worldToScreen(wx, wy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    sx: cx + (wx - (state.position?.x || 0)) * state.cellSize + state.viewX,
    sy: cy + (wy - (state.position?.y || 0)) * state.cellSize + state.viewY,
  };
}

function screenToWorld(sx, sy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    wx: Math.round(
      (sx - cx - state.viewX) / state.cellSize + (state.position?.x || 0),
    ),
    wy: Math.round(
      (sy - cy - state.viewY) / state.cellSize + (state.position?.y || 0),
    ),
  };
}

const CELL_COLORS = {
  SEA: { base: "#0d2a4a", border: "#1a4a7a" },
  SAND: { base: "#7a5c1e", border: "#a07830" },
  ROCKS: { base: "#3a3a4a", border: "#5a5a6a" },
};

const STATE_OVERLAYS = {
  VISITED: "rgba(74, 144, 184, 0.18)",
  SEEN: "rgba(100, 180, 220, 0.35)",
  KNOWN: "rgba(46, 160, 80, 0.35)",
};

// Gradient de fond mis en cache — recréé seulement si la taille change
let _bgGrad = null;
let _bgGradW = 0, _bgGradH = 0;

function _getBgGrad(W, H) {
  if (_bgGrad && _bgGradW === W && _bgGradH === H) return _bgGrad;
  _bgGrad = _octx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) / 1.2);
  _bgGrad.addColorStop(0, "#0d2240");
  _bgGrad.addColorStop(1, "#060d1a");
  _bgGradW = W; _bgGradH = H;
  return _bgGrad;
}

// ── Dessine fond + grille + cellules sur le back buffer ──────────────────────
function drawStaticLayer() {
  const W = _back.width;
  const H = _back.height;
  _octx.clearRect(0, 0, W, H);

  // Fond (gradient caché)
  _octx.fillStyle = _getBgGrad(W, H);
  _octx.fillRect(0, 0, W, H);

  const cs = state.cellSize;

  // Grille (un seul path groupé)
  if (cs >= 20) {
    _octx.strokeStyle = "rgba(26, 74, 122, 0.08)";
    _octx.lineWidth = 0.5;
    const offX = ((W/2 + state.viewX) % cs + cs) % cs;
    const offY = ((H/2 + state.viewY) % cs + cs) % cs;
    _octx.beginPath();
    for (let x = offX; x < W; x += cs) { _octx.moveTo(x, 0); _octx.lineTo(x, H); }
    for (let y = offY; y < H; y += cs) { _octx.moveTo(0, y); _octx.lineTo(W, y); }
    _octx.stroke();
  }

  const margin = cs * 2;

  const islandClaimMap = new Map();
  state.discoveredIslands.forEach(di => {
    if (di.island?.name) islandClaimMap.set(di.island.name, di.islandState);
  });

  // ── Batching : on groupe les cellules par couleur de fill ──────────────────
  // Buckets : { fillColor → [rects] }
  const buckets = new Map();
  // Overlays séparés (semi-transparents)
  const overlayBuckets = new Map();
  // Borders groupés par (color, width)
  const borderBuckets = new Map();

  const hw = cs / 2 - 0.5; // demi-largeur intérieure

  state.cellMemory.forEach((cell) => {
    const { sx, sy } = worldToScreen(cell.x, cell.y);
    if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) return;

    const x0 = sx - cs/2 + 0.5;
    const y0 = sy - cs/2 + 0.5;
    const w  = cs - 1;

    let fillColor, borderColor, borderWidth;
    if (cell.type === "SAND") {
      const claimState = cell.island?.name ? islandClaimMap.get(cell.island.name) : null;
      if      (claimState === "KNOWN")      { fillColor = "#2d6e1a"; borderColor = "#5dbd30"; borderWidth = 1.5; }
      else if (claimState === "DISCOVERED") { fillColor = "#7a6010"; borderColor = "#f0b429"; borderWidth = 1.5; }
      else                                  { fillColor = "#7a5c1e"; borderColor = "#a07830"; borderWidth = 0.5; }
    } else {
      const colors = CELL_COLORS[cell.type] || CELL_COLORS.SEA;
      fillColor = colors.base; borderColor = colors.border; borderWidth = 0.5;
    }

    // Fill bucket
    if (!buckets.has(fillColor)) buckets.set(fillColor, []);
    buckets.get(fillColor).push(x0, y0, w, w);

    // Overlay bucket (mer uniquement)
    if (cell.type !== "SAND" && cell.stateEnum && STATE_OVERLAYS[cell.stateEnum]) {
      const oc = STATE_OVERLAYS[cell.stateEnum];
      if (!overlayBuckets.has(oc)) overlayBuckets.set(oc, []);
      overlayBuckets.get(oc).push(x0, y0, w, w);
    }

    // Border bucket
    const bk = `${borderColor}|${borderWidth}`;
    if (!borderBuckets.has(bk)) borderBuckets.set(bk, { color: borderColor, width: borderWidth, rects: [] });
    borderBuckets.get(bk).rects.push(x0, y0, w, w);
  });

  // ── Flush fills ────────────────────────────────────────────────────────────
  buckets.forEach((rects, color) => {
    _octx.fillStyle = color;
    for (let i = 0; i < rects.length; i += 4)
      _octx.fillRect(rects[i], rects[i+1], rects[i+2], rects[i+3]);
  });

  // ── Flush overlays ─────────────────────────────────────────────────────────
  overlayBuckets.forEach((rects, color) => {
    _octx.fillStyle = color;
    for (let i = 0; i < rects.length; i += 4)
      _octx.fillRect(rects[i], rects[i+1], rects[i+2], rects[i+3]);
  });

  // ── Flush borders (path groupé par couleur+width) ──────────────────────────
  borderBuckets.forEach(({ color, width, rects }) => {
    _octx.strokeStyle = color;
    _octx.lineWidth = width;
    _octx.beginPath();
    for (let i = 0; i < rects.length; i += 4) {
      const x = rects[i], y = rects[i+1], w = rects[i+2];
      _octx.rect(x, y, w, w);
    }
    _octx.stroke();
  });

  // Swap atomique : copie le back entièrement fini sur le front
  _fctx.clearRect(0, 0, _front.width, _front.height);
  _fctx.drawImage(_back, 0, 0);
}

// ── Boucle rAF : stamp offscreen + bateau animé ───────────────────────────────
let _glowGrad = null;
let _glowSx = null, _glowSy = null, _glowCs = null;

function drawMap() {
  // Layer statique : redessiné seulement si quelque chose a changé
  if (_staticDirty || _viewChanged()) {
    drawStaticLayer();
    _snapView();
    _staticDirty = false;
  }

  // Stamp du front buffer sur le canvas visible
  ctx.drawImage(_front, 0, 0);

  // Bateau animé (pulse)
  const cs = state.cellSize;
  if (state.position) {
    const { sx, sy } = worldToScreen(state.position.x, state.position.y);

    // Glow : recréé seulement si la position ou le zoom change
    if (_glowSx !== sx || _glowSy !== sy || _glowCs !== cs) {
      _glowGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, cs * 0.8);
      _glowGrad.addColorStop(0, "rgba(255, 215, 0, 0.4)");
      _glowGrad.addColorStop(1, "rgba(255, 215, 0, 0)");
      _glowSx = sx; _glowSy = sy; _glowCs = cs;
    }
    ctx.fillStyle = _glowGrad;
    ctx.fillRect(sx - cs, sy - cs, cs * 2, cs * 2);

    ctx.font = `${Math.floor(cs * 0.65)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⛵", sx, sy);

    const t = Date.now() / 600;
    const pulse = (Math.sin(t) + 1) / 2;
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.2 + pulse * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, cs * (0.55 + pulse * 0.15), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Coordonnées en haut à gauche
  if (state.position && cs >= 20) {
    ctx.font = "11px 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(140,180,220,0.5)";
    ctx.fillText(`x:${state.position.x} y:${state.position.y}`, 8, 8);
  }

  requestAnimationFrame(drawMap);
}

// Lance la boucle de rendu une seule fois
let _rafStarted = false;
function startRenderLoop() {
  if (_rafStarted) return;
  _rafStarted = true;
  requestAnimationFrame(drawMap);
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE CELLS IN MEMORY
// ─────────────────────────────────────────────────────────────────────────────
function mergeCells(cells, stateEnum = null) {
  let anyChanged = false;
  cells.forEach(cell => {
    const key = `${cell.x},${cell.y}`;
    const existing = state.cellMemory.get(key) || {};
    const newState = stateEnum || existing.stateEnum || "VISITED";
    const changed = !existing.type
      || existing.stateEnum !== newState
      || existing.ships?.length !== cell.ships?.length;
    const merged = { ...existing, ...cell, stateEnum: newState };
    state.cellMemory.set(key, merged);
    if (changed) { _pendingCells.set(key, merged); anyChanged = true; }
  });
  if (anyChanged) markDirty();
  if (_pendingCells.size > 0) saveMapMemory();
}

// ─────────────────────────────────────────────────────────────────────────────
// MOVEMENT
// ─────────────────────────────────────────────────────────────────────────────
const KEY_TO_DIR = {
  ArrowUp: "N",
  ArrowDown: "S",
  ArrowRight: "E",
  ArrowLeft: "W",
  w: "N",
  z: "N",
  s: "S",
  d: "E",
  a: "W",
  e: "NE",
  q: "NW",
  z: "SW",
  c: "SE",

};

// File d'attente des mouvements pendant qu'un appel est en cours
let _moveQueue = null;
let _cooldownUntil = 0; // timestamp de fin de cooldown

// ── Timer visuel dans la topbar ──────────────────────────────────────────────
let _timerRaf = null;
function _startCooldownTimer(ms) {
  _cooldownUntil = Date.now() + ms;
  const el = document.getElementById("movesLeft");
  if (!el) return;

  const tick = () => {
    const remaining = _cooldownUntil - Date.now();
    if (remaining > 0) {
      el.textContent = `⏳ ${(remaining / 1000).toFixed(1)}s`;
      _timerRaf = requestAnimationFrame(tick);
    } else {
      _timerRaf = null;
      el.textContent = state.movesLeft ?? "?";
    }
  };
  if (_timerRaf) cancelAnimationFrame(_timerRaf);
  _timerRaf = requestAnimationFrame(tick);
}

async function moveShip(direction) {
  if (state.movesLeft !== "?" && state.movesLeft !== undefined && state.movesLeft <= 0) return;

  // Bloqué si le cooldown n'est pas écoulé
  if (Date.now() < _cooldownUntil) return;

  // Si un appel API est déjà en cours, on mémorise le dernier demandé
  if (state.moving) {
    _moveQueue = direction;
    return;
  }
  state.moving = true;
  _moveQueue = null;

  const dirBtnMap = { N:"btn-N", S:"btn-S", E:"btn-E", W:"btn-W", NE:"btn-NE", NW:"btn-NW", SE:"btn-SE", SW:"btn-SW" };
  const btnEl = document.getElementById(dirBtnMap[direction]);
  if (btnEl) { btnEl.classList.add("active"); setTimeout(() => btnEl.classList.remove("active"), 250); }

  const t0 = Date.now();
  try {
    const data = await api("POST", "/ship/move", { direction });
    const elapsed = Date.now() - t0;
    state.position = data.position;
    state.movesLeft = data.energy;

    if (data.discoveredCells?.length) mergeCells(data.discoveredCells, "SEEN");
    if (data.position) mergeCells([data.position], "SEEN");

    updateHUD();

    // Démarre le timer bloquant si l'API a répondu trop vite
    const MIN_INTERVAL = 300;
    const wait = Math.max(0, MIN_INTERVAL - elapsed);
    if (wait > 0) _startCooldownTimer(wait);

  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  } finally {
    state.moving = false;
    // Exécuter le mouvement en attente seulement si le cooldown est passé
    if (_moveQueue && Date.now() >= _cooldownUntil) {
      const next = _moveQueue;
      _moveQueue = null;
      moveShip(next);
    }
  }
}

function centerView() {
  state.viewX = 0;
  state.viewY = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT EXPLORATEUR  — rayon 50 autour de (0, 0)
// ─────────────────────────────────────────────────────────────────────────────
const BOT_RADIUS  = 50;
const BOT_ORIGIN  = { x: 0, y: 0 };

const DIR_VECS = {
  N:  { x:  0, y: -1 }, S:  { x:  0, y:  1 },
  E:  { x:  1, y:  0 }, W:  { x: -1, y:  0 },
  NE: { x:  1, y: -1 }, NW: { x: -1, y: -1 },
  SE: { x:  1, y:  1 }, SW: { x: -1, y:  1 },
};

let _botRunning = false;
let _botStop    = false;

// Attend que le cooldown ET le flag moving soient libres
function _botWait() {
  return new Promise(resolve => {
    const check = () => {
      if (!state.moving && Date.now() >= _cooldownUntil) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

// BFS : chemin de `from` vers `to`, évite les rochers connus
function _bfs(from, to) {
  const key = (x, y) => `${x},${y}`;
  const queue = [{ x: from.x, y: from.y, path: [] }];
  const seen  = new Set([key(from.x, from.y)]);
  while (queue.length) {
    const cur = queue.shift();
    for (const [dir, v] of Object.entries(DIR_VECS)) {
      const nx = cur.x + v.x, ny = cur.y + v.y;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      seen.add(nk);
      const path = [...cur.path, dir];
      if (nx === to.x && ny === to.y) return path;
      const cell = state.cellMemory.get(nk);
      if (cell?.type === "ROCKS") continue;
      if (path.length < 120) queue.push({ x: nx, y: ny, path });
    }
  }
  return null;
}

// Cherche la cellule inexplorée la plus proche de la position courante,
// dans le rayon autour de BOT_ORIGIN
function _nearestUnexplored() {
  const pos = state.position;
  if (!pos) return null;
  let best = null, bestDist = Infinity;
  for (let dy = -BOT_RADIUS; dy <= BOT_RADIUS; dy++) {
    for (let dx = -BOT_RADIUS; dx <= BOT_RADIUS; dx++) {
      // Rayon circulaire autour de (0,0)
      if (dx * dx + dy * dy > BOT_RADIUS * BOT_RADIUS) continue;
      const x = BOT_ORIGIN.x + dx;
      const y = BOT_ORIGIN.y + dy;
      if (state.cellMemory.has(`${x},${y}`)) continue;
      // Distance Manhattan depuis la position actuelle du bateau
      const dist = Math.abs(x - pos.x) + Math.abs(y - pos.y);
      if (dist < bestDist) { bestDist = dist; best = { x, y }; }
    }
  }
  return best;
}

// Effectue UN déplacement via l'API (bypass moveShip pour ne pas interférer)
async function _botMove(direction) {
  const t0 = Date.now();
  const data = await api("POST", "/ship/move", { direction });
  const elapsed = Date.now() - t0;
  state.position = data.position;
  state.movesLeft = data.energy;
  if (data.discoveredCells?.length) mergeCells(data.discoveredCells, "SEEN");
  if (data.position) mergeCells([{ ...data.position, stateEnum: "SEEN" }], "SEEN");
  updateHUD();
  // Respecte le cooldown minimum
  const wait = Math.max(0, 350 - elapsed);
  if (wait > 0) {
    _startCooldownTimer(wait);
    await new Promise(r => setTimeout(r, wait));
  }
}

async function startBot() {
  if (_botRunning) return;
  _botRunning = true;
  _botStop    = false;
  notify("🤖 Bot démarré — exploration rayon 50 autour de (0,0)", "info");
  updateBotBtn();

  try {
    while (!_botStop) {
      if (state.movesLeft !== "?" && state.movesLeft <= 0) {
        notify("⚡ Plus de mouvements — bot en pause", "info");
        break;
      }

      const target = _nearestUnexplored();
      if (!target) {
        notify("✅ Zone entièrement explorée !", "success");
        break;
      }

      const path = _bfs(state.position, target);
      if (!path) {
        // Cible inaccessible : on la marque comme connue pour éviter la boucle
        state.cellMemory.set(`${target.x},${target.y}`, { x: target.x, y: target.y, type: "SEA", stateEnum: "SEEN" });
        continue;
      }

      for (const dir of path) {
        if (_botStop) break;
        await _botWait();
        try {
          await _botMove(dir);
        } catch (e) {
          notify(`❌ Bot : ${e.message}`, "error");
          _botStop = true;
          break;
        }
      }
    }
  } finally {
    _botRunning = false;
    _botStop    = false;
    updateBotBtn();
    if (!_botStop) notify("🤖 Bot arrêté", "info");
  }
}

function stopBot() {
  _botStop = true;
  notify("⏹ Arrêt du bot demandé…", "info");
  updateBotBtn();
}

function updateBotBtn() {
  const btn = document.getElementById("botBtn");
  if (!btn) return;
  if (_botRunning) {
    btn.textContent = "⏹ Stopper le bot";
    btn.style.borderColor = "rgba(192,57,43,0.6)";
    btn.onclick = stopBot;
  } else {
    btn.textContent = "🤖 Lancer le bot";
    btn.style.borderColor = "rgba(74,144,184,0.4)";
    btn.onclick = startBot;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD UPDATES
// ─────────────────────────────────────────────────────────────────────────────
// Met à jour un élément du DOM uniquement si la valeur est définie
function setEl(id, value) {
  if (value === undefined || value === null) return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmt(n) {
  if (n === undefined || n === null) return null;
  return n.toLocaleString("fr-FR");
}

function updateHUD() {
  if (state.movesLeft !== undefined) setEl("movesLeft", state.movesLeft);

  // ✅ NOUVEAU : affichage quantité / max
  ["BOISIUM", "FERONIUM", "CHARBONIUM"].forEach((type) => {
    const qty = state.resources[type];
    const max = state.currentStorageLevel?.maxResources?.[type];

    if (qty !== undefined) {
      const text = max
        ? `${fmt(qty)} / ${fmt(max)}`
        : fmt(qty);

      setEl(`qty-${type}`, text);
    }
  });

  if (state.gold !== undefined)
    setEl("currentGold", fmt(state.gold) + " 💰");

  if (state.homeName !== undefined)
    setEl("homeName", state.homeName);

  // ⚠️ Tu peux garder ou supprimer ce bloc (inutile maintenant)
  /*
  const cur = state.currentStorageLevel;
  if (cur?.maxResources) {
    setEl("max-BOISIUM", fmt(cur.maxResources.BOISIUM));
    setEl("max-FERONIUM", fmt(cur.maxResources.FERONIUM));
    setEl("max-CHARBONIUM", fmt(cur.maxResources.CHARBONIUM));
  }
  */

  // Production
  const BASE = 10;
  const qMult = 1 + (state.quotient || 0) / 100;
  const totalProd = state.discoveredIslands
    .filter((d) => d.islandState === "KNOWN")
    .reduce(
      (sum, d) =>
        sum +
        Math.round(
          BASE *
            qMult *
            (1 + (d.island?.bonusQuotient || 0) / 100)
        ),
      0
    );

  const prodEl = document.getElementById("prod-FERONIUM");
  if (prodEl)
    prodEl.textContent =
      totalProd > 0 ? `+${fmt(totalProd)}/min` : "";

  renderStorageUpgrade();
  renderShipUpgrade();
  renderIslands();
}


function renderStorageUpgrade() {
  const nl = state.nextStorageLevel;
  if (!nl) return; // pas de données → on ne touche pas au DOM
  setEl("storageName", nl.name || "—");
  const costEl = document.getElementById("upgrade-cost");
  if (!costEl) return;
  costEl.innerHTML = "";
  const cost = nl.costResources || {};
  ["FERONIUM", "BOISIUM", "CHARBONIUM"].forEach((r) => {
    if (!cost[r]) return;
    const have = state.resources[r] || 0;
    const ok = have >= cost[r];
    const d = document.createElement("div");
    d.className = `cost-line ${ok ? "affordable" : "expensive"}`;
    d.innerHTML = `<span>${r}</span><span>${fmt(cost[r])}</span>`;
    costEl.appendChild(d);
  });
}

function renderShipUpgrade() {
  const nl = state.nextShipLevel;
  if (!nl) return; // pas de données → on ne touche pas au DOM
  const lvl = nl.level || nl;
  setEl("boatName", lvl.name || "—");
  const costEl = document.getElementById("upgrade-ship-cost");
  if (!costEl) return;
  costEl.innerHTML = "";
  const cost = nl.costResources || {};
  ["FERONIUM", "BOISIUM", "CHARBONIUM"].forEach((r) => {
    if (!cost[r]) return;
    const have = state.resources[r] || 0;
    const ok = have >= cost[r];
    const d = document.createElement("div");
    d.className = `cost-line ${ok ? "affordable" : "expensive"}`;
    d.innerHTML = `<span>${r}</span><span>${fmt(cost[r])}</span>`;
    costEl.appendChild(d);
  });
}

function renderIslands() {
  const section = document.getElementById("islands-section");
  if (!section || !state.discoveredIslands.length) return;
  section.innerHTML = "";

  const BASE = 10;
  const qMult = 1 + (state.quotient || 0) / 100;

  state.discoveredIslands.forEach((di) => {
    const bonus = di.island?.bonusQuotient || 0;
    const prod = di.islandState === "KNOWN"
      ? Math.round(BASE * qMult * (1 + bonus / 100))
      : null;

    const d = document.createElement("div");
    d.className = "island-item";
    d.innerHTML = `
      <span>🏝 ${di.island?.name || "?"}</span>
      <span style="display:flex;align-items:center;gap:6px">
        ${prod !== null
          ? `<span style="font-size:0.72rem;color:#5dade2">+${prod}/min</span>`
          : `<span style="font-size:0.72rem;color:var(--text-muted)">${bonus > 0 ? `+${bonus}%` : "—"}</span>`
        }
        <span class="island-state ${di.islandState}">${di.islandState}</span>
      </span>`;
    section.appendChild(d);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD PLAYER DATA
// ─────────────────────────────────────────────────────────────────────────────
async function loadPlayerDetails() {
  const details = await api("GET", "/players/details");

  state.gold = details.money;
  state.homeName = details.home?.name || "—";
  state.discoveredIslands = details.discoveredIslands || [];

  // ✅ AJOUT IMPORTANT
  state.currentStorageLevel = details.storage;

  if (details.resources) {
    details.resources.forEach((r) => {
      state.resources[r.type] = r.quantity;
    });
  }
}

async function loadResources() {
  const res = await api("GET", "/resources");
  res.forEach((r) => {
    state.resources[r.type] = r.quantity;
  });
}

async function loadShipInfo() {
  // Try to get ship details from /players/details or build a ship
  try {
    const details = await api("GET", "/players/details");
    // We need to get the ship's current state by trying a move with dummy…
    // Actually we use /ship/next-level for upgrade info
  } catch {}
}

async function loadNextLevels() {
  try {
    state.nextStorageLevel = await api("GET", "/storage/next-level");
  } catch {}
  try {
    state.nextShipLevel = await api("GET", "/ship/next-level");
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKETPLACE
// ─────────────────────────────────────────────────────────────────────────────
async function loadOffers() {
  try {
    const offers = await api("GET", "/marketplace/offers");
    renderOffers(offers);
  } catch (e) {
    notify(`Marketplace: ${e.message}`, "error");
  }
}

function renderOffers(offers) {
  const panel = document.getElementById("offers-panel");
  panel.innerHTML = "";
  if (!offers?.length) {
    panel.innerHTML = `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:8px">Aucune offre</p>`;
    return;
  }
  offers.slice(0, 10).forEach((offer) => {
    const maxQty = offer.quantityIn;
    const ppu = offer.pricePerResource;
    const d = document.createElement("div");
    d.className = "offer-card";
    d.innerHTML = `
      <div class="offer-type">${offer.resourceType}</div>
      <div class="offer-details">Dispo: <strong>${fmt(maxQty)}</strong> | Par: ${offer.owner?.name || "?"}</div>
      <div class="offer-details">${ppu} 💰/u</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <input
          type="number"
          class="qty-input"
          min="1" max="${maxQty}" value="${Math.min(100, maxQty)}"
          style="width:70px;background:rgba(255,255,255,0.06);border:1px solid var(--panel-border);
                 color:var(--text-light);border-radius:4px;padding:3px 6px;font-size:0.82rem;"
        />
        <span class="price-estimate" style="color:var(--gold);font-size:0.82rem;font-family:'Cinzel',serif">
          = ${fmt(Math.min(100, maxQty) * ppu)} 💰
        </span>
      </div>
      <button class="btn btn-buy" style="margin-top:6px" data-id="${offer.id}" data-ppu="${ppu}" data-max="${maxQty}">
        Acheter
      </button>`;
    panel.appendChild(d);

    // Mise à jour du prix en temps réel
    const input = d.querySelector(".qty-input");
    const estimate = d.querySelector(".price-estimate");
    const btn = d.querySelector(".btn-buy");

    input.addEventListener("input", () => {
      let qty = parseInt(input.value) || 0;
      qty = Math.max(1, Math.min(qty, maxQty));
      estimate.textContent = `= ${fmt(qty * ppu)} 💰`;
    });

    btn.addEventListener("click", async () => {
      let qty = parseInt(input.value) || 0;
      qty = Math.max(1, Math.min(qty, maxQty));
      if (!qty) return;
      try {
        await api("POST", "/marketplace/purchases", {
          offerId: offer.id,
          quantity: qty,
        });
        notify(
          `✅ Acheté ${fmt(qty)} ${offer.resourceType} pour ${fmt(qty * ppu)} 💰`,
          "success",
        );
        await loadResources();
        updateHUD();
        loadOffers();
      } catch (e) {
        notify(`❌ ${e.message}`, "error");
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADES
// ─────────────────────────────────────────────────────────────────────────────
async function upgradeStorage() {
  if (!state.nextStorageLevel) return;
  try {
    await api("PUT", "/storage/upgrade");
    notify("✅ Entrepôt amélioré !", "success");
    await loadResources();
    state.nextStorageLevel = await api("GET", "/storage/next-level");
    updateHUD();
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  }
}

async function upgradeShip() {
  if (!state.nextShipLevel) return;
  try {
    const lvl = state.nextShipLevel.level || state.nextShipLevel;
    await api("PUT", "/ship/upgrade", { level: lvl.id });
    notify("✅ Bateau amélioré !", "success");
    state.nextShipLevel = await api("GET", "/ship/next-level");
    updateHUD();
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SELL
// ─────────────────────────────────────────────────────────────────────────────
async function sell1000Feronium() {
  try {
    const offer = await api("POST", "/marketplace/offers", {
      resourceType: "FERONIUM",
      quantityIn: 30000,
      pricePerResource: 1,
    });
    notify("✅ Offre créée : 1000 FERONIUM à 15u", "success");
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  }
}

async function cancelMyOffers() {
  try {
    const allOffers = await api("GET", "/marketplace/offers");
    const mine = allOffers.filter(o => o.owner?.name === state.homeName || o.ownerId === state.playerId);
    if (!mine.length) {
      notify("Aucune offre en cours à supprimer", "info");
      return;
    }
    const results = await Promise.allSettled(
      mine.map(o => api("DELETE", `/marketplace/offers/${o.id}`))
    );
    const ok  = results.filter(r => r.status === "fulfilled").length;
    const err = results.filter(r => r.status === "rejected").length;
    if (ok)  notify(`✅ ${ok} offre(s) supprimée(s)`, "success");
    if (err) notify(`❌ ${err} suppression(s) échouée(s)`, "error");
    loadOffers();
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP
// ─────────────────────────────────────────────────────────────────────────────
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { wx, wy } = screenToWorld(mx, my);
  const key = `${wx},${wy}`;
  const cell = state.cellMemory.get(key);

  if (cell) {
    tooltip.classList.add("visible");
    tooltip.style.left = mx + 14 + "px";
    tooltip.style.top = my + 14 + "px";
    const typeLabel = {
      SEA: "🌊 Mer",
      SAND: "🏝 Île / Sable",
      ROCKS: "🪨 Rochers",
    };
    tooltip.innerHTML = `
      <div class="tooltip-type">${typeLabel[cell.type] || cell.type}</div>
      <div class="tooltip-coords">x: ${cell.x}, y: ${cell.y}</div>
      ${cell.stateEnum ? `<div class="tooltip-state">${cell.stateEnum}</div>` : ""}
      ${cell.zone !== undefined ? `<div class="tooltip-coords">Zone ${cell.zone}</div>` : ""}
      ${cell.ships?.length ? `<div class="tooltip-state">⚓ ${cell.ships.length} bateau(x)</div>` : ""}
    `;
  } else {
    tooltip.classList.remove("visible");
    if (state.position) {
      tooltip.classList.add("visible");
      tooltip.style.left = mx + 14 + "px";
      tooltip.style.top = my + 14 + "px";
      tooltip.innerHTML = `<div class="tooltip-coords" style="color:var(--text-muted)">x: ${wx}, y: ${wy}<br><em>Inexploré</em></div>`;
    }
  }
});

canvas.addEventListener("mouseleave", () =>
  tooltip.classList.remove("visible"),
);

// ─────────────────────────────────────────────────────────────────────────────
// PAN WITH DRAG
// ─────────────────────────────────────────────────────────────────────────────
let drag = null;
canvas.addEventListener("mousedown", (e) => {
  drag = { x: e.clientX - state.viewX, y: e.clientY - state.viewY };
});
canvas.addEventListener("mousemove", (e) => {
  if (!drag) return;
  state.viewX = e.clientX - drag.x;
  state.viewY = e.clientY - drag.y;
});
canvas.addEventListener("mouseup", () => (drag = null));
canvas.addEventListener("mouseleave", () => (drag = null));

// Zoom with wheel
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // Zoom plus rapide quand on est déjà très dézoomé
    const delta = e.deltaY > 0 ? -Math.max(1, Math.floor(state.cellSize / 8)) : Math.max(1, Math.floor(state.cellSize / 8));
    state.cellSize = Math.max(4, Math.min(72, state.cellSize + delta));
    markDirty();
  },
  { passive: false },
);

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key];
  if (dir) {
    e.preventDefault();
    moveShip(dir);
  }
  // Center view with space
  if (e.key === " ") {
    e.preventDefault();
    centerView();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ARROW BUTTONS (on-screen)
// ─────────────────────────────────────────────────────────────────────────────
function setupArrowButtons() {
  const dirs = [
    { id: "btn-NW", dir: "NW", row: 1, col: 1 },
    { id: "btn-N", dir: "N", row: 1, col: 2 },
    { id: "btn-NE", dir: "NE", row: 1, col: 3 },
    { id: "btn-W", dir: "W", row: 2, col: 1 },
    { id: "btn-CENTER", dir: null, row: 2, col: 2 }, // center/recenter
    { id: "btn-E", dir: "E", row: 2, col: 3 },
    { id: "btn-SW", dir: "SW", row: 3, col: 1 },
    { id: "btn-S", dir: "S", row: 3, col: 2 },
    { id: "btn-SE", dir: "SE", row: 3, col: 3 },
  ];
  const arrows = document.getElementById("arrow-keys");
  const labels = {
    N: "↑",
    S: "↓",
    E: "→",
    W: "←",
    NE: "↗",
    NW: "↖",
    SE: "↘",
    SW: "↙",
  };
  dirs.forEach(({ id, dir }) => {
    const btn = document.createElement("div");
    btn.className = "arrow-key";
    btn.id = id;
    if (dir) {
      btn.textContent = labels[dir] || "·";
      btn.addEventListener("click", () => moveShip(dir));
      btn.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          moveShip(dir);
        },
        { passive: false },
      );
    } else {
      btn.textContent = "⊙";
      btn.title = "Recentrer";
      btn.addEventListener("click", centerView);
    }
    arrows.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  // 1. Map + rendu : immédiat
  await loadMapMemory();
  startRenderLoop();

  // 2. Tout le reste en arrière-plan sans bloquer
  (async () => {
    try {
      await loadPlayerDetails();
      await loadResources();
      await loadNextLevels();
      if (!state.position) {
        try {
          await api("POST", "/ship/build");
          notify("⛵ Bateau construit ! Appuyez sur une flèche pour démarrer.", "success");
        } catch { /* bateau existe déjà */ }
      }
      updateHUD();
      setTimeout(loadTaxes, 0);
    } catch (e) {
      notify("Erreur d'initialisation : " + e.message, "error");
    }
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// TAXES
// ─────────────────────────────────────────────────────────────────────────────
async function loadTaxes() {
  try {
    const taxes = await api("GET", "/taxes?status=DUE");
    renderTaxes(taxes);
  } catch (e) {
    // Essai sans filtre si le paramètre pose problème
    try {
      const all = await api("GET", "/taxes");
      renderTaxes((all || []).filter(t => t.state === "DUE" || t.status === "DUE"));
    } catch (e2) {
      notify(`❌ Taxes : ${e2.message}`, "error");
    }
  }
}

function renderTaxes(taxes) {
  const panel = document.getElementById("taxes-panel");
  if (!panel) return;
  panel.innerHTML = "";
  if (!taxes?.length) {
    panel.innerHTML = `<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:8px">✅ Aucune taxe due</p>`;
    return;
  }
  const TYPE_LABEL = { RESCUE: "🆘 Sauvetage", CHEAT: "🚫 Triche" };
  taxes.forEach((tax) => {
    const d = document.createElement("div");
    d.className = "offer-card";
    d.innerHTML = `
      <div class="offer-type" style="color:#e74c3c">${TYPE_LABEL[tax.type] || tax.type || "Taxe"}</div>
      <div class="offer-details">Montant : <span style="color:var(--gold)">${fmt(tax.amount)} 💰</span></div>
      ${tax.remainingTime > 0 ? `<div class="offer-details" style="color:#e74c3c">⏱ ${tax.remainingTime}s restantes</div>` : ""}
      <button class="btn" style="border-color:rgba(192,57,43,0.5);margin-top:6px" data-id="${tax.id}">
        💸 Payer
      </button>`;
    panel.appendChild(d);
  });
  panel.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api("PUT", `/taxes/${btn.dataset.id}`);
        notify("✅ Taxe payée !", "success");
        await loadPlayerDetails();
        updateHUD();
        loadTaxes();
      } catch (e) {
        notify(`❌ ${e.message}`, "error");
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PIRATERIE
// ─────────────────────────────────────────────────────────────────────────────
async function launchTheft() {
  const resourceType = document.getElementById("theft-resource")?.value;
  const moneySpent   = parseInt(document.getElementById("theft-budget")?.value) || 0;
  if (!resourceType || moneySpent <= 0) return;
  if (state.gold < moneySpent) {
    notify(`❌ Pas assez d'or (${fmt(state.gold)} 💰)`, "error");
    return;
  }
  try {
    const theft = await api("POST", "/thefts/player", { resourceType, moneySpent });
    const resolveIn = theft.resolveAt
      ? Math.round((new Date(theft.resolveAt) - Date.now()) / 60000)
      : "?";
    notify(`🏴‍☠️ Vol lancé ! Chance: ${theft.chance} — résolu dans ~${resolveIn} min`, "success");
    await loadPlayerDetails();
    updateHUD();
    loadThefts();
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  }
}

async function loadThefts() {
  try {
    const thefts = await api("GET", "/thefts");
    renderThefts(thefts);
  } catch (e) {
    notify(`❌ Vols : ${e.message}`, "error");
  }
}

function renderThefts(thefts) {
  const list = document.getElementById("theft-list");
  if (!list) return;
  if (!thefts?.length) {
    list.innerHTML = `<p style="color:var(--text-muted);font-size:0.78rem;text-align:center;padding:6px">Aucun vol enregistré</p>`;
    return;
  }
  const STATUS_STYLE = {
    PENDING:  { label: "⏳ En cours", color: "#f1c40f" },
    SUCCESS:  { label: "✅ Réussi",   color: "#2ecc71" },
    FAILED:   { label: "❌ Échoué",   color: "#e74c3c" },
    CANCELLED:{ label: "🚫 Annulé",   color: "#95a5a6" },
  };
  const CHANCE_COLOR = { FORTE: "#2ecc71", MOYENNE: "#f1c40f", FAIBLE: "#e74c3c" };
  list.innerHTML = "";
  [...thefts].reverse().slice(0, 15).forEach(t => {
    const st = STATUS_STYLE[t.status] || { label: t.status, color: "#8a9bb0" };
    const date = t.createdAt
      ? new Date(t.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "—";
    const resolveIn = t.status === "PENDING" && t.resolveAt
      ? Math.max(0, Math.round((new Date(t.resolveAt) - Date.now()) / 60000))
      : null;
    const d = document.createElement("div");
    d.style.cssText = "background:rgba(255,255,255,0.03);border:1px solid rgba(74,144,184,0.12);border-radius:6px;padding:7px 9px;font-size:0.78rem";
    d.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-family:'Cinzel',serif;color:var(--sea-foam)">${t.resourceType}</span>
        <span style="color:${st.color}">${st.label}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:3px;color:var(--text-muted)">
        <span>💰 ${fmt(t.moneySpent)} · <span style="color:${CHANCE_COLOR[t.chance] || "#8a9bb0"}">${t.chance || "—"}</span></span>
        <span>${resolveIn !== null ? `⏱ ${resolveIn} min` : date}</span>
      </div>
      ${t.amountAttempted ? `<div style="color:var(--sand-light);margin-top:2px">⚔️ ${fmt(t.amountAttempted)} tentés</div>` : ""}`;
    list.appendChild(d);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM READY
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Setup static DOM additions
  const mapArea = document.getElementById("map-area");

  // Arrow keys widget
  const arrowContainer = document.createElement("div");
  arrowContainer.id = "arrow-keys";
  mapArea.appendChild(arrowContainer);
  setupArrowButtons();

  // Controls hint
  const hint = document.createElement("div");
  hint.id = "controls-hint";
  hint.textContent =
    "Flèches / WASD/ZQSD pour déplacer · Scroll pour zoomer · Clic-glisser pour pan · Espace pour recentrer";
  mapArea.appendChild(hint);

  // Notification area
  const notifArea = document.createElement("div");
  notifArea.id = "notif-area";
  document.body.appendChild(notifArea);

  // Islands section in left panel
  const leftPanel = document.getElementById("panel-left");
  const islandSection = document.createElement("section");
  islandSection.className = "panel-card";
  islandSection.innerHTML = `
    <div class="panel-title">🏝 Îles découvertes</div>
    <div id="islands-section"></div>`;
  leftPanel.appendChild(islandSection);

  // Taxes section in left panel
  const taxSection = document.createElement("section");
  taxSection.className = "panel-card";
  taxSection.innerHTML = `
    <div class="panel-title">🚨 Taxes dues</div>
    <div id="taxes-panel"></div>
    <button class="btn" id="refreshTaxes" style="margin-top:6px">🔄 Actualiser</button>`;
  leftPanel.appendChild(taxSection);

  // Wire up buttons
  document
    .getElementById("UPG_storage")
    .addEventListener("click", upgradeStorage);
  document.getElementById("UPG_ship").addEventListener("click", upgradeShip);
  document.getElementById("seeOffers").addEventListener("click", loadOffers);
  document
    .getElementById("sell3kf")
    .addEventListener("click", sell1000Feronium);
  document.getElementById("refreshTaxes").addEventListener("click", loadTaxes);

  // ── Section Piraterie (panneau droit) ───────────────────────────────────────
  const rightPanel = document.getElementById("panel-right");
  const theftSection = document.createElement("section");
  theftSection.className = "panel-card";
  theftSection.innerHTML = `
    <div class="panel-title">🏴‍☠️ Piraterie</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="font-size:0.8rem;color:var(--text-muted)">Ressource cible</div>
      <select id="theft-resource" style="background:rgba(255,255,255,0.06);border:1px solid var(--panel-border);
        color:var(--text-light);border-radius:6px;padding:5px 8px;font-size:0.82rem;width:100%">
        <option value="FERONIUM">⚙️ Feronium</option>
        <option value="BOISIUM">🌲 Boisium</option>
        <option value="CHARBONIUM">⚫ Charbonium</option>
      </select>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Budget 💰</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="theft-budget" type="number" min="100" step="100" value="500"
          style="flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--panel-border);
          color:var(--text-light);border-radius:6px;padding:5px 8px;font-size:0.82rem"/>
        <span id="theft-chance" style="font-size:0.78rem;font-family:'Cinzel',serif;min-width:50px;text-align:right">—</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:2px">
        <button class="btn" data-budget="300"  style="font-size:0.65rem;padding:4px">300</button>
        <button class="btn" data-budget="1000" style="font-size:0.65rem;padding:4px">1k</button>
        <button class="btn" data-budget="3000" style="font-size:0.65rem;padding:4px">3k</button>
        <button class="btn" data-budget="5000" style="font-size:0.65rem;padding:4px">5k</button>
      </div>
      <button class="btn" id="theft-launch" style="margin-top:4px;border-color:rgba(192,57,43,0.5)">
        🏴‍☠️ Lancer le vol
      </button>
      <button class="btn" id="theft-refresh" style="font-size:0.68rem;opacity:0.7">
        🔄 Historique des vols
      </button>
    </div>
    <div id="theft-list" style="display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:200px;overflow-y:auto"></div>`;
  rightPanel.appendChild(theftSection);

  // Mise à jour de l'indicateur de chance en temps réel
  const budgetInput = document.getElementById("theft-budget");
  const chanceEl    = document.getElementById("theft-chance");
  function updateChanceLabel() {
    const b = parseInt(budgetInput.value) || 0;
    let label, color;
    if      (b >= 3000) { label = "FORTE";   color = "#2ecc71"; }
    else if (b >= 1000) { label = "MOYENNE"; color = "#f1c40f"; }
    else                { label = "FAIBLE";  color = "#e74c3c"; }
    chanceEl.textContent = label;
    chanceEl.style.color = color;
  }
  budgetInput.addEventListener("input", updateChanceLabel);
  updateChanceLabel();

  // Boutons raccourcis budget
  theftSection.querySelectorAll("[data-budget]").forEach(btn => {
    btn.addEventListener("click", () => {
      budgetInput.value = btn.dataset.budget;
      updateChanceLabel();
    });
  });

  document.getElementById("theft-launch").addEventListener("click", launchTheft);
  document.getElementById("theft-refresh").addEventListener("click", loadThefts);

  // Bouton bot explorateur (panneau gauche)
  const botSection = document.createElement("section");
  botSection.className = "panel-card";
  botSection.innerHTML = `
    <div class="panel-title">🤖 Bot Explorateur</div>
    <p style="font-size:0.78rem;color:var(--text-muted)">Rayon 50 autour de (0, 0)</p>
    <button class="btn" id="botBtn">🤖 Lancer le bot</button>`;
  document.getElementById("panel-left").appendChild(botSection);
  updateBotBtn();

  // Bouton supprimer mes offres (panneau droit)
  const cancelOffersBtn = document.createElement("button");
  cancelOffersBtn.className = "btn";
  cancelOffersBtn.textContent = "🗑️ Supprimer mes offres";
  cancelOffersBtn.style.marginTop = "8px";
  cancelOffersBtn.style.borderColor = "rgba(192,57,43,0.4)";
  cancelOffersBtn.addEventListener("click", cancelMyOffers);
  document
    .getElementById("panel-right")
    .querySelector(".panel-card")
    .appendChild(cancelOffersBtn);

  // Canvas resize
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Auto-refresh resources every 30s
  setInterval(async () => {
    await loadResources();
    await loadPlayerDetails();
    await loadTaxes();
    updateHUD();
  }, 30000);

  init();
});