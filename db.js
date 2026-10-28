const Database = require("better-sqlite3");
// SQLite is an in-memory query engine/cache only. Durable application data lives in Google Sheets.
const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_display TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('admin','trainer','trainee')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trainees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  department TEXT DEFAULT '',
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  starts_on TEXT DEFAULT '',
  ends_on TEXT DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  public_registration_enabled INTEGER NOT NULL DEFAULT 1,
  test_url TEXT DEFAULT '',
  test_enabled INTEGER NOT NULL DEFAULT 0,
  test_password TEXT DEFAULT '',
  evaluation_url TEXT DEFAULT '',
  evaluation_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  attachment_name TEXT DEFAULT '',
  attachment_mime TEXT DEFAULT '',
  attachment_data TEXT DEFAULT '',
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  trainee_id INTEGER REFERENCES trainees(id) ON DELETE SET NULL,
  admin_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_course_applications_status ON course_applications(status, created_at DESC);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  trainee_id INTEGER NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, trainee_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 60,
  platform TEXT NOT NULL,
  url TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('tasks','assignments','tests','evaluation-templates','trainee-evaluation','trainer-evaluation','program-evaluation','trainee-rating')),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  due_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'نشط',
  external_url TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  code TEXT DEFAULT '',
  starts_on TEXT DEFAULT '',
  ends_on TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS library_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'مرجع',
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  trainee_id INTEGER NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('حاضر','غائب','متأخر')),
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(course_id, trainee_id, date)
);
`);
// Safe additive migrations for the in-memory schema and older Google Sheets headers.
const courseColumns = db.prepare("PRAGMA table_info(courses)").all().map(c => c.name);
for (const [name, definition] of [["test_url", "TEXT DEFAULT ''"], ["test_enabled", "INTEGER NOT NULL DEFAULT 0"], ["test_password", "TEXT DEFAULT ''"], ["evaluation_url", "TEXT DEFAULT ''"], ["evaluation_enabled", "INTEGER NOT NULL DEFAULT 0"]]) {
  if (!courseColumns.includes(name)) db.exec(`ALTER TABLE courses ADD COLUMN ${name} ${definition}`);
}
// Safe additive migrations for existing V16 databases.
const activityColumns = db.prepare("PRAGMA table_info(training_activities)").all().map(c => c.name);
if (!activityColumns.includes("external_url")) db.exec("ALTER TABLE training_activities ADD COLUMN external_url TEXT DEFAULT ''");
module.exports = db;
