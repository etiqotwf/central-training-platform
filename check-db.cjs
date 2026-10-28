
const Database = require("better-sqlite3");

const db = new Database("./data/training.sqlite", {
  readonly: true
});

try {
  const users = db
    .prepare("SELECT COUNT(*) AS n FROM users")
    .get().n;

  const admins = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = ?")
    .get("admin").n;

  console.log("Users:", users);
  console.log("Admins:", admins);
} catch (error) {
  console.error("Database check failed:", error.message);
} finally {
  db.close();
}
