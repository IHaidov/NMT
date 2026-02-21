const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("./db-init");

const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, "questions.json");
const IMG_DIR = path.join(path.dirname(QUESTIONS_FILE), "img");

function ensureImgDir() {
  try {
    if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  } catch (e) {
    console.warn("Помилка створення папки img:", e.message);
  }
}
ensureImgDir();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureImgDir();
    cb(null, IMG_DIR);
  },
  filename: function (req, file, cb) {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext) ? ext : ".png";
    const name = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9) + safeExt;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB

function readQuestions() {
  try {
    if (QUESTIONS_FILE && fs.existsSync(QUESTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf8"));
    }
  } catch (e) {
    console.warn("Помилка читання questions file:", e.message);
  }
  const fallback = path.join(__dirname, "db.json");
  if (fs.existsSync(fallback)) {
    return JSON.parse(fs.readFileSync(fallback, "utf8"));
  }
  return [];
}

function initQuestionsFile() {
  if (!QUESTIONS_FILE) return;
  try {
    if (!fs.existsSync(QUESTIONS_FILE)) {
      const defaultPath = path.join(__dirname, "db.json");
      if (fs.existsSync(defaultPath)) {
        fs.writeFileSync(QUESTIONS_FILE, fs.readFileSync(defaultPath));
        console.log("Скопійовано db.json → " + QUESTIONS_FILE);
      }
    }
  } catch (e) {
    console.warn("Помилка ініціалізації questions file:", e.message);
  }
}

const app = express();
const PORT = 3000;
const SESSION_COOKIE = "nmt_teacher";
const IMPERSONATE_ORIGINAL_COOKIE = "nmt_impersonate_original";
const STUDENT_ACCESS_COOKIE = "nmt_student_access";
const SESSION_SECRET = process.env.SESSION_SECRET || "nmt-secret-change-in-production";
const ADMIN_EMAIL = "vanya.haidov@gmail.com";
const ADMIN_PASSWORD = "ckfdf0303!";
const OTP_VALIDITY_MINUTES = 15;
const STUDENT_ACCESS_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Seed admin: ensure vanya.haidov@gmail.com exists with correct password and is_admin=1
(function seedAdmin() {
  const existing = db.prepare("SELECT id, password_hash FROM teachers WHERE email = ?").get(ADMIN_EMAIL);
  const newHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  if (existing) {
    const needUpdate = bcrypt.compareSync("test", existing.password_hash) || !bcrypt.compareSync(ADMIN_PASSWORD, existing.password_hash);
    if (needUpdate) {
      db.prepare("UPDATE teachers SET password_hash = ?, is_admin = 1 WHERE id = ?").run(newHash, existing.id);
    } else {
      db.prepare("UPDATE teachers SET is_admin = 1 WHERE id = ?").run(existing.id);
    }
  } else {
    db.prepare(
      "INSERT INTO teachers (email, name, password_hash, is_admin) VALUES (?, ?, ?, 1)"
    ).run(ADMIN_EMAIL, "Адміністратор", newHash);
  }
})();

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser(SESSION_SECRET));
app.use("/img", express.static(IMG_DIR));

function getTeacherId(req) {
  const raw = req.signedCookies[SESSION_COOKIE];
  if (!raw) return null;
  try {
    const data = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return data.teacherId != null ? data.teacherId : null;
  } catch (e) {
    return null;
  }
}

function setTeacherCookie(res, teacherId) {
  const payload = JSON.stringify({ teacherId });
  const value = Buffer.from(payload, "utf8").toString("base64");
  res.cookie(SESSION_COOKIE, value, { signed: true, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearTeacherCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

function setImpersonateOriginal(res, teacherId) {
  const payload = JSON.stringify({ teacherId });
  const value = Buffer.from(payload, "utf8").toString("base64");
  res.cookie(IMPERSONATE_ORIGINAL_COOKIE, value, { signed: true, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
}

function getImpersonateOriginal(req) {
  const raw = req.signedCookies[IMPERSONATE_ORIGINAL_COOKIE];
  if (!raw) return null;
  try {
    const data = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return data.teacherId != null ? data.teacherId : null;
  } catch (e) { return null; }
}

function clearImpersonateOriginal(res) {
  res.clearCookie(IMPERSONATE_ORIGINAL_COOKIE);
}

function generateOTPCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function setStudentAccessCookie(res, classId) {
  const payload = JSON.stringify({ at: Date.now(), classId: classId != null ? classId : undefined });
  const value = Buffer.from(payload, "utf8").toString("base64");
  res.cookie(STUDENT_ACCESS_COOKIE, value, { signed: true, httpOnly: true, maxAge: STUDENT_ACCESS_MAX_AGE_MS });
}

function getStudentAccess(req) {
  const raw = req.signedCookies[STUDENT_ACCESS_COOKIE];
  if (!raw) return null;
  try {
    const data = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!data || typeof data.at !== "number") return null;
    return { valid: true, classId: data.classId };
  } catch (e) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const t = db.prepare("SELECT is_admin FROM teachers WHERE id = ?").get(teacherId);
  if (!t || !t.is_admin) return res.status(403).json({ error: "Доступ лише для адміністратора" });
  next();
}

// ——— Auth ———
app.post("/api/teachers/register", (req, res) => {
  return res.status(403).json({
    error: "Реєстрація заборонена. Щоб отримати обліковий запис вчителя, зверніться до адміністратора: vanya.haidov@gmail.com",
  });
});

app.post("/api/teachers/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Введіть пошту та пароль" });
  const teacher = db.prepare("SELECT id, email, name, school, city, is_admin, password_hash FROM teachers WHERE email = ?").get(email.trim());
  if (!teacher || !bcrypt.compareSync(password, teacher.password_hash)) {
    return res.status(401).json({ error: "Невірна пошта або пароль" });
  }
  setTeacherCookie(res, teacher.id);
  return res.json({
    teacher: {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      school: teacher.school || "",
      city: teacher.city || "",
      isAdmin: !!teacher.is_admin,
    },
  });
});

app.post("/api/teachers/logout", (req, res) => {
  clearTeacherCookie(res);
  return res.json({ ok: true });
});

app.get("/api/teachers/me", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const teacher = db.prepare("SELECT id, email, name, school, city, is_admin FROM teachers WHERE id = ?").get(teacherId);
  if (!teacher) return res.status(401).json({ error: "Не авторизовано" });
  const isImpersonated = getImpersonateOriginal(req) != null;
  return res.json({
    teacher: {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      school: teacher.school || "",
      city: teacher.city || "",
      isAdmin: !!teacher.is_admin,
      isImpersonated: isImpersonated,
    },
  });
});

