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
  ship: null
};

// ───────────── Constantes de rendu de la map ──────────────────
const CELL_SIZE = 25;
const PADDING = 5;

const COLORS = {
  SEA:     '#1f6feb',
  SAND:    '#d29922',
  ROCKS:   '#6e7681',
  UNKNOWN: '#010409',
  SHIP:    '#3fb950',
  VISITED_ALPHA: 0.5,
};

// ───────────── Affichage de la Map ────────────────────────────
function getViewBounds() {
  const keys = Object.keys(state.cells);
  if (!keys.length) return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - PADDING, maxX: maxX + PADDING, minY: minY - PADDING, maxY: maxY + PADDING };
}

function render() {
  const b    = getViewBounds();
  const cols = b.maxX - b.minX + 1;
  const rows = b.maxY - b.minY + 1;
  canvas.width  = Math.max(cols * CELL_SIZE, canvas.parentElement.clientWidth);
  canvas.height = Math.max(rows * CELL_SIZE, canvas.parentElement.clientHeight);

  ctx.fillStyle = COLORS.UNKNOWN;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [k, cell] of Object.entries(state.cells)) {
    const [cx, cy] = k.split(',').map(Number);
    const px = (cx - b.minX) * CELL_SIZE;
    const py = (cy - b.minY) * CELL_SIZE;

    ctx.globalAlpha = cell.visited ? COLORS.VISITED_ALPHA : 1;
    ctx.fillStyle   = COLORS[cell.type] ?? COLORS.UNKNOWN;
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
    ctx.fillStyle = 'rgba(63, 185, 80, 0.2)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.SHIP;
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
}

// ───────────── Éléments HTML ──────────────────────────────────
const movesLeftDisplay = document.getElementById("movesLeft");
const homeNameDisplay  = document.getElementById("homeName");

// ───────────── Chargement initial ─────────────────────────────
function getDetails(){axios.get(`${baseUrl}/players/details`, {
    headers: { "codinggame-id": token },
  })
  .then((res) => {
    console.log(res.data);
    const data = res.data;

    movesLeftDisplay.innerHTML = data.ship.availableMove;
    homeNameDisplay.innerHTML  = data.home.name;

    for (const r of data.resources) {
      const el = document.getElementById(`qty-${r.type}`);
      if (el) el.textContent = r.quantity;
    }

    const pos = data.ship.currentPosition;
    state.ship = { x: 2, y: -7};
    // state.cells[`${pos.x},${pos.y}`] = { type: pos.type, zone: pos.zone, visited: false };

    render();
  });
}
axios.get(`${baseUrl}/storage/next-level`, {
  headers: { "codinggame-id": token }
})
.then(res => {
  const nextLevel = res.data;
  console.log(res.data);
  console.log("Prochain storage :", nextLevel.name);
  console.log("Cout upgrade :");
  Object.entries(nextLevel.costResources).forEach(([type, quantity]) => {
    console.log(`- ${type}: ${quantity}`);
  });
})
.catch(err => console.error(err.response?.data || err.message));

// E x+1 W x-1 N y-1 S y+1

function move(direction) {
 axios.post(`${baseUrl}/ship/move`,{
    "direction":direction
  }, {
  headers: {"codinggame-id":token}}
).then(res => console.log(res))
}
getDetails()
move("E")
getDetails()