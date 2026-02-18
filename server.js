const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const db = require("./db-init");

const app = express();
const PORT = 3000;
const SESSION_COOKIE = "nmt_teacher";
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
app.use(express.static(path.join(__dirname)));

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

// ——— Save attempt (student finished test) ———
app.post("/api/attempts", (req, res) => {
  const { email, name, score, percent, answers, incorrect } = req.body || {};
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
  db.prepare(
    "INSERT INTO test_attempts (student_id, student_email, student_name, score, percent, answers_json, incorrect_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(student.id, emailStr, nameStr, parseInt(score, 10), parseInt(percent, 10), answersJson, incorrectJson);
  return res.json({ ok: true, attemptId: db.prepare("SELECT last_insert_rowid() as id").get().id });
});

// ——— Admin (requireAdmin) ———
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

// SPA fallback: teacher / admin pages
app.get("/teacher*", (req, res) => res.sendFile(path.join(__dirname, "teacher.html")));
app.get("/admin*", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/class/:id*", (req, res) => res.sendFile(path.join(__dirname, "class.html")));
app.get("/student/:id*", (req, res) => res.sendFile(path.join(__dirname, "student.html")));

app.listen(PORT, () => {
  console.log(`Сервер: http://localhost:${PORT}`);
  console.log("Тест: головна сторінка. Вчитель: кнопка «Увійти як вчитель». Результати зберігаються в БД.");
});
