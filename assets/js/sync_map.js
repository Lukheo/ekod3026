const mysql = require("mysql2/promise");

// --- Connexion MySQL ---
async function connectDB() {
  return await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "root1234",
    database: "jeu3026",
  });
}

// --- Sauvegarde les cases en BDD sans doublons ---
async function saveCells(db, cells) {
  if (!cells || cells.length === 0) return;

  let count = 0;
  for (const cell of cells) {
    await db.execute(
      `INSERT INTO cells (cell_id, x, y, type, zone)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE type = VALUES(type), zone = VALUES(zone)`,
      [cell.id, cell.x, cell.y, cell.type, cell.zone],
    );
    count++;
  }
  console.log(`💾 ${count} cases sauvegardées en BDD`);
}

// --- Fonction principale à appeler avec la réponse de /ship/move ---
async function processShipMoveResponse(apiResponse) {
  const db = await connectDB();
  console.log("✅ Connecté à MySQL");

  // Sauvegarde la position actuelle du bateau
  if (apiResponse.position) {
    await saveCells(db, [apiResponse.position]);
    console.log(
      `📍 Position : x=${apiResponse.position.x}, y=${apiResponse.position.y}`,
    );
  }

  // Sauvegarde toutes les cases découvertes autour du bateau
  if (apiResponse.discoveredCells && apiResponse.discoveredCells.length > 0) {
    await saveCells(db, apiResponse.discoveredCells);
    console.log(`🗺️  ${apiResponse.discoveredCells.length} cases découvertes`);
  } else {
    console.log("ℹ️  Aucune nouvelle case découverte");
  }

  console.log("✅ Map mise à jour !");
  await db.end();
}

module.exports = { processShipMoveResponse };