// ——— OTP по класу: кожен клас має свій код; учень вводить код і приписується до класу ———
function ensureClassOTP(classId) {
  const now = new Date().toISOString();
  const classRow = db.prepare("SELECT id, otp_code, otp_expires_at FROM classes WHERE id = ?").get(classId);
  if (!classRow) return null;
  if (classRow.otp_code && classRow.otp_expires_at && classRow.otp_expires_at > now) {
    return { code: classRow.otp_code, expires_at: classRow.otp_expires_at };
  }
  let code;
  for (let i = 0; i < 20; i++) {
    code = generateOTPCode();
    const existing = db.prepare("SELECT id FROM classes WHERE otp_code = ? AND otp_expires_at > ?").get(code, now);
    if (!existing) break;
  }
  const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000).toISOString();
  db.prepare("UPDATE classes SET otp_code = ?, otp_expires_at = ? WHERE id = ?").run(code, expiresAt, classId);
  return { code, expires_at: expiresAt };
}

app.post("/api/otp/validate", (req, res) => {
  const { code } = req.body || {};
  const codeStr = code != null ? String(code).trim() : "";
  if (!codeStr) return res.status(400).json({ valid: false, error: "Введіть код" });
  const now = new Date().toISOString();
  const row = db.prepare("SELECT id FROM classes WHERE otp_code = ? AND otp_expires_at > ?").get(codeStr, now);
  if (!row) {
    return res.json({ valid: false, error: "Невірний або прострочений код" });
  }
  setStudentAccessCookie(res, row.id);
  return res.json({ valid: true });
});

app.get("/api/otp/session", (req, res) => {
  const access = getStudentAccess(req);
  if (access && access.valid) return res.json({ valid: true });
  return res.status(401).json({ valid: false });
});

// Учень приписується до класу (за класом із cookie), якщо його пошта ще не в цьому класі
app.post("/api/student/join-class", (req, res) => {
  const access = getStudentAccess(req);
  if (!access || !access.valid || access.classId == null) {
    return res.status(401).json({ error: "Спочатку введіть код доступу класу" });
  }
  const classId = access.classId;
  const c = db.prepare("SELECT id FROM classes WHERE id = ?").get(classId);
  if (!c) return res.status(400).json({ error: "Клас не знайдено" });
  const { email, name } = req.body || {};
  const emailStr = email != null ? String(email).trim() : "";
  if (!emailStr) return res.status(400).json({ error: "Введіть пошту" });
  const nameStr = name != null ? String(name).trim() : "";
  const existing = db.prepare("SELECT id, class_id FROM students WHERE email = ?").get(emailStr);
  if (existing) {
    if (existing.class_id === classId) return res.json({ ok: true, alreadyInClass: true });
    if (nameStr) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(nameStr, existing.id);
    db.prepare("UPDATE students SET class_id = ? WHERE id = ?").run(classId, existing.id);
    return res.json({ ok: true });
  }
  db.prepare("INSERT INTO students (email, name, class_id) VALUES (?, ?, ?)").run(emailStr, nameStr, classId);
  return res.json({ ok: true });
});

// ——— Classes (teacher only) ———
app.get("/api/classes", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const rows = db.prepare("SELECT id, name, created_at, otp_code, otp_expires_at FROM classes WHERE teacher_id = ? ORDER BY created_at DESC").all(teacherId);
  const classes = rows.map((c) => {
    const otp = ensureClassOTP(c.id);
    return {
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      otp_code: otp ? otp.code : (c.otp_code || null),
      otp_expires_at: otp ? otp.expires_at : (c.otp_expires_at || null),
    };
  });
  return res.json({ classes });
});

