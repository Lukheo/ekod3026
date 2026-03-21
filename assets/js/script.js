const baseUrl =
  "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443";
const token =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiNDcyMmEyZDYtNjZjZC00Mzk1LWIzY2QtMGQ1MDlkZDU3YmVkIiwicm9sZXMiOlsiVVNFUiJdfQ.KgwVbxM3zaG71O3eul9R3NVINhdeS180fvEYTlQEi3A";
const signupCode =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoidGhlb2x1Y2FzMjAwMjcyQGdtYWlsLmNvbSJ9.s1NeOijHxJ2NLUETPy1jZY3z0m5CdosLQ3GSzz2hUBk";
const shipId = "46c3bd86-738d-4db9-a161-acf1bb38b652";

// ───────────── Canvas & State ─────────────────────────────────
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const state = {
  cells: {},
  ship: null,
};

// ───────────── Constantes de rendu de la map ──────────────────
const CELL_SIZE = 25;
const PADDING = 5;

const COLORS = {
  SEA: "#1f6feb",
  SAND: "#d29922",
  ROCKS: "#6e7681",
  UNKNOWN: "#010409",
  SHIP: "#3fb950",
  VISITED_ALPHA: 0.5,
};

// ───────────── Affichage de la Map ────────────────────────────
function getViewBounds() {
  const keys = Object.keys(state.cells);
  if (!keys.length) return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [x, y] = k.split(",").map(Number);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX: minX - PADDING,
    maxX: maxX + PADDING,
    minY: minY - PADDING,
    maxY: maxY + PADDING,
  };
}

