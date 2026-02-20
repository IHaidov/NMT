(function () {
  var questions = [];
  var currentIndex = -1;
  var lastFocusedInput = null;
  var teacherIsAdmin = false;
  var COPY_STORAGE_KEY = "nmt-editor-copied-question";
  var EDITOR_STATE_KEY = "nmt-editor-state";

  var authRequired = document.getElementById("editor-auth-required");
  var editorRoot = document.getElementById("editor-root");
  var questionList = document.getElementById("question-list");
  var questionForm = document.getElementById("question-form");
  var noSelection = document.getElementById("no-selection");
  var fId = document.getElementById("f-id");
  var fTopic = document.getElementById("f-topic");
  var fQuestion = document.getElementById("f-question");
  var fLatex = document.getElementById("f-latex");
  var fImage = document.getElementById("f-image");
  var fType = document.getElementById("f-type");
  var panelSingle = document.getElementById("panel-single");
  var panelMatching = document.getElementById("panel-matching");
  var panelShort = document.getElementById("panel-short");
  var singleOptions = document.getElementById("single-options");
  var fSingleCorrect = document.getElementById("f-single-correct");
  var matchingLeft = document.getElementById("matching-left");
  var matchingRight = document.getElementById("matching-right");
  var matchingPairs = document.getElementById("matching-pairs");
  var fShortAnswer = document.getElementById("f-short-answer");
  var fImageFile = document.getElementById("f-image-file");
  var imagePreviewWrap = document.getElementById("image-preview-wrap");
  var imagePreview = document.getElementById("image-preview");
  var saveStatus = document.getElementById("save-status");
  var saveAllStatus = document.getElementById("save-all-status");

  function updateImagePreview() {
    var path = (fImage.value || "").trim();
    if (!path) {
      imagePreviewWrap.classList.add("hidden");
      return;
    }
    imagePreviewWrap.classList.remove("hidden");
    imagePreview.src = path;
    imagePreview.alt = "Зображення завдання";
    imagePreview.onerror = function () {
      imagePreview.alt = "Зображення не завантажилось (перевірте шлях)";
    };
    imagePreview.onload = function () {
      imagePreview.alt = "Зображення завдання";
    };
  }

  function api(path, opts) {
    return fetch(path, { credentials: "include", ...opts }).then(function (r) {
      if (r.status === 401) return Promise.reject(new Error("Не авторизовано"));
      return r.text().then(function (text) {
        var trimmed = text.trim();
        if (trimmed.indexOf("<") === 0 && trimmed.toLowerCase().indexOf("<!doctype") !== -1) {
          return Promise.reject(new Error("Сервер повернув сторінку замість даних. Увійдіть знову або перевірте адресу."));
        }
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          return Promise.reject(new Error("Некоректна відповідь сервера"));
        }
        if (!r.ok) throw new Error(data.error || "Помилка");
        return data;
      });
    });
  }

  function trackFocus(el) {
    if (!el) return;
    el.addEventListener("focus", function () { lastFocusedInput = el; });
  }

  function insertAtCursor(text) {
    var el = lastFocusedInput;
    if (!el) return;
    if (typeof el.selectionStart !== "number") {
      el.value += text;
      return;
    }
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var val = el.value;
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  }

  function initLatexHelper() {
    var snippets = [
      { label: "Дріб \\frac{a}{b}", insert: "\\frac{}{}" },
      { label: "Корінь \\sqrt{}", insert: "\\sqrt{}" },
      { label: "Степінь x^{}", insert: "^{}" },
      { label: "Індекс x_{}", insert: "_{}" },
      { label: "Нескінченність", insert: "\\infty" },
      { label: "≥ \\ge", insert: "\\ge" },
      { label: "≤ \\le", insert: "\\le" },
      { label: "Не дорівнює \\ne", insert: "\\ne" },
      { label: "Приблизно \\approx", insert: "\\approx" },
      { label: "Кут \\angle", insert: "\\angle" },
      { label: "Трикутник \\triangle", insert: "\\triangle" },
      { label: "Точка \\cdot", insert: "\\cdot" },
      { label: "Дужки \\left( \\right)", insert: "\\left( \\right)" },
      { label: "Лог \\log", insert: "\\log" },
      { label: "Син \\sin", insert: "\\sin" },
      { label: "Кос \\cos", insert: "\\cos" },
    ];
    var container = document.getElementById("latex-btns");
    snippets.forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = s.label;
      btn.title = "Вставити: " + s.insert;
      btn.addEventListener("click", function () { insertAtCursor(s.insert); });
      container.appendChild(btn);
    });
  }

  function classify(q) {
    if (q.answer_format === "decimal") return "short";
    if (q.statements || q.expressions || q.segments || q.endings) return "matching";
    if (Array.isArray(q.options) && q.options[0] && q.options[0].matches) return "matching";
    return "single";
  }

  var questionSearch = document.getElementById("question-search");
  var questionSort = document.getElementById("question-sort");

  function getFilteredAndSortedIndices() {
    var query = (questionSearch && questionSearch.value || "").trim().toLowerCase();
    var sortKey = (questionSort && questionSort.value) || "id";
    var indices = questions.map(function (_, i) { return i; });
    if (query) {
      indices = indices.filter(function (i) {
        var q = questions[i];
        var text = ((q.question || "") + " " + (q.topic || "")).replace(/<[^>]+>/g, "").toLowerCase();
        return text.indexOf(query) !== -1;
      });
    }
    indices.sort(function (a, b) {
      var qa = questions[a];
      var qb = questions[b];
      if (sortKey === "id") {
        var idA = qa.id != null ? qa.id : 0;
        var idB = qb.id != null ? qb.id : 0;
        return idA - idB;
      }
      if (sortKey === "topic") {
        var ta = (qa.topic || "").toLowerCase();
        var tb = (qb.topic || "").toLowerCase();
        return ta.localeCompare(tb);
      }
      if (sortKey === "type") {
        var typeA = classify(qa);
        var typeB = classify(qb);
        return typeA.localeCompare(typeB);
      }
      return 0;
    });
    return indices;
  }

  function renderList() {
    questionList.innerHTML = "";
    var indices = getFilteredAndSortedIndices();
    indices.forEach(function (idx) {
      var q = questions[idx];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#";
      a.dataset.index = idx;
      var typeLabel = classify(q) === "single" ? "Варіант" : (classify(q) === "matching" ? "Відповідність" : "Коротка");
      var questionRaw = (q.question || "").replace(/<[^>]+>/g, "");
      var topicRaw = (q.topic || "—");
      a.innerHTML = "<span class=\"q-preview math-render\">" + escapeHtml(questionRaw) + "</span><span class=\"q-meta math-render\">" + escapeHtml(topicRaw) + " · " + escapeHtml(typeLabel) + "</span>";
      a.addEventListener("click", function (e) { e.preventDefault(); selectQuestion(idx); });
      li.appendChild(a);
      questionList.appendChild(li);
    });
    updateListActiveState();
    typesetMath(questionList);
  }

  function renderTable() {
    var tbody = document.getElementById("question-table-body");
    if (!tbody) return;
    var indices = getFilteredAndSortedIndices();
    tbody.innerHTML = "";
    indices.forEach(function (idx) {
      var q = questions[idx];
      var tr = document.createElement("tr");
      tr.dataset.index = idx;
      tr.title = "Клікніть, щоб відкрити завдання";
      if (idx === currentIndex) tr.classList.add("selected");
      var questionRaw = (q.question || "").replace(/<[^>]+>/g, "").trim() || "—";
      var typeLabel = classify(q) === "single" ? "Варіант" : (classify(q) === "matching" ? "Відповідність" : "Коротка");
      var topicRaw = (q.topic || "").trim() || "—";
      tr.innerHTML = "<td>" + (q.id != null ? q.id : "—") + "</td><td class=\"col-topic math-render\">" + escapeHtml(topicRaw) + "</td><td class=\"col-preview math-render\">" + escapeHtml(questionRaw) + "</td><td class=\"col-type\">" + escapeHtml(typeLabel) + "</td><td>" + (q._local ? "<span class=\"tag-local\">локальне</span>" : "") + "</td>";
      tr.addEventListener("click", function () { selectQuestion(idx); });
      tbody.appendChild(tr);
    });
    typesetMath(tbody);
  }

  function typesetMath(container) {
    if (!container || !window.MathJax || !window.MathJax.typesetPromise) return;
    window.MathJax.typesetPromise([container]).catch(function () {});
  }

  function updateEditorView() {
    var layout = editorRoot;
    var tableWrap = document.getElementById("tasks-table-full-wrap");
    var editorContentWrap = document.getElementById("editor-content-wrap");
    if (!layout || !tableWrap || !editorContentWrap) return;
    var inTable = currentIndex < 0;
    layout.classList.toggle("table-view", inTable);
    tableWrap.classList.toggle("hidden", !inTable);
    editorContentWrap.classList.toggle("hidden", inTable);
    if (inTable) {
      renderTable();
    } else {
      renderList();
    }
  }

  function updateListActiveState() {
    questionList.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("active", parseInt(a.dataset.index, 10) === currentIndex);
    });
    var tbody = document.getElementById("question-table-body");
    if (tbody) tbody.querySelectorAll("tr").forEach(function (tr) {
      tr.classList.toggle("selected", parseInt(tr.dataset.index, 10) === currentIndex);
    });
  }

  function escapeHtml(s) {
    if (s == null) return "";
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function selectQuestion(idx) {
    currentIndex = idx;
    updateEditorView();
    noSelection.classList.add("hidden");
    questionForm.classList.remove("hidden");
    fillForm(questions[idx]);
    try {
      var q = questions[idx];
      sessionStorage.setItem(EDITOR_STATE_KEY, JSON.stringify({ view: "editor", questionId: q && q.id != null ? q.id : null }));
    } catch (e) {}
  }

  function goToTable() {
    currentIndex = -1;
    noSelection.classList.remove("hidden");
    questionForm.classList.add("hidden");
    updateEditorView();
    try {
      sessionStorage.setItem(EDITOR_STATE_KEY, JSON.stringify({ view: "table", questionId: null }));
    } catch (e) {}
  }

  function restoreEditorState() {
    try {
      var raw = sessionStorage.getItem(EDITOR_STATE_KEY);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (state.view === "table") return;
      if (state.questionId == null) return;
      var idx = -1;
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].id == state.questionId) { idx = i; break; }
      }
      if (idx < 0) return;
      currentIndex = idx;
      noSelection.classList.add("hidden");
      questionForm.classList.remove("hidden");
      fillForm(questions[idx]);
      updateEditorView();
    } catch (e) {}
  }

  function fillForm(q) {
    if (!q) return;
    fId.value = q.id != null ? q.id : "";
    fTopic.value = q.topic || "";
    fQuestion.value = q.question || "";
    fLatex.value = q.latex || "";
    fImage.value = q.image || "";
    updateImagePreview();
    var type = classify(q);
    fType.value = type;

    panelSingle.classList.remove("active");
    panelMatching.classList.remove("active");
    panelShort.classList.remove("active");
    if (type === "single") {
      panelSingle.classList.add("active");
      singleOptions.innerHTML = "";
      (q.options || []).forEach(function (opt) {
        addSingleOptionRow(opt.label || "", opt.text || "", opt.latex || "");
      });
      var ans = (q.answer && q.answer[0]) ? q.answer[0].label : "";
      fSingleCorrect.value = ans;
    } else if (type === "matching") {
      panelMatching.classList.add("active");
      var leftItems = getLeftItems(q);
      var rightItems = getRightItems(q);
      var pairs = getPairs(q);
      matchingLeft.innerHTML = "";
      Object.keys(leftItems).sort().forEach(function (k) {
        addMatchingLeftRow(k, leftItems[k]);
      });
      matchingRight.innerHTML = "";
      Object.keys(rightItems).sort().forEach(function (k) {
        addMatchingRightRow(k, rightItems[k]);
      });
      matchingPairs.innerHTML = "";
      pairs.forEach(function (p) {
        addMatchingPairRow(p.key, p.label);
      });
    } else {
      panelShort.classList.add("active");
      fShortAnswer.value = typeof q.answer === "string" ? q.answer : (q.answer != null ? String(q.answer) : "");
    }
  }

  function getLeftItems(q) {
    if (q.statements && typeof q.statements === "object" && !Array.isArray(q.statements)) return q.statements;
    if (q.expressions && Array.isArray(q.expressions)) {
      var o = {};
      q.expressions.forEach(function (e) { o[e.label] = e.text != null ? e.text : (e.latex || ""); });
      return o;
    }
    if (q.options && Array.isArray(q.options) && q.options[0] && q.options[0].matches) {
      var o = {};
      q.options.forEach(function (e) { o[e.label] = e.text != null ? e.text : (e.latex || ""); });
      return o;
    }
    if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) return q.options;
    return {};
  }

  function getRightItems(q) {
    if (q.endings) return q.endings;
    if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) return q.options;
    return {};
  }

  function getPairs(q) {
    var a = q.answer;
    if (!a) return [];
    if (Array.isArray(a)) {
      return a.map(function (p) {
        var key = p.statement || p.expression || p.segment || p.label;
        return key ? { key: key, label: p.label } : null;
      }).filter(Boolean);
    }
    if (typeof a === "object") return Object.keys(a).map(function (k) { return { key: String(k), label: String(a[k]) }; });
    return [];
  }

  function addSingleOptionRow(label, text, latex) {
    var row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = "<span class=\"opt-label\"><input type=\"text\" placeholder=\"А\" maxlength=\"1\" value=\"" + escapeHtml(label) + "\" class=\"opt-label-in\" /></span>" +
      "<input type=\"text\" placeholder=\"Текст\" class=\"opt-text-in\" value=\"" + escapeHtml(text) + "\" />" +
      "<input type=\"text\" placeholder=\"LaTeX\" class=\"opt-latex-in\" value=\"" + escapeHtml(latex) + "\" />" +
      "<button type=\"button\" class=\"btn-remove\">×</button>";
    row.querySelector(".btn-remove").addEventListener("click", function () { row.remove(); });
    trackFocus(row.querySelector(".opt-text-in"));
    trackFocus(row.querySelector(".opt-latex-in"));
    singleOptions.appendChild(row);
  }

  function addMatchingLeftRow(key, val) {
    var row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = "<input type=\"text\" placeholder=\"Ключ (1, 2, 3)\" class=\"ml-key\" value=\"" + escapeHtml(key) + "\" />" +
      "<input type=\"text\" placeholder=\"Текст\" class=\"ml-val\" value=\"" + escapeHtml(val) + "\" style=\"flex:2;\" />" +
      "<button type=\"button\" class=\"btn-remove\">×</button>";
    row.querySelector(".btn-remove").addEventListener("click", function () { row.remove(); });
    matchingLeft.appendChild(row);
  }

  function addMatchingRightRow(key, val) {
    var row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = "<input type=\"text\" placeholder=\"Літера (А–Д)\" class=\"mr-key\" value=\"" + escapeHtml(key) + "\" maxlength=\"2\" />" +
      "<input type=\"text\" placeholder=\"Текст\" class=\"mr-val\" value=\"" + escapeHtml(val) + "\" style=\"flex:2;\" />" +
      "<button type=\"button\" class=\"btn-remove\">×</button>";
    row.querySelector(".btn-remove").addEventListener("click", function () { row.remove(); });
    matchingRight.appendChild(row);
  }

  function addMatchingPairRow(key, label) {
    var row = document.createElement("div");
    row.className = "pair-row";
    row.innerHTML = "<input type=\"text\" placeholder=\"Ключ\" class=\"pair-key\" value=\"" + escapeHtml(key) + "\" />" +
      " → <input type=\"text\" placeholder=\"Літера\" class=\"pair-label\" value=\"" + escapeHtml(label) + "\" maxlength=\"2\" />" +
      "<button type=\"button\" class=\"btn-remove\">×</button>";
    row.querySelector(".btn-remove").addEventListener("click", function () { row.remove(); });
    matchingPairs.appendChild(row);
  }

  function collectForm() {
    var id = parseInt(fId.value, 10);
    if (isNaN(id) || id < 1) id = Math.max(1, (questions.length ? Math.max.apply(null, questions.map(function (q) { return q.id || 0; })) + 1 : 1));
    var type = fType.value;
    var existing = currentIndex >= 0 ? questions[currentIndex] : null;
    var q = {
      id: id,
      topic: (fTopic.value || "").trim(),
      question: (fQuestion.value || "").trim(),
      latex: (fLatex.value || "").trim() || undefined,
      image: (fImage.value || "").trim() || undefined,
      _local: existing && existing._local === true,
      _newSession: existing && existing._newSession === true,
    };
    if (type === "single") {
      var opts = [];
      singleOptions.querySelectorAll(".option-row").forEach(function (row) {
        var lbl = (row.querySelector(".opt-label-in").value || "").trim();
        var txt = (row.querySelector(".opt-text-in").value || "").trim();
        var ltx = (row.querySelector(".opt-latex-in").value || "").trim();
        if (lbl) opts.push({ label: lbl, text: txt, latex: ltx || undefined });
      });
      var correct = (fSingleCorrect.value || "").trim();
      var correctOpt = opts.find(function (o) { return o.label === correct; });
      q.options = opts;
      q.answer = correctOpt ? [{ label: correctOpt.label, text: correctOpt.text, latex: correctOpt.latex }] : (correct ? [{ label: correct, text: "", latex: undefined }] : []);
    } else if (type === "matching") {
      var left = {};
      matchingLeft.querySelectorAll(".kv-row").forEach(function (row) {
        var k = (row.querySelector(".ml-key").value || "").trim();
        var v = (row.querySelector(".ml-val").value || "").trim();
        if (k) left[k] = v;
      });
      var right = {};
      matchingRight.querySelectorAll(".kv-row").forEach(function (row) {
        var k = (row.querySelector(".mr-key").value || "").trim();
        var v = (row.querySelector(".mr-val").value || "").trim();
        if (k) right[k] = v;
      });
      var pairs = [];
      matchingPairs.querySelectorAll(".pair-row").forEach(function (row) {
        var k = (row.querySelector(".pair-key").value || "").trim();
        var l = (row.querySelector(".pair-label").value || "").trim();
        if (k && l) pairs.push({ key: k, label: l });
      });
      if (Object.keys(left).length && Object.keys(right).length) {
        var leftKeys = Object.keys(left).sort();
        var isNumLike = leftKeys.every(function (k) { return /^[0-9]+$/.test(k); });
        if (isNumLike && leftKeys.length <= 5) {
          q.statements = left;
          q.options = right;
          q.answer = pairs.map(function (p) { return { statement: p.key, label: p.label }; });
        } else {
          q.options = left;
          q.endings = right;
          var ansObj = {};
          pairs.forEach(function (p) { ansObj[p.key] = p.label; });
          q.answer = ansObj;
        }
      }
    } else {
      q.answer_format = "decimal";
      q.answer = (fShortAnswer.value || "").trim().replace(",", ".");
    }
    return q;
  }

  function showTypePanel() {
    var type = fType.value;
    panelSingle.classList.remove("active");
    panelMatching.classList.remove("active");
    panelShort.classList.remove("active");
    if (type === "single") panelSingle.classList.add("active");
    else if (type === "matching") panelMatching.classList.add("active");
    else panelShort.classList.add("active");
  }

  function wrapLatex(latex) {
    if (!latex) return "";
    return "\\( " + latex + " \\)";
  }
  function looksLikeLatex(str) {
    return typeof str === "string" && (str.indexOf("\\") !== -1 || str.indexOf("^{") !== -1 || str.indexOf("_{") !== -1);
  }

  function renderQuestionPreview(q) {
    var container = document.getElementById("preview-content");
    container.innerHTML = "";
    var card = document.createElement("div");
    card.className = "card question-card";

    var qText = document.createElement("div");
    qText.className = "question-content";
    var qt = document.createElement("div");
    qt.className = "question-text";
    qt.innerHTML = escapeHtml(q.question || "(Текст питання не введено)");
    qText.appendChild(qt);
    card.appendChild(qText);

    if (q.image && q.image.trim()) {
      var imgWrap = document.createElement("div");
      imgWrap.className = "question-image-container";
      var img = document.createElement("img");
      img.src = q.image.trim();
      img.alt = "Ілюстрація до завдання";
      imgWrap.appendChild(img);
      card.appendChild(imgWrap);
    }

    var body = document.createElement("div");
    body.className = "question-body";

    var type = classify(q);
    if (type === "single") {
      var ul = document.createElement("ul");
      ul.className = "options-list";
      var correctLabels = (q.answer || []).map(function (a) { return a.label; });
      (q.options || []).forEach(function (opt) {
        var li = document.createElement("li");
        li.className = "option-item";
        if (correctLabels.indexOf(opt.label) !== -1) li.classList.add("selected");
        var badge = document.createElement("div");
        badge.className = "option-label-badge";
        badge.textContent = opt.label;
        var content = document.createElement("div");
        content.className = "option-content";
        var disp = document.createElement("div");
        disp.className = "option-main-text";
        if (opt.latex) disp.innerHTML = wrapLatex(opt.latex); else disp.textContent = opt.text || "";
        content.appendChild(disp);
        li.appendChild(badge);
        li.appendChild(content);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else if (type === "matching") {
      var leftItems = getLeftItems(q);
      var rightOptions = getRightItems(q);
      var pairs = getPairs(q);
      var pairMap = {};
      pairs.forEach(function (p) { pairMap[p.key] = p.label; });
      var leftKeys = Object.keys(leftItems).sort();
      var table = document.createElement("table");
      table.className = "matching-table";
      var thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>Початок</th><th>Правильна відповідь</th></tr>";
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      leftKeys.forEach(function (key) {
        var row = document.createElement("tr");
        var leftTd = document.createElement("td");
        var labelSpan = document.createElement("span");
        labelSpan.className = "matching-label";
        labelSpan.textContent = key + ")";
        var contentSpan = document.createElement("span");
        var val = leftItems[key];
        var str = (val != null ? String(val) : "");
        if (looksLikeLatex(str)) contentSpan.innerHTML = " " + wrapLatex(str); else contentSpan.textContent = " " + str;
        leftTd.appendChild(labelSpan);
        leftTd.appendChild(contentSpan);
        row.appendChild(leftTd);
        var rightTd = document.createElement("td");
        rightTd.className = "correct-cell";
        var selectedKey = pairMap[key];
        if (selectedKey && rightOptions[selectedKey] != null) {
          var rStr = String(rightOptions[selectedKey]);
          if (rStr.indexOf("\\") !== -1) rightTd.innerHTML = selectedKey + ") " + wrapLatex(rStr); else rightTd.textContent = selectedKey + ") " + rStr;
        } else rightTd.textContent = "—";
        row.appendChild(rightTd);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    } else {
      var correctStr = typeof q.answer === "string" ? q.answer : (q.answer != null ? String(q.answer) : "—");
      var valDiv = document.createElement("div");
      valDiv.className = "correct-answer-value";
      valDiv.style.cssText = "padding:10px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;margin-top:8px;";
      if (looksLikeLatex(correctStr)) valDiv.innerHTML = wrapLatex(correctStr); else valDiv.textContent = correctStr;
      var labelDiv = document.createElement("div");
      labelDiv.className = "correct-answer-label";
      labelDiv.style.cssText = "font-size:0.9rem;font-weight:500;color:#0d9488;margin-top:12px;";
      labelDiv.textContent = "Правильна відповідь:";
      body.appendChild(labelDiv);
      body.appendChild(valDiv);
    }
    card.appendChild(body);
    container.appendChild(card);
  }

  function openPreview() {
    var q = collectForm();
    renderQuestionPreview(q);
    var overlay = document.getElementById("preview-overlay");
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([document.getElementById("preview-content")]).catch(function () {});
    }
  }

  function closePreview() {
    var overlay = document.getElementById("preview-overlay");
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function copyCurrentQuestion() {
    if (questionForm.classList.contains("hidden")) {
      saveStatus.textContent = "Спочатку оберіть або створіть завдання.";
      saveStatus.classList.add("error");
      setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("error"); }, 2500);
      return;
    }
    var q = collectForm();
    try {
      sessionStorage.setItem(COPY_STORAGE_KEY, JSON.stringify(q));
      saveStatus.textContent = "Завдання скопійовано. Натисніть «Вставити», щоб додати копію.";
      saveStatus.classList.remove("error");
      saveStatus.classList.add("ok");
      setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("ok"); }, 3000);
    } catch (e) {
      saveStatus.textContent = "Помилка копіювання";
      saveStatus.classList.add("error");
    }
  }

  function pasteAsNewQuestion() {
    var raw = sessionStorage.getItem(COPY_STORAGE_KEY);
    if (!raw) {
      saveStatus.textContent = "Немає скопійованого завдання. Спочатку натисніть «Копіювати».";
      saveStatus.classList.add("error");
      setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("error"); }, 2500);
      return;
    }
    var q;
    try {
      q = JSON.parse(raw);
    } catch (e) {
      saveStatus.textContent = "Помилка: некоректні дані.";
      saveStatus.classList.add("error");
      return;
    }
    var maxId = questions.length ? Math.max.apply(null, questions.map(function (x) { return x.id || 0; })) : 0;
    q.id = maxId + 1;
    q._local = true;
    q._newSession = true;
    questions.push(q);
    currentIndex = questions.length - 1;
    renderList();
    noSelection.classList.add("hidden");
    questionForm.classList.remove("hidden");
    fillForm(q);
    saveStatus.textContent = "Завдання вставлено як нове. Можете змінити й зберегти.";
    saveStatus.classList.remove("error");
    saveStatus.classList.add("ok");
    setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("ok"); }, 3500);
  }

  function questionsWithoutLocal(arr) {
    return arr.map(function (q) {
      var c = {};
      for (var k in q) if (k !== "_local") c[k] = q[k];
      return c;
    });
  }

  function persistQuestionsToServer() {
    var payload = questionsWithoutLocal(questions);
    var url = teacherIsAdmin ? "/api/admin/questions" : "/api/teacher/editor-draft";
    var body = teacherIsAdmin ? { questions: payload } : { questions: payload };
    return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  function saveCurrentQuestion() {
    if (currentIndex < 0) return;
    var q = collectForm();
    q._local = true;
    questions[currentIndex] = q;
    renderList();
    saveStatus.textContent = "Збереження на сервер…";
    saveStatus.classList.remove("error", "ok");
    persistQuestionsToServer()
      .then(function () {
        saveStatus.textContent = "Зміни збережено. Після оновлення сторінки вони залишаться.";
        saveStatus.classList.add("ok");
        saveStatus.classList.remove("error");
        setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("ok"); }, 4000);
      })
      .catch(function (e) {
        saveStatus.textContent = "Помилка збереження: " + (e.message || "");
        saveStatus.classList.add("error");
        saveStatus.classList.remove("ok");
      });
  }

  function deleteCurrentQuestion() {
    if (currentIndex < 0) return;
    if (!confirm("Видалити це завдання зі списку?")) return;
    questions.splice(currentIndex, 1);
    currentIndex = -1;
    questionForm.classList.add("hidden");
    noSelection.classList.remove("hidden");
    updateEditorView();
    persistQuestionsToServer().catch(function (e) {
      saveStatus.textContent = "Список оновлено, але збереження на сервер не вдалося: " + (e.message || "");
      saveStatus.classList.add("error");
    });
  }

  function saveAllToServer() {
    saveAllStatus.textContent = "Відправка…";
    saveAllStatus.classList.remove("error", "ok");
    api("/api/admin/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: questions }),
    })
      .then(function () {
        saveAllStatus.textContent = "Базу збережено на сервері.";
        saveAllStatus.classList.add("ok");
        setTimeout(function () { saveAllStatus.textContent = ""; }, 4000);
      })
      .catch(function (e) {
        saveAllStatus.textContent = e.message || "Помилка збереження";
        saveAllStatus.classList.add("error");
      });
  }

  function newQuestion() {
    var newId = questions.length ? Math.max.apply(null, questions.map(function (q) { return q.id || 0; })) + 1 : 1;
    var q = {
      id: newId,
      topic: "",
      question: "",
      options: [{ label: "А", text: "", latex: "" }, { label: "Б", text: "", latex: "" }],
      answer: [],
      _local: true,
      _newSession: true,
    };
    questions.push(q);
    currentIndex = questions.length - 1;
    noSelection.classList.add("hidden");
    questionForm.classList.remove("hidden");
    fillForm(q);
    updateEditorView();
  }

  function loadQuestions() {
    if (teacherIsAdmin) {
      return fetch("/api/questions", { credentials: "include" }).catch(function () { return fetch("./db.json"); })
        .then(function (r) { return r.ok ? r.text() : Promise.resolve("[]"); })
        .then(function (text) {
          var data;
          try {
            data = text.trim().indexOf("<") === 0 ? [] : JSON.parse(text);
          } catch (e) {
            data = [];
          }
          questions = Array.isArray(data) ? data : (data.questions || data.data || []);
          questions.forEach(function (q) { q._local = false; });
          currentIndex = -1;
          noSelection.classList.remove("hidden");
          questionForm.classList.add("hidden");
          updateEditorView();
          restoreEditorState();
        });
    }
    return api("/api/teacher/editor-draft")
      .then(function (data) {
        var list = data.questions && Array.isArray(data.questions) ? data.questions : [];
        if (list.length === 0) {
          return fetch("/api/questions", { credentials: "include" }).then(function (r) { return r.ok ? r.text() : "[]"; }).then(function (text) {
            try {
              var parsed = text.trim().indexOf("<") === 0 ? [] : JSON.parse(text);
              return Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || []);
            } catch (e) { return []; }
          });
        }
        return list;
      })
      .then(function (list) {
        questions = list;
        questions.forEach(function (q) { q._local = false; });
        currentIndex = -1;
        noSelection.classList.remove("hidden");
        questionForm.classList.add("hidden");
        updateEditorView();
        restoreEditorState();
      });
  }

  document.getElementById("f-type").addEventListener("change", showTypePanel);

  document.getElementById("single-add-opt").addEventListener("click", function () {
    var labels = "АБВГД";
    var used = [];
    singleOptions.querySelectorAll(".opt-label-in").forEach(function (inp) { used.push(inp.value.trim()); });
    var next = labels.split("").find(function (c) { return used.indexOf(c) === -1; }) || "Д";
    addSingleOptionRow(next, "", "");
  });

  document.getElementById("matching-add-left").addEventListener("click", function () {
    addMatchingLeftRow("", "");
  });
  document.getElementById("matching-add-right").addEventListener("click", function () {
    addMatchingRightRow("", "");
  });
  document.getElementById("matching-add-pair").addEventListener("click", function () {
    addMatchingPairRow("", "");
  });

  questionForm.addEventListener("submit", function (e) {
    e.preventDefault();
    saveCurrentQuestion();
  });

  if (questionSearch) questionSearch.addEventListener("input", function () { if (currentIndex >= 0) renderList(); else renderTable(); });
  if (questionSort) questionSort.addEventListener("change", function () { if (currentIndex >= 0) renderList(); else renderTable(); });

  document.getElementById("btn-back-to-table").addEventListener("click", goToTable);
  document.getElementById("btn-new-question-table").addEventListener("click", function () {
    newQuestion();
  });

  (function () {
    var sidebar = document.getElementById("editor-sidebar");
    var layout = sidebar && sidebar.closest(".editor-layout");
    var toggleBtn = document.getElementById("sidebar-toggle-btn");
    var iconEl = document.getElementById("sidebar-toggle-icon");
    var textEl = document.getElementById("sidebar-toggle-text");
    var svgChevronLeft = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 18l-6-6 6-6\"/></svg>";
    var svgChevronRight = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 18l6-6-6-6\"/></svg>";
    function updateToggleLabel() {
      var collapsed = sidebar && sidebar.classList.contains("collapsed");
      if (iconEl) iconEl.innerHTML = collapsed ? svgChevronRight : svgChevronLeft;
      if (textEl) textEl.textContent = "Список";
      if (toggleBtn) toggleBtn.title = collapsed ? "Розгорнути список завдань" : "Згорнути список завдань";
    }
    if (toggleBtn && sidebar && layout) {
      updateToggleLabel();
      toggleBtn.addEventListener("click", function () {
        sidebar.classList.toggle("collapsed");
        layout.classList.toggle("sidebar-collapsed");
        updateToggleLabel();
      });
    }
  })();

  document.getElementById("btn-copy-question").addEventListener("click", copyCurrentQuestion);
  document.getElementById("btn-paste-question").addEventListener("click", pasteAsNewQuestion);

  document.getElementById("btn-preview").addEventListener("click", openPreview);
  document.getElementById("preview-close").addEventListener("click", closePreview);
  document.getElementById("preview-overlay").addEventListener("click", function (e) {
    if (e.target === this) closePreview();
  });

  document.getElementById("question-form").addEventListener("submit", function (e) {
    e.preventDefault();
    saveCurrentQuestion();
  });
  document.getElementById("btn-delete-question").addEventListener("click", deleteCurrentQuestion);
  document.getElementById("btn-new-question").addEventListener("click", newQuestion);
  document.getElementById("btn-save-all").addEventListener("click", saveAllToServer);

  fImage.addEventListener("input", updateImagePreview);

  fImageFile.addEventListener("change", function () {
    if (!this.files || !this.files.length) return;
    var fd = new FormData();
    fd.append("image", this.files[0]);
    saveStatus.textContent = "Завантаження…";
    saveStatus.classList.remove("error", "ok");
    var uploadUrl = teacherIsAdmin ? "/api/admin/upload-image" : "/api/teacher/upload-image";
    fetch(uploadUrl, { method: "POST", credentials: "include", body: fd })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "Помилка"); });
        return r.json();
      })
      .then(function (data) {
        fImage.value = data.path || "";
        updateImagePreview();
        saveStatus.textContent = "Фото збережено: " + (data.path || "");
        saveStatus.classList.add("ok");
        setTimeout(function () { saveStatus.textContent = ""; saveStatus.classList.remove("ok"); }, 3000);
      })
      .catch(function (e) {
        saveStatus.textContent = e.message || "Помилка завантаження фото";
        saveStatus.classList.add("error");
      });
    this.value = "";
  });

  [fQuestion, fLatex, fTopic, fImage, fShortAnswer].forEach(trackFocus);

  initLatexHelper();

  function setEditorRole() {
    var cardSaveAll = document.getElementById("card-save-all");
    var cardSubmit = document.getElementById("card-submit-review");
    if (cardSaveAll) cardSaveAll.classList.toggle("hidden", !teacherIsAdmin);
    if (cardSubmit) cardSubmit.classList.toggle("hidden", !!teacherIsAdmin);
  }

  function submitForReview() {
    var statusEl = document.getElementById("submit-status");
    var localOnly = questions.filter(function (q) { return q._local === true; });
    if (!localOnly.length) {
      statusEl.textContent = "Немає завдань для надсилання. Створіть нове (+ Створити завдання), вставте скопійоване або відредагуйте й збережіть будь-яке завдання.";
      statusEl.classList.add("error");
      statusEl.classList.remove("ok");
      return;
    }
    var toSend = localOnly.map(function (q) {
      var c = {};
      for (var k in q) if (k !== "_local") c[k] = q[k];
      return c;
    });
    statusEl.textContent = "Відправка " + toSend.length + " завдань…";
    statusEl.classList.remove("error", "ok");
    api("/api/teacher/submit-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: toSend }),
    })
      .then(function () {
        statusEl.textContent = "Надіслано " + toSend.length + " завдань на перевірку адміністратору.";
        statusEl.classList.add("ok");
        statusEl.classList.remove("error");
        setTimeout(function () { statusEl.textContent = ""; statusEl.classList.remove("ok"); }, 5000);
      })
      .catch(function (e) {
        statusEl.textContent = e.message || "Помилка відправки";
        statusEl.classList.add("error");
        statusEl.classList.remove("ok");
      });
  }

  document.getElementById("btn-submit-review").addEventListener("click", submitForReview);

  api("/api/teachers/me")
    .then(function (data) {
      teacherIsAdmin = !!(data.teacher && data.teacher.isAdmin);
      authRequired.classList.add("hidden");
      editorRoot.classList.remove("hidden");
      setEditorRole();
      return loadQuestions();
    })
    .catch(function () {
      authRequired.classList.remove("hidden");
      editorRoot.classList.add("hidden");
    });
})();