app.post("/api/classes", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Назва класу обов'язкова" });
  const stmt = db.prepare("INSERT INTO classes (teacher_id, name) VALUES (?, ?)");
  stmt.run(teacherId, String(name).trim());
  const row = db.prepare("SELECT id, name, created_at FROM classes WHERE id = last_insert_rowid()").get();
  return res.json({ class: row });
});

app.get("/api/classes/:id", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const id = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT id, name, created_at, otp_code, otp_expires_at FROM classes WHERE id = ? AND teacher_id = ?").get(id, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const otp = ensureClassOTP(id);
  const students = db.prepare("SELECT id, email, name, created_at FROM students WHERE class_id = ? ORDER BY name, email").all(id);
  return res.json({
    class: {
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      otp_code: otp ? otp.code : (c.otp_code || null),
      otp_expires_at: otp ? otp.expires_at : (c.otp_expires_at || null),
    },
    students,
  });
});

app.post("/api/classes/:id/otp/regenerate", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const id = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?").get(id, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const now = new Date().toISOString();
  let code;
  for (let i = 0; i < 20; i++) {
    code = generateOTPCode();
    const existing = db.prepare("SELECT id FROM classes WHERE otp_code = ? AND otp_expires_at > ?").get(code, now);
    if (!existing) break;
  }
  const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000).toISOString();
  db.prepare("UPDATE classes SET otp_code = ?, otp_expires_at = ? WHERE id = ?").run(code, expiresAt, id);
  return res.json({ code, expires_at: expiresAt });
});

// Add student to class by email (creates student if not exists; removes from other class)
app.post("/api/classes/:id/students", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const classId = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?").get(classId, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const { email, name } = req.body || {};
  const emailStr = email && String(email).trim();
  if (!emailStr) return res.status(400).json({ error: "Введіть пошту учня" });
  const nameStr = name != null ? String(name).trim() : "";
  const existing = db.prepare("SELECT id, class_id FROM students WHERE email = ?").get(emailStr);
  if (existing) {
    if (nameStr) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(nameStr, existing.id);
    if (existing.class_id === classId) return res.json({ student: db.prepare("SELECT id, email, name FROM students WHERE id = ?").get(existing.id) });
    db.prepare("UPDATE students SET class_id = ? WHERE id = ?").run(classId, existing.id);
    return res.json({ student: db.prepare("SELECT id, email, name FROM students WHERE id = ?").get(existing.id) });
  }
  db.prepare("INSERT INTO students (email, name, class_id) VALUES (?, ?, ?)").run(emailStr, nameStr, classId);
  const row = db.prepare("SELECT id, email, name FROM students WHERE id = last_insert_rowid()").get();
  return res.json({ student: row });
});

app.delete("/api/classes/:classId/students/:studentId", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const classId = parseInt(req.params.classId, 10);
  const studentId = parseInt(req.params.studentId, 10);
  const c = db.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?").get(classId, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  db.prepare("UPDATE students SET class_id = NULL WHERE id = ? AND class_id = ?").run(studentId, classId);
  return res.json({ ok: true });
});

// Teacher: edit student email/name in own class
app.put("/api/classes/:classId/students/:studentId", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const classId = parseInt(req.params.classId, 10);
  const studentId = parseInt(req.params.studentId, 10);
  const c = db.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?").get(classId, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const student = db.prepare("SELECT id FROM students WHERE id = ? AND class_id = ?").get(studentId, classId);
  if (!student) return res.status(404).json({ error: "Учня не знайдено в цьому класі" });
  const { email, name } = req.body || {};
  if (email != null) {
    const emailStr = String(email).trim();
    if (!emailStr) return res.status(400).json({ error: "Пошта не може бути порожньою" });
    const other = db.prepare("SELECT id FROM students WHERE email = ? AND id != ?").get(emailStr, studentId);
    if (other) return res.status(409).json({ error: "Така пошта вже використовується іншим учнем" });
    db.prepare("UPDATE students SET email = ? WHERE id = ?").run(emailStr, studentId);
  }
  if (name != null) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(String(name).trim(), studentId);
  const row = db.prepare("SELECT id, email, name FROM students WHERE id = ?").get(studentId);
  return res.json({ student: row });
});

// ——— Student detail: attempts ———
app.get("/api/students/:id/attempts", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const studentId = parseInt(req.params.id, 10);
  const student = db.prepare("SELECT s.id, s.email, s.name, s.class_id FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ? AND c.teacher_id = ?").get(studentId, teacherId);
  if (!student) return res.status(404).json({ error: "Учня не знайдено" });
  const attempts = db.prepare("SELECT id, score, percent, answers_json, incorrect_json, created_at FROM test_attempts WHERE student_id = ? ORDER BY created_at DESC").all(studentId);
  return res.json({ student: { id: student.id, email: student.email, name: student.name }, attempts });
});

