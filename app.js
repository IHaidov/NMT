// Константи структури тесту
const TOTAL_QUESTIONS = 22;
const SINGLE_CHOICE_COUNT = 15;
const MATCHING_COUNT = 3;
const SHORT_COUNT = 4;
const MAX_SCORE = 32;
const TEST_DURATION_MINUTES = 60;
const STORAGE_KEY = "nmt-test-state";
const RESULT_STORAGE_KEY = "nmt-test-result";

let allQuestions = [];
let testQuestions = [];
let currentIndex = 0;
let isFinished = false;
let timerInterval = null;
let endTime = null;

// Елементи DOM
const startScreen = document.getElementById("start-screen");
const testScreen = document.getElementById("test-screen");
const otpCodeInput = document.getElementById("otp-code");
const otpErrorEl = document.getElementById("otp-error");
const otpSuccessEl = document.getElementById("otp-success");
const otpSubmitBtn = document.getElementById("otp-submit-btn");
const nameInput = document.getElementById("student-name");
const emailInput = document.getElementById("student-email");
const nameError = document.getElementById("name-error");
const startBtn = document.getElementById("start-btn");
const studentNameDisplay = document.getElementById("student-name-display");
const timerEl = document.getElementById("timer");
const questionGrid = document.getElementById("question-grid");
const questionCard = document.getElementById("question-card");
const questionIndexEl = document.getElementById("question-index");
const questionContentEl = document.getElementById("question-content");
const questionImageEl = document.getElementById("question-image");
const questionBodyEl = document.getElementById("question-body");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const flagBtn = document.getElementById("flag-btn");
const finishBtn = document.getElementById("finish-btn");

// Допоміжні функції
function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function classifyQuestion(q) {
  if (q.answer_format === "decimal") {
    return "short";
  }
  // Завдання на встановлення відповідності: наявність statements / expressions / segments / endings
  if (q.statements || q.expressions || q.segments || q.endings) {
    return "matching";
  }
  // Деякі matching мають спеціальну структуру options + matches
  if (Array.isArray(q.options) && q.options.length && q.options[0].matches) {
    return "matching";
  }
  // За замовчуванням — тест з однією правильною відповіддю
  return "single";
}