function render() {
  const b = getViewBounds();
  const cols = b.maxX - b.minX + 1;
  const rows = b.maxY - b.minY + 1;
  canvas.width  = Math.max(cols * CELL_SIZE, canvas.parentElement.clientWidth);
  canvas.height = Math.max(rows * CELL_SIZE, canvas.parentElement.clientHeight);

  ctx.fillStyle = COLORS.UNKNOWN;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [k, cell] of Object.entries(state.cells)) {
    const [cx, cy] = k.split(",").map(Number);
    const px = (cx - b.minX) * CELL_SIZE;
    const py = (cy - b.minY) * CELL_SIZE;

    ctx.globalAlpha = cell.visited ? COLORS.VISITED_ALPHA : 1;
    ctx.fillStyle = COLORS[cell.type] ?? COLORS.UNKNOWN;
    ctx.fillRect(px, py, CELL_SIZE - 1, CELL_SIZE - 1);
    ctx.globalAlpha = 1;
  }

  if (state.ship) {
    const px = (state.ship.x - b.minX) * CELL_SIZE;
    const py = (state.ship.y - b.minY) * CELL_SIZE;
    const cx = px + CELL_SIZE / 2;
    const cy = py + CELL_SIZE / 2;
    const r  = CELL_SIZE * 0.3;

    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(63, 185, 80, 0.2)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.SHIP;
    ctx.fill();

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ───────────── Éléments HTML ──────────────────────────────────
const movesLeftDisplay = document.getElementById("movesLeft");
const homeNameDisplay  = document.getElementById("homeName");
const upgStorageBtn    = document.getElementById("UPG_storage");
const seeOffersBtn    = document.getElementById("seeOffers");
const currentGoldDisplay = document.getElementById("currentGold");
const currentBoatName = document.getElementById("boatName");
const currentStorageName = document.getElementById("storageName");

// ───────────── Chargement initial ─────────────────────────────
function getDetails() {
  axios
    .get(`${baseUrl}/players/details`, {
      headers: { "codinggame-id": token },
    })
    .then((res) => {
      console.log(res.data);
      const data = res.data;

      movesLeftDisplay.innerHTML = data.ship.availableMove;
      homeNameDisplay.innerHTML  = data.home.name;
      currentGoldDisplay.innerHTML = data.money;
      currentBoatName.innerHTML = "🚢 "+data.ship.level.name + " ── Niv."+ data.ship.level.id;
      currentStorageName.innerHTML = "🏠 "+data.storage.name + " ── Niv."+ data.storage.levelId;


      for (const r of data.resources) {
        const el     = document.getElementById(`qty-${r.type}`);
        const maxQty = data.storage?.maxResources?.[r.type];
        if (el) el.textContent = maxQty ? `${r.quantity} / ${maxQty}` : r.quantity;
      }

      // ── Position du bateau sur la carte ──
      const pos = data.ship.currentPosition;
      state.ship = { x: pos.x, y: pos.y };
      state.cells[`${pos.x},${pos.y}`] = { type: pos.type, zone: pos.zone, visited: false };

      render();
    });
}

// ───────────── Upgrade entrepôt ───────────────────────────────
axios
  .get(`${baseUrl}/storage/next-level`, {
    headers: { "codinggame-id": token },
  })
  .then((res) => {
    console.log(res.data);
    const next      = res.data;
    const emojis    = { BOISIUM: "🌲", FERONIUM: "⚙️", CHARBONIUM: "⚫" };
    const container = document.getElementById("upgrade-cost");

    Object.entries(next.costResources).forEach(([type, qty]) => {
      const div = document.createElement("div");
      div.className = "upgrade-item";
      div.innerHTML = `<span>${emojis[type] || "📦"} ${type}</span><span>${qty.toLocaleString()}</span>`;
      container.appendChild(div);
    });
  })
  .catch((err) => console.error(err.response?.data || err.message));

// ───────────── Upgrade bateau ───────────────────────────────
axios
  .get(`${baseUrl}/ship/next-level`, {
    headers: { "codinggame-id": token },
  })
  .then((res) => {
    console.log(res.data);
    const next      = res.data;
    const emojis    = { BOISIUM: "🌲", FERONIUM: "⚙️", CHARBONIUM: "⚫" };
    const container = document.getElementById("upgrade-ship-cost");

    // container.innerHTML = `<p style="margin-bottom:8px">🚢 ${next.name ?? '—'} — Niv. ${next.id - 1 ?? '—'}</p>`;

    Object.entries(next.costResources).forEach(([type, qty]) => {
      const div = document.createElement("div");
      div.className = "upgrade-item";
      div.innerHTML = `<span>${emojis[type] || "📦"} ${type}</span><span>${qty.toLocaleString()}</span>`;
      container.appendChild(div);
    });
  })
  .catch((err) => console.error(err.response?.data || err.message));

// Fonction upgrade bateau
function upShip() {
  axios
    .put(
      `${baseUrl}/ship/upgrade`,
      { level: 2 },
      { headers: { "codinggame-id": token } }
    )
    .then(() => getDetails())
    .catch((err) => console.error(err.response?.data || err.message));
}

document.getElementById("UPG_ship").addEventListener("click", upShip);

// ───────────── Mouvement ──────────────────────────────────────
function move(direction) {
  axios
    .post(
      `${baseUrl}/ship/move`,
      { direction },
      { headers: { "codinggame-id": token } }
    )
    .then((res) => {
      console.log(res.data)
      const data = res.data;
      const pos  = data.position;

      // Marquer l'ancienne case comme visitée
      if (state.ship) {
        const oldKey = `${state.ship.x},${state.ship.y}`;
        if (state.cells[oldKey]) state.cells[oldKey].visited = true;
      }

      // Ajouter les nouvelles cases découvertes
      for (const cell of (data.discoveredCells || [])) {
        state.cells[`${cell.x},${cell.y}`] = { type: cell.type, zone: cell.zone, visited: false };
      }

      // Mettre à jour la position du bateau
      state.ship = { x: pos.x, y: pos.y };
      state.cells[`${pos.x},${pos.y}`] = { type: pos.type, zone: pos.zone, visited: false };

      // Mettre à jour les mouvements restants
      movesLeftDisplay.innerHTML = data.energy;

      render();
    })
    .catch((err) => console.error(err.response?.data || err.message));
}

// ───────────── Upgrade storage ────────────────────────────────
function upStorage() {
  axios
    .put(
      `${baseUrl}/storage/upgrade`,
      {},
      { headers: { "codinggame-id": token } }
    )
    .then(() => getDetails())
    .catch((err) => console.error(err.response?.data || err.message));
}

upgStorageBtn.addEventListener("click", upStorage);

// ───────────── get marketplace offers ────────────────────────────────

function getOffers() {
  axios.get(`${baseUrl}/marketplace/offers`, {
    headers: { "codinggame-id": token }
  })
  .then(res => {
    const offers = res.data;

    console.log("🛒 OFFRES :");
    console.log(offers);
    const offersPanel = document.getElementById("offers-panel")
    offersPanel.innerHTML = ""    

    offers.forEach(o => {
    const div = document.createElement("div");
      div.className = "offer-item";
      div.innerHTML = `<span>${o.resourceType}</span><span>📦${o.quantityIn}</span><span style="color:#fbbf24">💰 ${o.pricePerResource}/u</span><br><span>👤 ${o.owner.name}</span><br><span>${o.id}</span>`;
      offersPanel.appendChild(div);
    });
  })
  .catch(err => console.error(err.response?.data || err.message));
}

seeOffersBtn.addEventListener("click", getOffers)

function createOffer(resourceType, quantityIn, pricePerResource) {
  axios.post(
    `${baseUrl}/marketplace/offers`,
    { resourceType, quantityIn, pricePerResource },
    { headers: { "codinggame-id": token } }
  )
  .then(res => console.log("📦 Offre créée :", res.data))
  .catch(err => console.error(err.response?.data || err.message));
}
document.getElementById("sell3kf").addEventListener("click", function() {
  createOffer("FERONIUM", 1000, 5);
});

function deleteOffer(offerId) {
  axios.delete(`${baseUrl}/marketplace/offers/${offerId}`, {
    headers: { "codinggame-id": token }
  })
  .then(() => console.log("Offre supprimée"))
  .catch(err => console.error(err.response?.data || err.message));
}

function buyOffer(offerId, quantity) {
  axios.post(
    `${baseUrl}/marketplace/purchases`,
    {
      offerId: offerId,
      quantity: quantity
    },
    {
      headers: { "codinggame-id": token }
    }
  )
  .then(res => {
    console.log("✅ Achat réussi :", res.data);
  })
  .catch(err => console.error(err.response?.data || err.message));
}

// ───────────── Clavier ────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const map = { ArrowUp: "N", ArrowDown: "S", ArrowLeft: "W", ArrowRight: "E" };
  if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
});

// ───────────── Init ───────────────────────────────────────────
getDetails();

// E x+1 W x-1 N y-1 S y+1