// ——— Class results: all attempts for students in class (with filters) ———
app.get("/api/classes/:id/results", (req, res) => {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  const classId = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT id, name FROM classes WHERE id = ? AND teacher_id = ?").get(classId, teacherId);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const { from, to, minScore, maxScore, search } = req.query || {};
  let sql = `
    SELECT a.id, a.student_id, a.student_email, a.student_name, a.score, a.percent, a.answers_json, a.incorrect_json, a.created_at
    FROM test_attempts a
    JOIN students s ON s.id = a.student_id
    WHERE s.class_id = ?
  `;
  const params = [classId];
  if (from) { sql += " AND date(a.created_at) >= date(?)"; params.push(from); }
  if (to) { sql += " AND date(a.created_at) <= date(?)"; params.push(to); }
  if (minScore !== undefined && minScore !== "") { sql += " AND a.score >= ?"; params.push(parseInt(minScore, 10)); }
  if (maxScore !== undefined && maxScore !== "") { sql += " AND a.score <= ?"; params.push(parseInt(maxScore, 10)); }
  if (search && String(search).trim()) {
    sql += " AND (a.student_name LIKE ? OR a.student_email LIKE ?)";
    const term = "%" + String(search).trim() + "%";
    params.push(term, term);
  }
  sql += " ORDER BY a.created_at DESC";
  const attempts = db.prepare(sql).all(...params);
  return res.json({ class: c, attempts });
});

// ——— Start attempt (записати проходження одразу після початку тесту) ———
app.post("/api/attempts/start", (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !String(email).trim()) return res.status(400).json({ error: "Потрібна пошта учня" });
  const emailStr = String(email).trim();
  const nameStr = name ? String(name).trim() : "";
  let student = db.prepare("SELECT id FROM students WHERE email = ?").get(emailStr);
  if (!student) {
    db.prepare("INSERT INTO students (email, name) VALUES (?, ?)").run(emailStr, nameStr);
    student = { id: db.prepare("SELECT last_insert_rowid() as id").get().id };
  } else {
    if (nameStr) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(nameStr, student.id);
  }
  db.prepare(
    "INSERT INTO test_attempts (student_id, student_email, student_name, score, percent, answers_json, incorrect_json) VALUES (?, ?, ?, 0, 0, '[]', '[]')"
  ).run(student.id, emailStr, nameStr);
  const attemptId = db.prepare("SELECT last_insert_rowid() as id").get().id;
  return res.json({ ok: true, attemptId });
});

// ——— Update attempt (прогрес або фінальний результат) ———
app.patch("/api/attempts/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Невірний id проходження" });
  const row = db.prepare("SELECT id FROM test_attempts WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Проходження не знайдено" });
  const { score, percent, answers, incorrect } = req.body || {};
  const updates = [];
  const values = [];
  if (score != null) {
    updates.push("score = ?");
    values.push(parseInt(score, 10));
  }
  if (percent != null) {
    updates.push("percent = ?");
    values.push(parseInt(percent, 10));
  }
  if (answers !== undefined) {
    updates.push("answers_json = ?");
    values.push(typeof answers === "string" ? answers : JSON.stringify(answers || []));
  }
  if (incorrect !== undefined) {
    updates.push("incorrect_json = ?");
    values.push(typeof incorrect === "string" ? incorrect : JSON.stringify(incorrect || []));
  }
  if (updates.length === 0) return res.json({ ok: true });
  values.push(id);
  db.prepare("UPDATE test_attempts SET " + updates.join(", ") + " WHERE id = ?").run(...values);
  return res.json({ ok: true });
});

// ——— Save attempt (student finished test; створює новий запис, якщо attemptId не передано) ———
app.post("/api/attempts", (req, res) => {
  const { email, name, attemptId, score, percent, answers, incorrect } = req.body || {};
  if (!email || !String(email).trim()) return res.status(400).json({ error: "Потрібна пошта учня" });
  const emailStr = String(email).trim();
  const nameStr = name ? String(name).trim() : "";
  if (score == null || percent == null) return res.status(400).json({ error: "Потрібні бали та відсоток" });
  let student = db.prepare("SELECT id FROM students WHERE email = ?").get(emailStr);
  if (!student) {
    db.prepare("INSERT INTO students (email, name) VALUES (?, ?)").run(emailStr, nameStr);
    student = { id: db.prepare("SELECT last_insert_rowid() as id").get().id };
  } else {
    if (nameStr) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(nameStr, student.id);
  }
  const answersJson = JSON.stringify(answers || []);
  const incorrectJson = JSON.stringify(incorrect || []);

  if (attemptId) {
    const aid = parseInt(attemptId, 10);
    const existing = db.prepare("SELECT id, student_id FROM test_attempts WHERE id = ?").get(aid);
    if (existing && existing.student_id === student.id) {
      db.prepare(
        "UPDATE test_attempts SET score = ?, percent = ?, answers_json = ?, incorrect_json = ? WHERE id = ?"
      ).run(parseInt(score, 10), parseInt(percent, 10), answersJson, incorrectJson, aid);
      return res.json({ ok: true, attemptId: aid });
    }
  }

  db.prepare(
    "INSERT INTO test_attempts (student_id, student_email, student_name, score, percent, answers_json, incorrect_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(student.id, emailStr, nameStr, parseInt(score, 10), parseInt(percent, 10), answersJson, incorrectJson);
  return res.json({ ok: true, attemptId: db.prepare("SELECT last_insert_rowid() as id").get().id });
});

// ——— Admin (requireAdmin) ———
app.post("/api/admin/impersonate", requireAdmin, (req, res) => {
  const teacherId = parseInt(req.body && req.body.teacher_id, 10);
  if (!teacherId) return res.status(400).json({ error: "Вкажіть teacher_id" });
  const teacher = db.prepare("SELECT id FROM teachers WHERE id = ?").get(teacherId);
  if (!teacher) return res.status(404).json({ error: "Вчителя не знайдено" });
  const adminId = getTeacherId(req);
  setImpersonateOriginal(res, adminId);
  setTeacherCookie(res, teacherId);
  return res.json({ ok: true });
});

app.post("/api/admin/stop-impersonate", (req, res) => {
  const originalId = getImpersonateOriginal(req);
  if (originalId == null) return res.status(403).json({ error: "Не в режимі входу як вчитель" });
  clearImpersonateOriginal(res);
  setTeacherCookie(res, originalId);
  return res.json({ ok: true });
});

app.get("/api/admin/teachers", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, email, name, school, city, is_admin, created_at FROM teachers ORDER BY name, email").all();
  return res.json({ teachers: rows });
});