function saveTestState() {
  if (isFinished || !testQuestions.length) return;
  try {
    const state = {
      studentName: studentNameDisplay.textContent || "",
      testQuestions,
      currentIndex,
      endTime,
      isFinished,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Не вдалося зберегти стан тесту", e);
  }
}

function loadTestState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearTestState() {
  sessionStorage.removeItem(STORAGE_KEY);
}

// Теми для відповідностей: 2 з алгебри (різні), 1 з геометрії
const ALGEBRA_TOPICS = [
  "Числа і вирази",
  "Рівняння і нерівності",
  "Функції, прогресії",
  "Елементи комбінаторики, початки теорії ймовірностей та елементи статистики",
];
const GEOMETRY_TOPICS = ["Планіметрія", "Стереометрія"];
// Завдання відкритої форми за номерами: 19 — функції/прогресії, 20 — комбінаторика/ймовірність, 21 — стереометрія, 22 — параметр
const SHORT_TOPIC_BY_SLOT = {
  19: "Функції, прогресії",
  20: "Елементи комбінаторики, початки теорії ймовірностей та елементи статистики",
  21: "Стереометрія",
  22: "Параметр",
};

function prepareTestQuestions() {
  const singles = allQuestions.filter((q) => classifyQuestion(q) === "single");
  const matchings = allQuestions.filter((q) => classifyQuestion(q) === "matching");
  const shorts = allQuestions.filter((q) => classifyQuestion(q) === "short");

  const selectedSingles = shuffle(singles).slice(0, SINGLE_CHOICE_COUNT);

  // Відповідності: 2 з алгебри (різні теми), 1 з геометрії
  const matchingByTopic = {};
  matchings.forEach((q) => {
    const t = q.topic || "";
    if (!matchingByTopic[t]) matchingByTopic[t] = [];
    matchingByTopic[t].push(q);
  });
  const selectedMatchings = [];
  const algebraAvailable = ALGEBRA_TOPICS.filter((t) => matchingByTopic[t] && matchingByTopic[t].length > 0);
  const geometryAvailable = GEOMETRY_TOPICS.filter((t) => matchingByTopic[t] && matchingByTopic[t].length > 0);
  const usedAlgebraTopics = new Set();
  for (let i = 0; i < 2 && usedAlgebraTopics.size < algebraAvailable.length; i++) {
    const topic = algebraAvailable.find((t) => !usedAlgebraTopics.has(t));
    if (!topic) break;
    const pool = shuffle(matchingByTopic[topic]);
    if (pool.length) {
      selectedMatchings.push(pool[0]);
      usedAlgebraTopics.add(topic);
    }
  }
  if (geometryAvailable.length > 0) {
    const geomTopic = geometryAvailable[Math.floor(Math.random() * geometryAvailable.length)];
    const pool = shuffle(matchingByTopic[geomTopic]).filter((q) => !selectedMatchings.includes(q));
    if (pool.length) selectedMatchings.push(pool[0]);
    else if (matchingByTopic[geomTopic].length) selectedMatchings.push(matchingByTopic[geomTopic][0]);
  }
  // Якщо не набрали 3 — добираємо з решти matching
  while (selectedMatchings.length < MATCHING_COUNT) {
    const rest = matchings.filter((q) => !selectedMatchings.includes(q));
    if (!rest.length) break;
    selectedMatchings.push(shuffle(rest)[0]);
  }

  // Відкрита форма: по одному завданню на тему для слотів 19–22
  const selectedShorts = [];
  [19, 20, 21, 22].forEach((slot) => {
    const needTopic = SHORT_TOPIC_BY_SLOT[slot];
    const pool = shorts.filter((q) => (q.topic || "") === needTopic && !selectedShorts.includes(q));
    if (pool.length) {
      selectedShorts.push(shuffle(pool)[0]);
    } else {
      const anyShort = shorts.find((q) => !selectedShorts.includes(q));
      if (anyShort) selectedShorts.push(anyShort);
    }
  });

  const combined = [...selectedSingles, ...selectedMatchings, ...selectedShorts];

  testQuestions = combined.map((q) => ({
    id: q.id,
    raw: q,
    type: classifyQuestion(q),
    userAnswer: null,
    flagged: false,
    visited: false,
  }));
}

function startTimer(useExistingEndTime = false) {
  if (!useExistingEndTime) {
    const durationMs = TEST_DURATION_MINUTES * 60 * 1000;
    endTime = Date.now() + durationMs;
  }

  function updateTimer() {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      timerEl.textContent = "Час вичерпано";
      clearInterval(timerInterval);
      if (!isFinished) {
        finishTest(true);
      }
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `Залишилось: ${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function renderQuestionGrid() {
  questionGrid.innerHTML = "";
  testQuestions.forEach((q, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "question-tile unanswered";
    btn.textContent = idx + 1;
    btn.dataset.index = idx;
    btn.addEventListener("click", () => {
      if (!isFinished) {
        goToQuestion(idx);
      }
    });
    questionGrid.appendChild(btn);
  });
  updateQuestionGridStyles();
}

function updateQuestionGridStyles() {
  const tiles = questionGrid.querySelectorAll(".question-tile");
  tiles.forEach((tile) => {
    const idx = Number(tile.dataset.index);
    const q = testQuestions[idx];
    tile.classList.remove("current", "answered", "unanswered", "flagged");
    if (idx === currentIndex) {
      tile.classList.add("current");
    }
    if (q.flagged) {
      tile.classList.add("flagged");
    } else if (q.userAnswer !== null && q.userAnswer !== undefined && q.userAnswer !== "") {
      tile.classList.add("answered");
    } else {
      tile.classList.add("unanswered");
    }
  });
}

function wrapLatex(latex) {
  if (!latex) return "";
  return `\\(${latex}\\)`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderSingleChoice(qObj) {
  const q = qObj.raw;
  const container = document.createElement("ul");
  container.className = "options-list";

  (q.options || []).forEach((opt) => {
    const li = document.createElement("li");
    li.className = "option-item";

    if (qObj.userAnswer === opt.label) {
      li.classList.add("selected");
    }

    li.addEventListener("click", () => {
      if (isFinished) return;
      qObj.userAnswer = opt.label;
      updateQuestionGridStyles();
      renderQuestion(currentIndex); // перерисувати, щоб відобразити вибір
    });

    const badge = document.createElement("div");
    badge.className = "option-label-badge";
    badge.textContent = opt.label;

    const content = document.createElement("div");
    content.className = "option-content";

    // У відповідях показуємо лише LaTeX (якщо є), інакше текст
    const optionDisplay = document.createElement("div");
    optionDisplay.className = "option-main-text";
    if (opt.latex) {
      optionDisplay.innerHTML = wrapLatex(opt.latex);
    } else {
      optionDisplay.textContent = opt.text || "";
    }
    content.appendChild(optionDisplay);

    li.appendChild(badge);
    li.appendChild(content);
    container.appendChild(li);
  });

  questionBodyEl.appendChild(container);
}

function getMatchingLeftItems(q) {
  // Масиви об'єктів { label, text } — нормалізуємо до { label: text }, щоб не показувати [object Object]
  const toLeft = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    const first = arr[0];
    if (first && typeof first === "object" && (first.text != null || first.latex != null)) {
      const left = {};
      arr.forEach((o) => {
        left[o.label] = o.text != null ? o.text : (o.latex != null ? o.latex : "");
      });
      return left;
    }
    return null;
  };
  if (q.statements) {
    const normalized = toLeft(q.statements);
    if (normalized) return normalized;
    return q.statements;
  }
  if (q.expressions) {
    const normalized = toLeft(q.expressions);
    if (normalized) return normalized;
    return q.expressions;
  }
  if (q.segments) {
    const normalized = toLeft(q.segments);
    if (normalized) return normalized;
    return q.segments;
  }
  // Структура з options як лівою частиною
  if (Array.isArray(q.options) && q.options[0] && q.options[0].matches) {
    const left = {};
    q.options.forEach((o) => {
      left[o.label] = o.text != null ? o.text : (o.latex != null ? o.latex : "");
    });
    return left;
  }
  return {};
}

function getMatchingRightOptions(q) {
  if (q.endings) return q.endings;
  if (q.options && !Array.isArray(q.options)) return q.options;
  if (Array.isArray(q.options)) {
    const right = {};
    q.options.forEach((o) => {
      right[o.label] = o.text || o.latex || "";
    });
    return right;
  }
  return {};
}

function renderMatching(qObj) {
  const q = qObj.raw;
  const leftItems = getMatchingLeftItems(q);
  const rightOptions = getMatchingRightOptions(q);

  const table = document.createElement("table");
  table.className = "matching-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = "<th>Початок</th><th>Вибране закінчення</th>";
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const leftKeys = Object.keys(leftItems).sort();
  const rightKeys = Object.keys(rightOptions).sort();

  if (!qObj.userAnswer) {
    qObj.userAnswer = {};
  }

  leftKeys.forEach((key) => {
    const row = document.createElement("tr");
    const leftTd = document.createElement("td");
    const rightTd = document.createElement("td");

    const labelSpan = document.createElement("span");
    labelSpan.className = "matching-label";
    labelSpan.textContent = key + ")";

    const contentSpan = document.createElement("span");
    let val = leftItems[key];
    if (val != null && typeof val === "object") {
      val = val.text != null ? val.text : (val.latex != null ? val.latex : "");
    }
    const str = val != null ? String(val) : "";
    const looksLikeLatex = typeof str === "string" && (str.indexOf("\\") !== -1 || str.indexOf("^{") !== -1 || str.indexOf("_{") !== -1);
    if (looksLikeLatex) {
      contentSpan.innerHTML = " " + wrapLatex(str);
    } else {
      contentSpan.textContent = " " + str;
    }

    leftTd.appendChild(labelSpan);
    leftTd.appendChild(contentSpan);

    const rightOptionStr = (rKey) => {
      const raw = rightOptions[rKey];
      return raw == null ? "" : String(raw);
    };
    const hasLatex = rightKeys.some((rKey) => rightOptionStr(rKey).indexOf("\\") !== -1);

    if (hasLatex) {
      const wrap = document.createElement("div");
      wrap.className = "matching-select-custom";
      wrap.dataset.leftKey = key;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "matching-select-trigger";
      const triggerLabel = document.createElement("span");
      triggerLabel.className = "matching-select-trigger-label";
      const triggerMath = document.createElement("span");
      triggerMath.className = "matching-select-trigger-math";
      trigger.appendChild(triggerLabel);
      trigger.appendChild(triggerMath);

      const selectedKey = qObj.userAnswer[key];
      if (selectedKey && rightOptions[selectedKey] != null) {
        triggerLabel.textContent = selectedKey + ") ";
        triggerMath.innerHTML = wrapLatex(rightOptionStr(selectedKey));
      } else {
        triggerLabel.textContent = "— оберіть літеру —";
      }

      const dropdown = document.createElement("div");
      dropdown.className = "matching-select-dropdown";
      dropdown.hidden = true;
      rightKeys.forEach((rKey) => {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "matching-select-option";
        opt.dataset.value = rKey;
        const optLabel = document.createElement("span");
        optLabel.className = "matching-option-label";
        optLabel.textContent = rKey + ") ";
        const optMath = document.createElement("span");
        optMath.className = "matching-option-math";
        optMath.innerHTML = wrapLatex(rightOptionStr(rKey));
        opt.appendChild(optLabel);
        opt.appendChild(optMath);
        dropdown.appendChild(opt);
      });

      wrap.appendChild(trigger);
      wrap.appendChild(dropdown);

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isFinished) return;
        const open = wrap.classList.contains("matching-select-open");
        document.querySelectorAll(".matching-select-custom.matching-select-open").forEach((w) => {
          w.classList.remove("matching-select-open");
          w.querySelector(".matching-select-dropdown").hidden = true;
        });
        if (!open) {
          wrap.classList.add("matching-select-open");
          dropdown.hidden = false;
          if (!dropdown.dataset.typeset && window.MathJax && window.MathJax.typesetPromise) {
            dropdown.dataset.typeset = "1";
            window.MathJax.typesetPromise([dropdown]).catch(() => {});
          }
        }
      });

      dropdown.querySelectorAll(".matching-select-option").forEach((optBtn) => {
        optBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const val = optBtn.dataset.value;
          qObj.userAnswer[key] = val;
          triggerLabel.textContent = val + ") ";
          triggerMath.innerHTML = wrapLatex(rightOptionStr(val));
          wrap.classList.remove("matching-select-open");
          dropdown.hidden = true;
          updateQuestionGridStyles();
          if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([trigger]).catch(() => {});
          }
        });
      });

      document.addEventListener("click", function closeDropdown(ev) {
        if (!wrap.contains(ev.target)) {
          wrap.classList.remove("matching-select-open");
          dropdown.hidden = true;
        }
      });

      rightTd.appendChild(wrap);
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([trigger]).catch(() => {});
      }
    } else {
      const select = document.createElement("select");
      select.className = "matching-select";
      select.dataset.leftKey = key;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "— оберіть літеру —";
      select.appendChild(placeholder);
      rightKeys.forEach((rKey) => {
        const opt = document.createElement("option");
        opt.value = rKey;
        opt.textContent = `${rKey}) ${rightOptions[rKey]}`;
        select.appendChild(opt);
      });
      if (qObj.userAnswer[key]) select.value = qObj.userAnswer[key];
      select.addEventListener("change", (e) => {
        if (isFinished) return;
        qObj.userAnswer[e.target.dataset.leftKey] = e.target.value;
        updateQuestionGridStyles();
      });
      rightTd.appendChild(select);
    }
    row.appendChild(leftTd);
    row.appendChild(rightTd);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  questionBodyEl.appendChild(table);
}

function renderShortAnswer(qObj) {
  const wrapper = document.createElement("div");
  wrapper.className = "short-answer-wrapper";

  const label = document.createElement("div");
  label.className = "short-answer-label";
  label.textContent = "Введіть вашу відповідь (число):";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "short-answer-input";
  input.value = qObj.userAnswer || "";

  input.addEventListener("input", (e) => {
    if (isFinished) return;
    qObj.userAnswer = e.target.value.trim();
    updateQuestionGridStyles();
  });

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  questionBodyEl.appendChild(wrapper);
}

function renderQuestion(index) {
  const qObj = testQuestions[index];
  if (!qObj) return;

  qObj.visited = true;

  const q = qObj.raw;

  questionIndexEl.textContent = `Завдання ${index + 1} з ${testQuestions.length}`;

  // Питання: HTML з екрануванням, щоб inline LaTeX \(...\) міг бути відрендерений MathJax при кожному переході
  questionContentEl.innerHTML = "";
  if (q.question) {
    const questionText = document.createElement("div");
    questionText.className = "question-text";
    questionText.innerHTML = escapeHtml(q.question);
    questionContentEl.appendChild(questionText);
  }

  questionBodyEl.innerHTML = "";

  // Зображення, якщо є
  questionImageEl.innerHTML = "";
  if (q.image) {
    const img = document.createElement("img");
    img.src = q.image;
    img.alt = "Ілюстрація до завдання";
    questionImageEl.appendChild(img);
  }

  // Тип завдання
  if (qObj.type === "single") {
    renderSingleChoice(qObj);
  } else if (qObj.type === "matching") {
    renderMatching(qObj);
  } else if (qObj.type === "short") {
    renderShortAnswer(qObj);
  }

  // Стан кнопки прапорця
  if (qObj.flagged) {
    flagBtn.classList.add("active");
    flagBtn.querySelector(".flag-text").textContent = "Зняти позначку";
  } else {
    flagBtn.classList.remove("active");
    flagBtn.querySelector(".flag-text").textContent = "Позначити питання";
  }

  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === testQuestions.length - 1;

  updateQuestionGridStyles();

  // MathJax для питання та варіантів відповідей, щоб формули рендерились при кожному переході
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([questionContentEl, questionBodyEl]).catch(() => {});
  }

  if (!isFinished) saveTestState();
}

function goToQuestion(index) {
  currentIndex = index;
  renderQuestion(currentIndex);
  // Плавна прокрутка до питання, щоб уникнути стрибання
  setTimeout(() => {
    questionCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 50);
}

function toggleFlag() {
  const qObj = testQuestions[currentIndex];
  if (!qObj) return;
  qObj.flagged = !qObj.flagged;
  renderQuestion(currentIndex);
}

function normalizeNumber(str) {
  if (typeof str !== "string") return null;
  const normalized = str.replace(",", ".").trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/** Повертає масив пар { key, label } для matching: підтримує answer як масив або об'єкт (1→Д, 2→Г). */
function getMatchingAnswerPairs(q) {
  const a = q.answer;
  if (!a) return [];
  if (Array.isArray(a)) {
    return a
      .map((p) => ({ key: p.statement || p.expression || p.segment || p.label, label: p.label }))
      .filter((p) => p.key);
  }
  if (typeof a === "object") {
    return Object.entries(a).map(([key, label]) => ({ key: String(key), label: String(label) }));
  }
  return [];
}

function evaluateTest() {
  let score = 0;
  const incorrect = [];

  testQuestions.forEach((qObj, idx) => {
    const q = qObj.raw;
    let qScore = 0;
    let qMax = 0;
    let isCorrect = false;

    if (qObj.type === "single") {
      qMax = 1;
      const correctLabels = (q.answer || []).map((a) => a.label);
      if (qObj.userAnswer && correctLabels.includes(qObj.userAnswer)) {
        qScore = 1;
        isCorrect = true;
      }
    } else if (qObj.type === "matching") {
      // 0–3 бали: за кожну правильно встановлену пару +1
      const pairs = getMatchingAnswerPairs(q);
      qMax = pairs.length;
      let localScore = 0;

      pairs.forEach((pair) => {
        const expected = pair.label;
        const actual = qObj.userAnswer ? qObj.userAnswer[pair.key] : null;
        if (actual && actual === expected) {
          localScore += 1;
        }
      });

      qScore = localScore;
      isCorrect = localScore === qMax;
    } else if (qObj.type === "short") {
      // 0 або 2 бали
      qMax = 2;
      const correctStr = typeof q.answer === "string" ? q.answer : String(q.answer);
      const studentNum = normalizeNumber(qObj.userAnswer || "");
      const correctNum = normalizeNumber(correctStr);

      if (studentNum !== null && correctNum !== null && Math.abs(studentNum - correctNum) < 1e-6) {
        qScore = 2;
        isCorrect = true;
      }
    }

    score += qScore;

    if (!isCorrect) {
      incorrect.push({
        index: idx,
        question: q,
        type: qObj.type,
        userAnswer: qObj.userAnswer,
      });
    }
  });

  const percent = Math.round((score / MAX_SCORE) * 100);
  return { score, percent, incorrect };
}

function getComment(percent) {
  if (percent >= 90) return "Відмінний результат! Ви чудово підготовлені до НМТ.";
  if (percent >= 70) return "Гарний результат. Зверніть увагу на завдання з помилками, щоб закріпити матеріал.";
  return "Є над чим попрацювати. Проаналізуйте завдання з помилками та повторіть відповідні теми.";
}

function buildResultPayload(result, studentName) {
  const incorrectSerialized = result.incorrect.map((item) => {
    const { index, question, type, userAnswer } = item;
    let correctText = "";
    let correctLatex = "";
    if (type === "single") {
      const correctTexts = (question.answer || []).map((a) => `${a.label}) ${a.text || ""}`);
      correctText = correctTexts.join(", ");
      const ans = (question.answer || [])[0];
      if (ans && ans.latex != null) correctLatex = ans.latex;
    } else if (type === "matching") {
      const pairs = getMatchingAnswerPairs(question);
      correctText = pairs.map((p) => `${p.key} → ${p.label}`).join("; ");
    } else if (type === "short") {
      correctText = typeof question.answer === "string" ? question.answer : String(question.answer);
    }
    let yourText = "—";
    let yourLatex = "";
    if (type === "single") {
      const chosen = (question.options || []).find((o) => o.label === userAnswer);
      yourText = chosen ? `${chosen.label}) ${chosen.text || ""}` : "—";
      if (chosen && chosen.latex != null) yourLatex = chosen.latex;
    } else if (type === "matching" && userAnswer && typeof userAnswer === "object") {
      yourText = Object.entries(userAnswer).map(([k, v]) => `${k} → ${v}`).join("; ");
    } else if (type === "short") {
      yourText = userAnswer && userAnswer !== "" ? userAnswer : "—";
    }
    return {
      index: index + 1,
      questionText: question.question || "",
      type,
      yourText,
      correctText,
      yourLatex: yourLatex || undefined,
      correctLatex: correctLatex || undefined,
    };
  });
  return {
    studentName: studentName || "",
    score: result.score,
    percent: result.percent,
    comment: getComment(result.percent),
    incorrect: incorrectSerialized,
  };
}

function buildFullAnswers(result) {
  const answers = [];
  testQuestions.forEach((qObj, idx) => {
    const q = qObj.raw;
    const type = qObj.type;
    const userAnswer = qObj.userAnswer;
    let correctAnswer = "";
    let isCorrect = false;
    let points = 0;
    let options = [];
    let yourLatex = "";
    let correctLatex = "";

    if (type === "single") {
      const ans = (q.answer || [])[0];
      correctAnswer = ans ? `${ans.label}) ${ans.text || ""}` : "";
      isCorrect = ans && userAnswer === ans.label;
      points = isCorrect ? 1 : 0;
      options = (q.options || []).map((o) => ({ label: o.label, text: o.text || "", latex: o.latex != null ? o.latex : undefined }));
      if (ans && ans.latex != null) correctLatex = ans.latex;
      const chosen = (q.options || []).find((o) => o.label === userAnswer);
      if (chosen && chosen.latex != null) yourLatex = chosen.latex;
    } else if (type === "matching") {
      const pairs = getMatchingAnswerPairs(q);
      correctAnswer = pairs.map((p) => `${p.key}→${p.label}`).join("; ");
      let cnt = 0;
      pairs.forEach((p) => {
        if (userAnswer && userAnswer[p.key] === p.label) cnt++;
      });
      points = cnt;
      isCorrect = cnt === pairs.length;
      options = pairs.map((p) => ({ key: p.key, label: p.label }));
    } else if (type === "short") {
      correctAnswer = typeof q.answer === "string" ? q.answer : String(q.answer);
      const sn = normalizeNumber(userAnswer);
      const cn = normalizeNumber(correctAnswer);
      isCorrect = sn != null && cn != null && Math.abs(sn - cn) < 1e-6;
      points = isCorrect ? 2 : 0;
    }

    answers.push({
      index: idx + 1,
      questionText: q.question || "",
      questionLatex: q.latex != null ? q.latex : undefined,
      image: q.image || undefined,
      type,
      points,
      userAnswer: type === "matching" ? userAnswer : (userAnswer != null ? String(userAnswer) : ""),
      correctAnswer,
      isCorrect,
      options,
      yourLatex: yourLatex || undefined,
      correctLatex: correctLatex || undefined,
    });
  });
  return answers;
}

function saveResultAndRedirect(result, studentEmail) {
  const studentName = studentNameDisplay.textContent || "";
  const payload = buildResultPayload(result, studentName);
  const fullAnswers = buildFullAnswers(result);
  payload.answers = fullAnswers;
  const json = JSON.stringify(payload);
  try {
    sessionStorage.setItem(RESULT_STORAGE_KEY, json);
    try {
      localStorage.setItem(RESULT_STORAGE_KEY, json);
    } catch (_) {}
  } catch (e) {
    console.warn("Не вдалося зберегти результат", e);
  }
  fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: studentEmail || "",
      name: studentName,
      score: result.score,
      percent: result.percent,
      answers: fullAnswers,
      incorrect: payload.incorrect,
    }),
  }).catch(() => {});
  // Невелика затримка, щоб браузер встиг записати storage перед переходом (особливо при завершенні по таймеру)
  setTimeout(function () {
    window.location.href = "results.html";
  }, 50);
}

function finishTest(auto = false) {
  if (isFinished) return;
  if (!auto) {
    const confirmed = window.confirm(
      "Після завершення тесту змінювати відповіді буде неможливо. Ви впевнені, що хочете завершити?"
    );
    if (!confirmed) return;
  }

  isFinished = true;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  clearTestState();

  // Блокуємо навігацію
  if (prevBtn) prevBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
  if (flagBtn) flagBtn.disabled = true;
  if (finishBtn) finishBtn.disabled = true;
  if (questionGrid) questionGrid.querySelectorAll("button").forEach((btn) => (btn.disabled = true));

  try {
    const result = evaluateTest();
    const studentEmail = typeof window.studentEmail === "string" ? window.studentEmail : "";
    saveResultAndRedirect(result, studentEmail);
  } catch (e) {
    console.error("Помилка при завершенні тесту:", e);
    try {
      const fallback = { score: 0, percent: 0, incorrect: [] };
      const name = studentNameDisplay ? studentNameDisplay.textContent : "";
      const payload = buildResultPayload(fallback, name || "");
      payload.answers = buildFullAnswers(fallback);
      const json = JSON.stringify(payload);
      sessionStorage.setItem(RESULT_STORAGE_KEY, json);
      try {
        localStorage.setItem(RESULT_STORAGE_KEY, json);
      } catch (_) {}
    } catch (_) {}
    setTimeout(function () {
      window.location.href = "results.html";
    }, 50);
  }
}

// Обробники подій
startBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const email = emailInput ? emailInput.value.trim() : "";
  if (!name) {
    nameError.textContent = "Будь ласка, введіть ваше ПІБ.";
    nameInput.focus();
    return;
  }
  if (!email) {
    nameError.textContent = "Будь ласка, введіть електронну пошту.";
    if (emailInput) emailInput.focus();
    return;
  }
  nameError.textContent = "";
  window.studentEmail = email;

  try {
    const joinRes = await fetch("/api/student/join-class", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name }),
    });
    if (joinRes.status === 401) {
      nameError.textContent = "Спочатку введіть код доступу класу вище.";
      return;
    }
    if (!joinRes.ok) {
      const err = await joinRes.json().catch(() => ({}));
      nameError.textContent = (err && err.error) || "Помилка прив’язки до класу.";
      return;
    }
  } catch (e) {
    nameError.textContent = "Помилка з’єднання. Перевірте, що ви ввели код класу.";
    return;
  }

  try {
    const res = await fetch("./db.json");
    if (!res.ok) {
      throw new Error("Не вдалося завантажити питання.");
    }
    allQuestions = await res.json();
  } catch (e) {
    console.error(e);
    nameError.textContent =
      "Не вдалося завантажити завдання. Запустіть локальний сервер: у папці проєкту виконайте «npm start» і відкрийте http://localhost:3000 у браузері.";
    return;
  }

  prepareTestQuestions();
  renderQuestionGrid();
  studentNameDisplay.textContent = name;
  if (emailInput) emailInput.disabled = true;

  startScreen.classList.add("hidden");
  testScreen.classList.remove("hidden");
  document.body.classList.add("test-active");

  startTimer();
  currentIndex = 0;
  renderQuestion(currentIndex);
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) {
    goToQuestion(currentIndex - 1);
  }
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < testQuestions.length - 1) {
    goToQuestion(currentIndex + 1);
  }
});

flagBtn.addEventListener("click", toggleFlag);
if (finishBtn) finishBtn.addEventListener("click", () => finishTest(false));
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "finish-btn") finishTest(false);
});

// Усі бачать стартовий екран; тест можна почати лише після підтвердження коду класу
(function initOtpAndRestore() {
  // Якщо є валідний доступ і збережений тест — відновити його
  fetch("/api/otp/session", { credentials: "include" })
    .then((r) => r.json())
    .then((data) => {
      if (data && data.valid) tryRestoreTest();
    })
    .catch(() => {});

  if (otpSubmitBtn && otpCodeInput) {
    otpSubmitBtn.addEventListener("click", () => {
      const code = otpCodeInput.value.trim();
      if (otpErrorEl) otpErrorEl.textContent = "";
      if (otpSuccessEl) otpSuccessEl.textContent = "";
      if (!code) {
        if (otpErrorEl) otpErrorEl.textContent = "Введіть код доступу.";
        return;
      }
      otpSubmitBtn.disabled = true;
      fetch("/api/otp/validate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data && data.valid) {
            if (otpErrorEl) otpErrorEl.textContent = "";
            if (otpSuccessEl) otpSuccessEl.textContent = "Код прийнято. Тепер введіть ПІБ та пошту і натисніть «Почати тест».";
            otpCodeInput.value = "";
            tryRestoreTest();
          } else {
            if (otpErrorEl) otpErrorEl.textContent = (data && data.error) || "Невірний або прострочений код.";
          }
        })
        .catch(() => {
          if (otpErrorEl) otpErrorEl.textContent = "Помилка перевірки коду.";
        })
        .finally(() => {
          otpSubmitBtn.disabled = false;
        });
    });
    otpCodeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") otpSubmitBtn.click();
    });
  }
})();

// Відновлення тесту після оновлення сторінки
function tryRestoreTest() {
  const state = loadTestState();
  if (!state || state.isFinished || !Array.isArray(state.testQuestions) || state.testQuestions.length === 0) {
    return;
  }

  testQuestions = state.testQuestions;
  currentIndex = state.currentIndex;
  endTime = state.endTime;
  isFinished = state.isFinished;

  studentNameDisplay.textContent = state.studentName || "";
  startScreen.classList.add("hidden");
  testScreen.classList.remove("hidden");
  document.body.classList.add("test-active");

  renderQuestionGrid();
  renderQuestion(currentIndex);
  startTimer(true);
}

