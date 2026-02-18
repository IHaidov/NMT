const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "nmt.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    school TEXT DEFAULT '',
    city TEXT DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS test_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_email TEXT NOT NULL,
    student_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    percent INTEGER NOT NULL,
    answers_json TEXT NOT NULL,
    incorrect_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
  CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
  CREATE INDEX IF NOT EXISTS idx_attempts_student ON test_attempts(student_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_created ON test_attempts(created_at);

  CREATE TABLE IF NOT EXISTS teacher_otp (
    teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// Migration: add new columns to teachers if table already existed
[
  "school TEXT DEFAULT ''",
  "city TEXT DEFAULT ''",
  "is_admin INTEGER NOT NULL DEFAULT 0",
].forEach((colDef) => {
  const colName = colDef.split(" ")[0];
  try {
    db.exec(`ALTER TABLE teachers ADD COLUMN ${colName} ${colDef.substring(colName.length + 1)}`);
  } catch (e) {
    if (e.code !== "SQLITE_ERROR" || !/duplicate column name/i.test(e.message)) throw e;
  }
});

module.exports = db;