app.post("/api/admin/teachers", requireAdmin, (req, res) => {
  const { email, name, password, school, city } = req.body || {};
  if (!email || !String(email).trim()) return res.status(400).json({ error: "Пошта обов'язкова" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "ПІБ обов'язковий" });
  if (!password || String(password).length < 1) return res.status(400).json({ error: "Пароль обов'язковий" });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(
      "INSERT INTO teachers (email, name, password_hash, school, city, is_admin) VALUES (?, ?, ?, ?, ?, 0)"
    ).run(email.trim(), name.trim(), hash, (school && String(school).trim()) || "", (city && String(city).trim()) || "");
    const row = db.prepare("SELECT id, email, name, school, city FROM teachers WHERE id = last_insert_rowid()").get();
    return res.json({ teacher: row });
  } catch (e) {
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Така пошта вже є" });
    throw e;
  }
});

app.get("/api/admin/teachers/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = db.prepare("SELECT id, email, name, school, city, is_admin, created_at FROM teachers WHERE id = ?").get(id);
  if (!t) return res.status(404).json({ error: "Вчителя не знайдено" });
  const classes = db.prepare("SELECT id, name, created_at FROM classes WHERE teacher_id = ? ORDER BY name").all(id);
  return res.json({ teacher: t, classes });
});

app.put("/api/admin/teachers/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = db.prepare("SELECT id FROM teachers WHERE id = ?").get(id);
  if (!t) return res.status(404).json({ error: "Вчителя не знайдено" });
  const { email, name, password, school, city } = req.body || {};
  if (email != null) {
    const s = String(email).trim();
    if (!s) return res.status(400).json({ error: "Пошта не може бути порожньою" });
    const other = db.prepare("SELECT id FROM teachers WHERE email = ? AND id != ?").get(s, id);
    if (other) return res.status(409).json({ error: "Така пошта вже використовується" });
    db.prepare("UPDATE teachers SET email = ? WHERE id = ?").run(s, id);
  }
  if (name != null) db.prepare("UPDATE teachers SET name = ? WHERE id = ?").run(String(name).trim(), id);
  if (school != null) db.prepare("UPDATE teachers SET school = ? WHERE id = ?").run(String(school).trim(), id);
  if (city != null) db.prepare("UPDATE teachers SET city = ? WHERE id = ?").run(String(city).trim(), id);
  if (password != null && String(password).length > 0) {
    db.prepare("UPDATE teachers SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), id);
  }
  const row = db.prepare("SELECT id, email, name, school, city, is_admin FROM teachers WHERE id = ?").get(id);
  return res.json({ teacher: row });
});

app.delete("/api/admin/teachers/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = db.prepare("SELECT id, is_admin FROM teachers WHERE id = ?").get(id);
  if (!t) return res.status(404).json({ error: "Вчителя не знайдено" });
  if (t.is_admin) return res.status(403).json({ error: "Не можна видалити адміністратора" });
  db.prepare("UPDATE students SET class_id = NULL WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)").run(id);
  db.prepare("DELETE FROM classes WHERE teacher_id = ?").run(id);
  db.prepare("DELETE FROM teachers WHERE id = ?").run(id);
  return res.json({ ok: true });
});

