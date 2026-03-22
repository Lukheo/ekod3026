// ─────────────────────────────────────────────────────────────────────────────
// server.js  –  Zéro dépendance, uniquement Node.js natif
// Lancer avec : node server.js
// ─────────────────────────────────────────────────────────────────────────────
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3001;
const ROOT = path.resolve(__dirname, "../../"); // racine ekod3026/
const MAP_FILE = path.join(__dirname, "map_memory.json"); // assets/js/map_memory.json

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function readMap() {
  if (!fs.existsSync(MAP_FILE)) return { cells: [], position: null };
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  } catch {
    return { cells: [], position: null };
  }
}

function writeMap(data) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(data, null, 2), "utf8");
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const method = req.method.toUpperCase();

    // ── Preflight CORS ──────────────────────────────────────────
    if (method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    // ── Route /map ──────────────────────────────────────────────
    if (url.pathname === "/map") {
      // GET — charger toute la carte
      if (method === "GET") {
        const data = readMap();
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        return res.end(JSON.stringify(data));
      }

      // PATCH — fusionner uniquement les nouvelles cellules
      if (method === "PATCH") {
        try {
          const { cells: newCells, position } = await readBody(req);
          if (!Array.isArray(newCells))
            throw new Error("cells doit être un tableau");
          const saved = readMap();
          const index = {};
          (saved.cells || []).forEach((c) => {
            index[`${c.x},${c.y}`] = c;
          });
          newCells.forEach((c) => {
            index[`${c.x},${c.y}`] = c;
          });
          const merged = {
            cells: Object.values(index),
            position: position ?? saved.position,
          };
          writeMap(merged);
          res.writeHead(200, { "Content-Type": "application/json", ...CORS });
          return res.end(
            JSON.stringify({
              patched: newCells.length,
              total: merged.cells.length,
            }),
          );
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json", ...CORS });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // POST — sauvegarde complète (utilisé par clearMapMemory + reset)
      if (method === "POST") {
        try {
          const { cells, position } = await readBody(req);
          if (!Array.isArray(cells))
            throw new Error("cells doit être un tableau");
          writeMap({ cells, position });
          res.writeHead(200, { "Content-Type": "application/json", ...CORS });
          return res.end(JSON.stringify({ saved: cells.length }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json", ...CORS });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // DELETE — effacer la carte
      if (method === "DELETE") {
        if (fs.existsSync(MAP_FILE)) fs.unlinkSync(MAP_FILE);
        res.writeHead(200, { "Content-Type": "application/json", ...CORS });
        return res.end(JSON.stringify({ cleared: true }));
      }

      res.writeHead(405, CORS);
      return res.end("Method Not Allowed");
    }

    // ── Fichiers statiques ──────────────────────────────────────
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = path.join(ROOT, filePath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Interdit");
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("404 – Fichier introuvable");
      }
      const mime = MIME[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, ...CORS });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`✅  Serveur démarré → http://localhost:${PORT}`);
    console.log(`🗺️  Map persistée dans : ${MAP_FILE}`);
  });