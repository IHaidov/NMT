// Константи структури тесту
const TOTAL_QUESTIONS = 22;
const SINGLE_CHOICE_COUNT = 15;
const MATCHING_COUNT = 3;
const SHORT_COUNT = 4;
const MAX_SCORE = 32;
const TEST_DURATION_MINUTES = 90;
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
const nameInput = document.getElementById("student-name");
const nameError = document.getElementById("name-error");
const startBtn = document.getElementById("start-btn");
const studentNameDisplay = document.getElementById("student-name-display");
const timerEl = document.getElementById("timer");
const questionGrid = document.getElementById("question-grid");
const questionCard = document.getElementById("question-card");
const questionIndexEl = document.getElementById("question-index");
const questionTopicEl = document.getElementById("question-topic");
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

function prepareTestQuestions() {
  const singles = allQuestions.filter((q) => classifyQuestion(q) === "single");
  const matchings = allQuestions.filter((q) => classifyQuestion(q) === "matching");
  const shorts = allQuestions.filter((q) => classifyQuestion(q) === "short");

  const selectedSingles = shuffle(singles).slice(0, SINGLE_CHOICE_COUNT);
  const selectedMatchings = shuffle(matchings).slice(0, MATCHING_COUNT);
  const selectedShorts = shuffle(shorts).slice(0, SHORT_COUNT);

  // Питання з відкритою відповіддю мають бути в кінці
  // Спочатку перемішуємо single та matching разом, потім додаємо short в кінці
  const firstPart = [...selectedSingles, ...selectedMatchings];
  const shuffledFirstPart = shuffle(firstPart);
  let combined = [...shuffledFirstPart, ...selectedShorts];

  // Якщо раптом не вистачило якихось типів — добираємо з решти питань (але не short)
  if (combined.length < TOTAL_QUESTIONS) {
    const usedIds = new Set(combined.map((q) => q.id));
    const remaining = shuffle(allQuestions.filter((q) => !usedIds.has(q.id) && classifyQuestion(q) !== "short"));
    combined = [...shuffledFirstPart, ...remaining.slice(0, TOTAL_QUESTIONS - combined.length), ...selectedShorts];
  }

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
  if (q.statements) return q.statements;
  if (q.expressions) return q.expressions;
  if (q.segments) return q.segments;
  // Структура з options як лівою частиною
  if (Array.isArray(q.options) && q.options[0] && q.options[0].matches) {
    const left = {};
    q.options.forEach((o) => {
      left[o.label] = o.text;
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
    const val = leftItems[key];
    if (typeof val === "string" && val.indexOf("\\") !== -1) {
      contentSpan.innerHTML = " " + wrapLatex(val);
    } else {
      contentSpan.textContent = " " + (val || "");
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
        window.MathJax.typesetPromise([wrap]).catch(() => {});
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
  questionTopicEl.textContent = q.topic || "";
  
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
      const answers = q.answer || [];
      qMax = answers.length;
      let localScore = 0;

      answers.forEach((pair) => {
        const key = pair.statement || pair.expression || pair.segment || pair.label;
        if (!key) return;
        const expected = pair.label;
        const actual = qObj.userAnswer ? qObj.userAnswer[key] : null;
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
      const lines = (question.answer || []).map((pair) => {
        const key = pair.statement || pair.expression || pair.segment || pair.label;
        return key ? `${key} → ${pair.label}` : "";
      });
      correctText = lines.filter(Boolean).join("; ");
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

function saveResultAndRedirect(result) {
  const studentName = studentNameDisplay.textContent || "";
  const payload = buildResultPayload(result, studentName);
  try {
    sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Не вдалося зберегти результат", e);
  }
  window.location.href = "results.html";
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
  clearInterval(timerInterval);
  clearTestState();

  // Блокуємо навігацію
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  flagBtn.disabled = true;
  finishBtn.disabled = true;
  questionGrid.querySelectorAll("button").forEach((btn) => (btn.disabled = true));

  const result = evaluateTest();
  saveResultAndRedirect(result);
}

// Обробники подій
startBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameError.textContent = "Будь ласка, введіть ваше ПІБ.";
    nameInput.focus();
    return;
  }
  nameError.textContent = "";

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

  startScreen.classList.add("hidden");
  testScreen.classList.remove("hidden");

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
finishBtn.addEventListener("click", () => finishTest(false));

// Відновлення тесту після оновлення сторінки
(function tryRestoreTest() {
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

  renderQuestionGrid();
  renderQuestion(currentIndex);
  startTimer(true);
})();