app.get("/api/admin/classes", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.teacher_id, c.name, c.created_at, t.email as teacher_email, t.name as teacher_name
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    ORDER BY t.name, c.name
  `).all();
  return res.json({ classes: rows });
});

app.post("/api/admin/classes", requireAdmin, (req, res) => {
  const { teacher_id, name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Назва класу обов'язкова" });
  const tid = parseInt(teacher_id, 10);
  const t = db.prepare("SELECT id FROM teachers WHERE id = ?").get(tid);
  if (!t) return res.status(400).json({ error: "Вчителя не знайдено" });
  db.prepare("INSERT INTO classes (teacher_id, name) VALUES (?, ?)").run(tid, String(name).trim());
  const row = db.prepare("SELECT id, teacher_id, name, created_at FROM classes WHERE id = last_insert_rowid()").get();
  return res.json({ class: row });
});

app.get("/api/admin/classes/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT c.*, t.email as teacher_email, t.name as teacher_name FROM classes c JOIN teachers t ON t.id = c.teacher_id WHERE c.id = ?").get(id);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  const students = db.prepare("SELECT id, email, name, created_at FROM students WHERE class_id = ? ORDER BY name, email").all(id);
  return res.json({ class: c, students });
});

app.put("/api/admin/classes/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, teacher_id } = req.body || {};
  const c = db.prepare("SELECT id FROM classes WHERE id = ?").get(id);
  if (!c) return res.status(404).json({ error: "Клас не знайдено" });
  if (name != null && String(name).trim()) db.prepare("UPDATE classes SET name = ? WHERE id = ?").run(String(name).trim(), id);
  if (teacher_id != null) {
    const tid = parseInt(teacher_id, 10);
    if (db.prepare("SELECT id FROM teachers WHERE id = ?").get(tid)) {
      db.prepare("UPDATE classes SET teacher_id = ? WHERE id = ?").run(tid, id);
    }
  }
  const row = db.prepare("SELECT id, teacher_id, name, created_at FROM classes WHERE id = ?").get(id);
  return res.json({ class: row });
});

app.delete("/api/admin/classes/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("UPDATE students SET class_id = NULL WHERE class_id = ?").run(id);
  db.prepare("DELETE FROM classes WHERE id = ?").run(id);
  return res.json({ ok: true });
});

app.get("/api/admin/students", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.email, s.name, s.class_id, s.created_at, c.name as class_name, t.name as teacher_name
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN teachers t ON t.id = c.teacher_id
    ORDER BY s.name, s.email
  `).all();
  return res.json({ students: rows });
});

app.post("/api/admin/students", requireAdmin, (req, res) => {
  const { email, name, class_id } = req.body || {};
  if (!email || !String(email).trim()) return res.status(400).json({ error: "Пошта обов'язкова" });
  const emailStr = email.trim();
  const nameStr = (name != null && String(name).trim()) || "";
  const cid = class_id != null ? parseInt(class_id, 10) : null;
  if (cid) {
    const c = db.prepare("SELECT id FROM classes WHERE id = ?").get(cid);
    if (!c) return res.status(400).json({ error: "Клас не знайдено" });
  }
  const existing = db.prepare("SELECT id, class_id FROM students WHERE email = ?").get(emailStr);
  if (existing) {
    if (nameStr) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(nameStr, existing.id);
    if (cid != null) db.prepare("UPDATE students SET class_id = ? WHERE id = ?").run(cid, existing.id);
    const row = db.prepare("SELECT id, email, name, class_id FROM students WHERE id = ?").get(existing.id);
    return res.json({ student: row });
  }
  db.prepare("INSERT INTO students (email, name, class_id) VALUES (?, ?, ?)").run(emailStr, nameStr, cid);
  const row = db.prepare("SELECT id, email, name, class_id FROM students WHERE id = last_insert_rowid()").get();
  return res.json({ student: row });
});

app.get("/api/admin/students/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare("SELECT s.*, c.name as class_name, c.teacher_id FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?").get(id);
  if (!s) return res.status(404).json({ error: "Учня не знайдено" });
  return res.json({ student: s });
});

app.put("/api/admin/students/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare("SELECT id FROM students WHERE id = ?").get(id);
  if (!s) return res.status(404).json({ error: "Учня не знайдено" });
  const { email, name, class_id } = req.body || {};
  if (email != null) {
    const v = String(email).trim();
    if (!v) return res.status(400).json({ error: "Пошта не може бути порожньою" });
    const other = db.prepare("SELECT id FROM students WHERE email = ? AND id != ?").get(v, id);
    if (other) return res.status(409).json({ error: "Така пошта вже використовується" });
    db.prepare("UPDATE students SET email = ? WHERE id = ?").run(v, id);
  }
  if (name != null) db.prepare("UPDATE students SET name = ? WHERE id = ?").run(String(name).trim(), id);
  if (class_id != null) {
    const cid = class_id === "" || class_id === null ? null : parseInt(class_id, 10);
    if (cid !== null) {
      const c = db.prepare("SELECT id FROM classes WHERE id = ?").get(cid);
      if (!c) return res.status(400).json({ error: "Клас не знайдено" });
    }
    db.prepare("UPDATE students SET class_id = ? WHERE id = ?").run(cid, id);
  }
  const row = db.prepare("SELECT id, email, name, class_id FROM students WHERE id = ?").get(id);
  return res.json({ student: row });
});

