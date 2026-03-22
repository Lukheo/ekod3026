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

function resizeCanvas() {
  const area = document.getElementById("map-area");
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
  // Ne pas relancer drawMap ici — la boucle rAF tourne déjà
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

function drawMap() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ocean background
  const grad = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    0,
    canvas.width / 2,
    canvas.height / 2,
    Math.max(canvas.width, canvas.height) / 1.2,
  );
  grad.addColorStop(0, "#0d2240");
  grad.addColorStop(1, "#060d1a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid lines (subtle)
  if (state.cellSize >= 20) {
    ctx.strokeStyle = "rgba(26, 74, 122, 0.08)";
    ctx.lineWidth = 0.5;
    const cs = state.cellSize;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const px = state.position?.x || 0;
    const py = state.position?.y || 0;
    const offX = (cx + state.viewX) % cs;
    const offY = (cy + state.viewY) % cs;
    for (let x = offX; x < canvas.width; x += cs) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = offY; y < canvas.height; y += cs) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  const cs = state.cellSize;
  const margin = cs * 2;

  // Draw all remembered cells
  // Index nom → islandState depuis les îles découvertes du joueur
  const islandClaimMap = new Map();
  state.discoveredIslands.forEach(di => {
    if (di.island?.name) islandClaimMap.set(di.island.name, di.islandState);
  });

  state.cellMemory.forEach((cell, key) => {
    const { sx, sy } = worldToScreen(cell.x, cell.y);
    if (sx < -margin || sx > canvas.width + margin) return;
    if (sy < -margin || sy > canvas.height + margin) return;

    // Pour les îles SAND : couleur selon état claim
    let fillColor, borderColor, borderWidth;
    if (cell.type === "SAND") {
      const islandName  = cell.island?.name;
      const claimState  = islandName ? islandClaimMap.get(islandName) : null;
      if (claimState === "KNOWN") {
        fillColor   = "#2d6e1a";  // vert foncé = claimée
        borderColor = "#5dbd30";
        borderWidth = 1.5;
      } else if (claimState === "DISCOVERED") {
        fillColor   = "#7a6010";  // or foncé = vue non claimée
        borderColor = "#f0b429";
        borderWidth = 1.5;
      } else {
        fillColor   = "#7a5c1e";  // sable neutre = inconnue
        borderColor = "#a07830";
        borderWidth = 0.5;
      }
    } else {
      const colors = CELL_COLORS[cell.type] || CELL_COLORS.SEA;
      fillColor   = colors.base;
      borderColor = colors.border;
      borderWidth = 0.5;
    }

    // Base cell
    ctx.fillStyle = fillColor;
    ctx.fillRect(sx - cs / 2 + 0.5, sy - cs / 2 + 0.5, cs - 1, cs - 1);

    // State overlay (mer uniquement)
    if (cell.type !== "SAND" && cell.stateEnum && STATE_OVERLAYS[cell.stateEnum]) {
      ctx.fillStyle = STATE_OVERLAYS[cell.stateEnum];
      ctx.fillRect(sx - cs / 2 + 0.5, sy - cs / 2 + 0.5, cs - 1, cs - 1);
    }

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(sx - cs / 2 + 0.5, sy - cs / 2 + 0.5, cs - 1, cs - 1);

    // Type icon
    if (cs >= 28) {
      ctx.font = `${Math.floor(cs * 0.42)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let icon = "";
      if (cell.type === "SAND") {
        const islandName = cell.island?.name;
        const claimState = islandName ? islandClaimMap.get(islandName) : null;
        if      (claimState === "KNOWN")      icon = "✅";
        else if (claimState === "DISCOVERED") icon = "👁️";
        else                                  icon = "🏝";
      } else if (cell.type === "ROCKS") {
        icon = "🪨";
      }
      if (icon) ctx.fillText(icon, sx, sy);
    }

    // Other ships indicator
    if (cell.ships && cell.ships.length > 0) {
      ctx.font = `${Math.floor(cs * 0.32)}px serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("⚓", sx + cs / 2 - 2, sy - cs / 2 + 2);
    }
  });

  // Draw fog of war for unknown cells (optional dense effect)
  // Draw coordinates for current visible cells
  if (cs >= 26) {
    state.cellMemory.forEach((cell) => {
      const { sx, sy } = worldToScreen(cell.x, cell.y);
      if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) return;
      ctx.font = `${Math.max(8, Math.floor(cs * 0.22))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(140,180,220,0.35)";
      ctx.fillText(`${cell.x},${cell.y}`, sx, sy - cs / 2 + 2);
    });
  }

  // Draw ship at current position
  if (state.position) {
    const { sx, sy } = worldToScreen(state.position.x, state.position.y);

    // Glow
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, cs * 0.8);
    glow.addColorStop(0, "rgba(255, 215, 0, 0.4)");
    glow.addColorStop(1, "rgba(255, 215, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sx - cs, sy - cs, cs * 2, cs * 2);

    // Ship emoji
    ctx.font = `${Math.floor(cs * 0.65)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⛵", sx, sy);

    // Pulse ring
    const t = Date.now() / 600;
    const pulse = (Math.sin(t) + 1) / 2;
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.2 + pulse * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, cs * (0.55 + pulse * 0.15), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Coordinates of center
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
  cells.forEach(cell => {
    const key = `${cell.x},${cell.y}`;
    const existing = state.cellMemory.get(key) || {};
    const newState = stateEnum || existing.stateEnum || "VISITED";
    const changed = !existing.type
      || existing.stateEnum !== newState
      || existing.ships?.length !== cell.ships?.length;
    const merged = { ...existing, ...cell, stateEnum: newState };
    state.cellMemory.set(key, merged);
    if (changed) _pendingCells.set(key, merged);
  });
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
  q: "W",
};

// File d'attente des mouvements pendant qu'un appel est en cours
let _moveQueue = null;
let _cooldownStart = null;
let _cooldownDuration = 0;

function showCooldown(ms) {
  _cooldownStart = Date.now();
  _cooldownDuration = ms;
  const el = document.getElementById("movesLeft");
  if (!el) return;
  const tick = () => {
    const elapsed = Date.now() - _cooldownStart;
    const remaining = Math.max(0, _cooldownDuration - elapsed);
    if (remaining > 0) {
      el.textContent = `⏳ ${(remaining / 1000).toFixed(1)}s`;
      requestAnimationFrame(tick);
    } else {
      el.textContent = state.movesLeft ?? "?";
    }
  };
  requestAnimationFrame(tick);
}

async function moveShip(direction) {
  if (state.movesLeft !== "?" && state.movesLeft !== undefined && state.movesLeft <= 0) return;

  // Si un mouvement est déjà en cours, on mémorise le dernier demandé
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

    // Afficher un cooldown visuel si l'appel a été rapide (évite le spam)
    const MIN_INTERVAL = 300;
    const wait = Math.max(0, MIN_INTERVAL - elapsed);
    if (wait > 0) {
      showCooldown(wait);
      await new Promise(r => setTimeout(r, wait));
    }
  } catch (e) {
    notify(`❌ ${e.message}`, "error");
  } finally {
    state.moving = false;
    // Exécuter le mouvement en attente s'il y en a un
    if (_moveQueue) {
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
  if (!section || !state.discoveredIslands.length) return; // rien à afficher → on laisse
  section.innerHTML = "";
  state.discoveredIslands.forEach((di) => {
    const d = document.createElement("div");
    d.className = "island-item";
    d.innerHTML = `<span>🏝 ${di.island?.name || "?"}</span>
      <span class="island-state ${di.islandState}">${di.islandState}</span>`;
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
      quantityIn: 1000,
      pricePerResource: 15,
    });
    notify("✅ Offre créée : 1000 FERONIUM à 15u", "success");
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
    const delta = e.deltaY > 0 ? -4 : 4;
    state.cellSize = Math.max(16, Math.min(72, state.cellSize + delta));
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
    notify(`❌ Taxes : ${e.message}`, "error");
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
  taxes.forEach((tax) => {
    const d = document.createElement("div");
    d.className = "offer-card";
    d.innerHTML = `
      <div class="offer-type" style="color:#e74c3c">${tax.type}</div>
      <div class="offer-details">Montant : <span style="color:var(--gold)">${tax.amount} 💰</span></div>
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

  // Bouton reset carte (panneau droit)
  const mapResetBtn = document.createElement("button");
  mapResetBtn.className = "btn";
  mapResetBtn.textContent = "🗑️ Réinitialiser la carte";
  mapResetBtn.style.marginTop = "8px";
  mapResetBtn.style.borderColor = "rgba(192,57,43,0.4)";
  mapResetBtn.addEventListener("click", async () => {
    if (confirm("Effacer toute la mémoire de carte sauvegardée ?")) {
      await clearMapMemory();
    }
  });
  document
    .getElementById("panel-right")
    .querySelector(".panel-card")
    .appendChild(mapResetBtn);

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