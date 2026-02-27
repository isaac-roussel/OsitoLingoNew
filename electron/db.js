const path = require("path");
const Database = require("better-sqlite3");

// IMPORTANT: this points to your existing DB file in the project root.
// Your db file is named "ositolingo" (no extension). That’s fine.
const dbPath = path.join(__dirname, "..", "ositolingo");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// Ensure user_id=1 exists so attempt logging works.
// If you already created a user row, this won't hurt.
db.prepare(`
  INSERT OR IGNORE INTO app_user (user_id, username, display_name)
  VALUES (1, 'izi', 'Izi')
`).run();

module.exports = { db };