app.delete("/api/admin/students/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("DELETE FROM test_attempts WHERE student_id = ?").run(id);
  db.prepare("UPDATE students SET class_id = NULL WHERE id = ?").run(id);
  db.prepare("DELETE FROM students WHERE id = ?").run(id);
  return res.json({ ok: true });
});

// ——— Питання (база завдань): читання та збереження (адмін)
app.get("/api/questions", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const data = readQuestions();
    return res.json(Array.isArray(data) ? data : data.questions || data.data || []);
  } catch (e) {
    return res.status(500).json({ error: "Помилка читання питань" });
  }
});

app.get("/api/admin/questions/:id/history", requireAdmin, (req, res) => {
  const qId = parseInt(req.params.id, 10);
  const rows = db.prepare(`
    SELECT r.id, r.question_id, r.question_snapshot_json, r.teacher_id, r.action, r.created_at,
           t.name as teacher_name, t.email as teacher_email
    FROM question_revision_history r
    JOIN teachers t ON t.id = r.teacher_id
    WHERE r.question_id = ?
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all(qId);
  const history = rows.map((r) => ({
    id: r.id,
    question_id: r.question_id,
    teacher_id: r.teacher_id,
    teacher_name: r.teacher_name,
    teacher_email: r.teacher_email,
    action: r.action,
    created_at: r.created_at,
    snapshot: (() => {
      try {
        return JSON.parse(r.question_snapshot_json || "{}");
      } catch (e) {
        return {};
      }
    })(),
  }));
  return res.json({ history });
});

app.post("/api/admin/questions", requireAdmin, (req, res) => {
  if (!QUESTIONS_FILE) {
    return res.status(503).json({
      error: "Збереження питань не налаштовано. Вкажіть змінну середовища QUESTIONS_FILE (наприклад /data/questions.json).",
    });
  }
  const questions = req.body && req.body.questions;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: "Потрібне поле questions (масив завдань)" });
  }
  try {
    const adminId = getTeacherId(req);
    const existing = readQuestions();
    const oldList = Array.isArray(existing) ? existing : (existing.questions || existing.data || []);
    const oldById = {};
    oldList.forEach((q) => { if (q.id != null) oldById[q.id] = q; });
    const insertRev = db.prepare(
      "INSERT INTO question_revision_history (question_id, question_snapshot_json, teacher_id, action) VALUES (?, ?, ?, 'admin_edited')"
    );
    questions.forEach((newQ) => {
      const qid = newQ.id != null ? newQ.id : 0;
      const oldQ = oldById[qid];
      if (oldQ && JSON.stringify(oldQ) !== JSON.stringify(newQ)) {
        insertRev.run(qid, JSON.stringify(newQ), adminId);
      }
    });
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), "utf8");
    return res.json({ ok: true });
  } catch (e) {
    console.error("Помилка збереження питань:", e);
    return res.status(500).json({ error: "Помилка запису файлу: " + (e.message || "") });
  }
});

function requireTeacher(req, res, next) {
  const teacherId = getTeacherId(req);
  if (!teacherId) return res.status(401).json({ error: "Не авторизовано" });
  req.teacherId = teacherId;
  next();
}

// Для не-адміна редактор показує порожній список (вчитель створює свої завдання і надсилає їх)
app.get("/api/teacher/editor-draft", requireTeacher, (req, res) => {
  const row = db.prepare("SELECT questions_json FROM teacher_editor_draft WHERE teacher_id = ?").get(req.teacherId);
  if (!row) return res.json({ questions: [] });
  try {
    const questions = JSON.parse(row.questions_json || "[]");
    return res.json({ questions: Array.isArray(questions) ? questions : [] });
  } catch (e) {
    return res.json({ questions: [] });
  }
});

app.post("/api/teacher/editor-draft", requireTeacher, (req, res) => {
  const questions = req.body && req.body.questions;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: "Потрібне поле questions (масив)" });
  }
  try {
    const json = JSON.stringify(questions);
    db.prepare(
      "INSERT INTO teacher_editor_draft (teacher_id, questions_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(teacher_id) DO UPDATE SET questions_json = excluded.questions_json, updated_at = datetime('now')"
    ).run(req.teacherId, json);
    return res.json({ ok: true });
  } catch (e) {
    console.error("Помилка збереження чернетки:", e);
    return res.status(500).json({ error: "Помилка: " + (e.message || "") });
  }
});

// Вчитель надсилає завдання на перевірку адміну
app.post("/api/teacher/submit-questions", requireTeacher, (req, res) => {
  const questions = req.body && req.body.questions;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: "Потрібне поле questions (масив завдань)" });
  }
  try {
    db.prepare(
      "INSERT INTO question_submissions (teacher_id, questions_json, status) VALUES (?, ?, 'pending')"
    ).run(req.teacherId, JSON.stringify(questions));
    const id = db.prepare("SELECT last_insert_rowid() as id").get().id;
    return res.json({ ok: true, submissionId: id });
  } catch (e) {
    console.error("Помилка збереження надсилання:", e);
    return res.status(500).json({ error: "Помилка: " + (e.message || "") });
  }
});

// Адмін: список надсилань (вчитель + його нові завдання)
app.get("/api/admin/submissions", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.teacher_id, s.questions_json, s.status, s.created_at, s.reviewed_at,
           t.name as teacher_name, t.email as teacher_email
    FROM question_submissions s
    JOIN teachers t ON t.id = s.teacher_id
    ORDER BY s.created_at DESC
  `).all();
  const submissions = rows.map((r) => {
    let count = 0;
    try {
      const arr = JSON.parse(r.questions_json || "[]");
      count = Array.isArray(arr) ? arr.length : 0;
    } catch (e) {}
    return {
      id: r.id,
      teacher_id: r.teacher_id,
      teacher_name: r.teacher_name,
      teacher_email: r.teacher_email,
      questions_count: count,
      status: r.status,
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
    };
  });
  return res.json({ submissions });
});

app.get("/api/admin/submissions/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(`
    SELECT s.id, s.teacher_id, s.questions_json, s.status, s.created_at,
           t.name as teacher_name, t.email as teacher_email
    FROM question_submissions s
    JOIN teachers t ON t.id = s.teacher_id
    WHERE s.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: "Надсилання не знайдено" });
  let questions = [];
  try {
    questions = JSON.parse(row.questions_json || "[]");
    if (!Array.isArray(questions)) questions = [];
  } catch (e) {}
  return res.json({
    submission: {
      id: row.id,
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      teacher_email: row.teacher_email,
      status: row.status,
      created_at: row.created_at,
    },
    questions,
  });
});

app.post("/api/admin/submissions/:id/approve", requireAdmin, (req, res) => {
  if (!QUESTIONS_FILE) {
    return res.status(503).json({ error: "Збереження питань не налаштовано (QUESTIONS_FILE)" });
  }
  const id = parseInt(req.params.id, 10);
  const row = db.prepare("SELECT id, teacher_id, questions_json, status FROM question_submissions WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Надсилання не знайдено" });
  if (row.status !== "pending") {
    return res.status(400).json({ error: "Надсилання вже розглянуто" });
  }
  let submitted = [];
  try {
    submitted = JSON.parse(row.questions_json || "[]");
    if (!Array.isArray(submitted)) submitted = [];
  } catch (e) {
    return res.status(400).json({ error: "Невірний формат даних надсилання" });
  }
  const adminId = getTeacherId(req);
  const now = new Date().toISOString();
  try {
    const existing = readQuestions();
    const base = Array.isArray(existing) ? existing : (existing.questions || existing.data || []);
    const merged = base.concat(submitted);
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(merged, null, 2), "utf8");
    const insertRev = db.prepare(
      "INSERT INTO question_revision_history (question_id, question_snapshot_json, teacher_id, action) VALUES (?, ?, ?, 'submitted_approved')"
    );
    submitted.forEach((q) => {
      const qid = q.id != null ? q.id : 0;
      insertRev.run(qid, JSON.stringify(q), row.teacher_id);
    });
    db.prepare(
      "UPDATE question_submissions SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?"
    ).run(now, adminId, id);
    return res.json({ ok: true, added: submitted.length, total: merged.length });
  } catch (e) {
    console.error("Помилка прийняття надсилання:", e);
    return res.status(500).json({ error: "Помилка запису: " + (e.message || "") });
  }
});

app.post("/api/admin/submissions/:id/reject", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare("SELECT id, status FROM question_submissions WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Надсилання не знайдено" });
  if (row.status !== "pending") {
    return res.status(400).json({ error: "Надсилання вже розглянуто" });
  }
  const adminId = getTeacherId(req);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE question_submissions SET status = 'rejected', reviewed_at = ?, reviewed_by = ? WHERE id = ?"
  ).run(now, adminId, id);
  return res.json({ ok: true });
});

app.post("/api/admin/upload-image", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не вибрано" });
  const relativePath = "img/" + req.file.filename;
  return res.json({ path: relativePath });
});

app.post("/api/teacher/upload-image", requireTeacher, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не вибрано" });
  const relativePath = "img/" + req.file.filename;
  return res.json({ path: relativePath });
});

// SPA fallback: teacher / admin pages (exact paths so /api/admin/* is never matched)
app.get("/teacher", (req, res) => res.sendFile(path.join(__dirname, "teacher.html")));
app.get("/teacher-editor", (req, res) => res.sendFile(path.join(__dirname, "teacher-editor.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/class/:id", (req, res) => res.sendFile(path.join(__dirname, "class.html")));
app.get("/student/:id", (req, res) => res.sendFile(path.join(__dirname, "student.html")));

// Static files (index.html, admin.html, teacher.html, etc.) — after API so /api/* is never served as files
app.use(express.static(path.join(__dirname)));

initQuestionsFile();

app.listen(PORT, () => {
  console.log(`Сервер: http://localhost:${PORT}`);
  console.log("Тест: головна сторінка. Вчитель: кнопка «Увійти як вчитель». Результати зберігаються в БД.");
  if (QUESTIONS_FILE) console.log("Питання: збереження у " + QUESTIONS_FILE);
});
