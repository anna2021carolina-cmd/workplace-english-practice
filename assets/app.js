(() => {
  "use strict";

  const STORAGE_KEY = "workplace-english-practice:progress:v1";
  const MAX_ATTEMPTS = 500;
  const SESSION_SIZE = 3;

  const screens = [...document.querySelectorAll(".screen")];
  const homeButton = document.querySelector("#home-button");
  const menuButton = document.querySelector("#menu-button");
  const utilityMenu = document.querySelector("#utility-menu");
  const practiceContent = document.querySelector("#practice-content");
  const progressLabel = document.querySelector("#progress-label");
  const progressBar = document.querySelector("#progress-bar");
  const confirmDialog = document.querySelector("#confirm-dialog");
  let storageAvailable = true;

  const state = {
    bank: null,
    progress: loadProgress(),
    session: [],
    mode: null,
    itemIndex: 0,
    stepIndex: 0,
    stepState: {},
    round: { correct: 0, acceptable: 0, mistakes: 0, completed: 0 },
  };

  init();

  async function init() {
    bindGlobalEvents();

    try {
      const response = await fetch("./data/question-bank.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`題庫回應狀態：${response.status}`);
      const bank = await response.json();
      validateBank(bank);
      state.bank = bank;
      state.progress.bankId = bank.bank.id;
      saveProgress();
      updateHomeProgress();
      updateStorageNotice();
      showScreen("home-screen");
    } catch (error) {
      showFatalError(error instanceof Error ? error.message : "題庫載入失敗。");
    }
  }

  function bindGlobalEvents() {
    homeButton.addEventListener("click", goHome);
    document.querySelector("#exit-practice").addEventListener("click", goHome);

    menuButton.addEventListener("click", () => {
      const willOpen = utilityMenu.hidden;
      utilityMenu.hidden = !willOpen;
      menuButton.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".site-header")) closeMenu();
      const target = event.target.closest("button");
      if (!target) return;

      const mode = target.dataset.startMode;
      if (mode) startSession(mode);

      const action = target.dataset.action;
      if (!action) return;

      closeMenu();

      if (action === "home") goHome();
      if (action === "show-mistakes") showMistakes();
      if (action === "show-phrases") showPhrases();
      if (action === "export") exportProgress();
      if (action === "reset") confirmDialog.showModal();
      if (action === "practice-item") startSession(target.dataset.mode, [target.dataset.itemId]);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !utilityMenu.hidden) closeMenu();
    });

    document.querySelector("#confirm-reset").addEventListener("click", () => {
      state.progress = emptyProgress();
      if (state.bank) state.progress.bankId = state.bank.bank.id;
      saveProgress();
      updateHomeProgress();
      goHome();
    });
  }

  function validateBank(bank) {
    if (!bank || bank.schemaVersion !== 1) {
      throw new Error("題庫版本不相容；第一版需要 schemaVersion 1。");
    }
    if (!bank.bank?.id || !Array.isArray(bank.items) || bank.items.length === 0) {
      throw new Error("題庫缺少 bank.id 或 items。");
    }

    const ids = new Set();
    for (const item of bank.items) {
      const required = ["id", "mode", "category", "title", "scenarioZh", "steps", "production"];
      const missing = required.filter((key) => item[key] === undefined || item[key] === null);
      if (missing.length) throw new Error(`題目 ${item.id || "(無 ID)"} 缺少：${missing.join("、")}`);
      if (ids.has(item.id)) throw new Error(`題目 ID 重複：${item.id}`);
      if (!["email", "phone"].includes(item.mode)) throw new Error(`題目 ${item.id} 的 mode 無效。`);
      if (!Array.isArray(item.steps) || !item.steps.length) throw new Error(`題目 ${item.id} 沒有引導步驟。`);
      if (!item.production.target || !Array.isArray(item.production.accepted)) {
        throw new Error(`題目 ${item.id} 缺少短句重建答案。`);
      }
      ids.add(item.id);
    }
  }

  function startSession(mode, itemIds = null) {
    if (!state.bank) return;
    const modeItems = state.bank.items.filter((item) => item.mode === mode);
    let selected;

    if (itemIds?.length) {
      selected = itemIds.map((id) => modeItems.find((item) => item.id === id)).filter(Boolean);
    } else {
      selected = [...modeItems]
        .sort((a, b) => priorityScore(b.id) - priorityScore(a.id) || Math.random() - 0.5)
        .slice(0, SESSION_SIZE);
    }

    if (!selected.length) return;
    state.session = selected;
    state.mode = mode;
    state.itemIndex = 0;
    state.stepIndex = 0;
    state.stepState = {};
    state.round = { correct: 0, acceptable: 0, mistakes: 0, completed: 0 };
    showScreen("practice-screen");
    renderPractice();
  }

  function priorityScore(itemId) {
    const mistakeCount = state.progress.mistakes[itemId]?.count || 0;
    const completedCount = state.progress.completed[itemId]?.count || 0;
    return mistakeCount * 10 + (completedCount === 0 ? 6 : 0) - completedCount;
  }

  function renderPractice() {
    const item = currentItem();
    if (!item) return finishRound();

    const totalStages = item.steps.length + 1;
    const overallProgress = ((state.itemIndex + state.stepIndex / totalStages) / state.session.length) * 100;
    progressLabel.textContent = `情境 ${state.itemIndex + 1} / ${state.session.length}`;
    progressBar.style.width = `${Math.max(5, overallProgress)}%`;

    const scenario = `
      <article class="scenario-card">
        <p class="eyebrow">${escapeHtml(item.mode === "email" ? "BUSINESS EMAIL" : "WORK PHONE")}</p>
        <h1>${escapeHtml(item.title)}</h1>
        <p class="scenario-text">${escapeHtml(item.scenarioZh)}</p>
        ${item.facts?.length ? `<ul class="facts-list">${item.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : ""}
      </article>`;

    practiceContent.innerHTML = scenario + `<section class="question-panel" id="question-panel"></section>`;

    if (state.stepIndex < item.steps.length) {
      renderGuidedStep(item, item.steps[state.stepIndex]);
    } else {
      renderProduction(item);
    }

    document.querySelector("#question-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderGuidedStep(item, step) {
    const panel = document.querySelector("#question-panel");
    const number = state.stepIndex + 1;
    panel.innerHTML = `
      <p class="step-label">GUIDED STEP ${number} / ${item.steps.length}</p>
      <h2>${escapeHtml(step.promptZh)}</h2>
      <div id="step-workspace"></div>
      <div id="step-feedback" aria-live="polite"></div>
      <div class="action-row" id="step-actions"></div>`;

    if (step.type === "choice") renderChoiceStep(item, step);
    else if (step.type === "order") renderOrderStep(item, step);
    else if (step.type === "fill") renderFillStep(item, step);
    else showFatalError(`不支援的題型：${step.type}`);
  }

  function renderChoiceStep(item, step) {
    const workspace = document.querySelector("#step-workspace");
    workspace.innerHTML = `<div class="options-list">${step.options
      .map(
        (option, index) =>
          `<button class="option-button" type="button" data-option-index="${index}">${escapeHtml(option.text)}</button>`,
      )
      .join("")}</div>`;

    workspace.querySelectorAll("[data-option-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const option = step.options[Number(button.dataset.optionIndex)];
        workspace.querySelectorAll("button").forEach((node) => (node.disabled = true));
        const isAcceptable = option.quality === "acceptable";
        button.classList.add(option.correct ? "correct" : isAcceptable ? "acceptable" : "incorrect");

        if (option.correct) {
          state.round.correct += 1;
          recordAttempt(item, "choice", "correct", option.text, null);
          showFeedback("success", "選得很好", option.feedback || step.explanation || "這個句子最符合情境。", true);
        } else if (isAcceptable) {
          state.round.acceptable += 1;
          recordAttempt(item, "choice", "acceptable", option.text, option.errorType || "suboptimal");
          showFeedback(
            "acceptable",
            "可以使用，但不是最佳答案",
            option.feedback || "這句英文可以使用，但有更貼合目前情境的說法。",
            true,
          );
        } else {
          state.round.mistakes += 1;
          recordMistake(item, option.errorType || "usage", option.feedback, option.text, "choice");
          showFeedback("error", errorLabel(option.errorType), option.feedback || "這個選項不適合目前情境。", true);
        }
      });
    });
  }

  function renderOrderStep(item, step) {
    const workspace = document.querySelector("#step-workspace");
    const shuffled = shuffle(step.tokens.map((text, index) => ({ text, index })));
    state.stepState = { remaining: shuffled, selected: [] };

    const draw = () => {
      workspace.innerHTML = `
        <p class="sr-only" id="order-help">依序點選下方片語組成句子；點選已選片語可以放回。</p>
        <div class="answer-tokens" aria-label="目前句子" aria-describedby="order-help">
          ${state.stepState.selected
            .map((token, index) => `<button class="token-button" type="button" data-remove-token="${index}">${escapeHtml(token.text)}</button>`)
            .join("")}
        </div>
        <div class="token-bank" aria-label="可用片語">
          ${state.stepState.remaining
            .map((token, index) => `<button class="token-button" type="button" data-add-token="${index}">${escapeHtml(token.text)}</button>`)
            .join("")}
        </div>`;

      workspace.querySelectorAll("[data-add-token]").forEach((button) => {
        button.addEventListener("click", () => {
          const [token] = state.stepState.remaining.splice(Number(button.dataset.addToken), 1);
          state.stepState.selected.push(token);
          draw();
        });
      });
      workspace.querySelectorAll("[data-remove-token]").forEach((button) => {
        button.addEventListener("click", () => {
          const [token] = state.stepState.selected.splice(Number(button.dataset.removeToken), 1);
          state.stepState.remaining.push(token);
          draw();
        });
      });
    };

    draw();
    document.querySelector("#step-actions").innerHTML = `<button class="primary-button" id="check-order" type="button">檢查順序</button>`;
    document.querySelector("#check-order").addEventListener("click", () => {
      if (state.stepState.remaining.length) {
        showFeedback("error", "尚未完成", "請先使用所有片語。", false);
        return;
      }
      const response = state.stepState.selected.map((token) => token.text);
      const correct = response.every((text, index) => normalize(text) === normalize(step.tokens[index]));
      if (correct) {
        state.round.correct += 1;
        recordAttempt(item, "order", "correct", response.join(" "), null);
        showFeedback("success", "順序正確", step.explanation, true);
      } else {
        state.round.mistakes += 1;
        recordMistake(item, "word-order", step.incorrectFeedback, response.join(" "), "order");
        showFeedback("error", "中文式語序／句構", `${step.incorrectFeedback} 正確順序：${step.tokens.join(" ")}`, true);
      }
    });
  }

  function renderFillStep(item, step) {
    const workspace = document.querySelector("#step-workspace");
    workspace.innerHTML = `
      <p class="sentence-frame">${escapeHtml(step.before)} <strong>_____</strong> ${escapeHtml(step.after)}</p>
      <label class="input-label">填入單字或片語
        <input class="text-input" id="fill-answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="true" />
      </label>`;
    document.querySelector("#step-actions").innerHTML = `<button class="primary-button" id="check-fill" type="button">檢查答案</button>`;
    const input = document.querySelector("#fill-answer");
    const submit = () => {
      const response = input.value.trim();
      if (!response) {
        showFeedback("error", "還沒有答案", "請先填入一個單字或片語。", false);
        return;
      }
      const correct = step.answers.some((answer) => normalize(answer) === normalize(response));
      if (correct) {
        state.round.correct += 1;
        recordAttempt(item, "fill", "correct", response, null);
        showFeedback("success", "填寫正確", step.explanation, true);
      } else {
        state.round.mistakes += 1;
        const nearSpelling = step.answers.some((answer) => levenshtein(normalize(answer), normalize(response)) <= 2);
        const tag = nearSpelling ? "spelling" : step.errorType || "usage";
        recordMistake(item, tag, step.incorrectFeedback, response, "fill");
        showFeedback("error", errorLabel(tag), `${step.incorrectFeedback} 參考答案：${step.answers[0]}`, true);
      }
    };
    document.querySelector("#check-fill").addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    input.focus();
  }

  function renderProduction(item) {
    const panel = document.querySelector("#question-panel");
    panel.innerHTML = `
      <p class="step-label">SHORT RECALL</p>
      <h2>${escapeHtml(item.production.promptZh)}</h2>
      <p class="scenario-text">答案已隱藏。請不用追求完整 Email，只重建這個情境最重要的一句話。</p>
      <label class="input-label">你的英文短句
        <textarea class="production-input" id="production-answer" spellcheck="true" autocomplete="off"></textarea>
      </label>
      <div id="step-feedback" aria-live="polite"></div>
      <div class="action-row" id="step-actions">
        <button class="primary-button" id="check-production" type="button">查看結果</button>
      </div>`;

    const input = document.querySelector("#production-answer");
    document.querySelector("#check-production").addEventListener("click", () => checkProduction(item, input.value));
    input.focus();
  }

  function checkProduction(item, rawResponse) {
    const response = rawResponse.trim();
    if (!response) {
      showFeedback("error", "還沒有短句", "請先嘗試寫一句；不確定也沒關係。", false);
      return;
    }

    const accepted = item.production.accepted.some((answer) => normalize(answer) === normalize(response));
    const knownMistake = item.production.commonMistakes?.find(
      (mistake) => normalize(mistake.example) === normalize(response),
    );
    let outcome = "needs-review";
    let tag = "needs-review";
    let title = "待檢視";
    let message = "這個版本與預設答案不同。第一版不會假裝能判斷任意英文，已保留供你匯出給 AI 分析。";

    if (accepted) {
      outcome = "correct";
      tag = null;
      title = "句子可直接使用";
      message = item.production.explanation;
      state.round.correct += 1;
      recordAttempt(item, "production", outcome, response, tag, false);
    } else if (knownMistake) {
      tag = knownMistake.errorType;
      title = errorLabel(tag);
      message = knownMistake.feedback;
      state.round.mistakes += 1;
      recordMistake(item, tag, message, response, "production", false);
    } else {
      state.round.mistakes += 1;
      recordMistake(item, tag, message, response, "production", false, "needs-review");
    }

    saveProgress();

    const isFavorite = Boolean(state.progress.favorites[item.id]);
    const phonePrompt = item.mode === "phone"
      ? `<div class="feedback-box"><h3>現在開口說一次</h3><p>先看一遍參考句，接著移開視線，把它說出來。完成後選擇最接近的狀況。</p></div>
         <div class="self-rating" aria-label="口說自我評估">
           <button class="secondary-button" type="button" data-rating="smooth">順利說出</button>
           <button class="secondary-button" type="button" data-rating="paused">有停頓</button>
           <button class="secondary-button" type="button" data-rating="needed-answer">需要看答案</button>
         </div>`
      : "";

    document.querySelector("#step-feedback").innerHTML = `
      <div class="feedback-box ${accepted ? "success" : "error"}">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="reference-answer">
        <span class="step-label">REFERENCE</span>
        <blockquote>${escapeHtml(item.production.target)}</blockquote>
        ${accepted ? "" : `<p class="diff-line">你的版本：${renderDiff(response, item.production.target)}</p>`}
        <button class="favorite-button ${isFavorite ? "active" : ""}" id="favorite-phrase" type="button" aria-pressed="${isFavorite}">
          <span aria-hidden="true">${isFavorite ? "★" : "☆"}</span>${isFavorite ? "已收藏句型" : "收藏這個句型"}
        </button>
      </div>
      ${phonePrompt}`;

    document.querySelector("#step-actions").innerHTML = item.mode === "phone"
      ? ""
      : `<button class="primary-button" id="next-item" type="button">${nextItemLabel()}</button>`;

    document.querySelector("#favorite-phrase").addEventListener("click", (event) => {
      toggleFavorite(item.id);
      const button = event.currentTarget;
      const active = Boolean(state.progress.favorites[item.id]);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.innerHTML = `<span aria-hidden="true">${active ? "★" : "☆"}</span>${active ? "已收藏句型" : "收藏這個句型"}`;
    });

    if (item.mode === "phone") {
      document.querySelectorAll("[data-rating]").forEach((button) => {
        button.addEventListener("click", () => {
          recordAttempt(item, "speaking-self-check", button.dataset.rating, "", null);
          completeCurrentItem();
        });
      });
    } else {
      document.querySelector("#next-item").addEventListener("click", completeCurrentItem);
    }
  }

  function showFeedback(kind, title, message, showNext) {
    const feedback = document.querySelector("#step-feedback");
    if (!feedback) return;
    feedback.innerHTML = `<div class="feedback-box ${kind}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message || "")}</p></div>`;
    if (showNext) {
      document.querySelector("#step-actions").innerHTML = `<button class="primary-button" id="next-step" type="button">下一步</button>`;
      document.querySelector("#next-step").addEventListener("click", () => {
        state.stepIndex += 1;
        state.stepState = {};
        renderPractice();
      });
    }
  }

  function completeCurrentItem() {
    const item = currentItem();
    if (!item) return;
    const existing = state.progress.completed[item.id] || { count: 0 };
    state.progress.completed[item.id] = { count: existing.count + 1, lastAt: new Date().toISOString() };
    state.round.completed += 1;
    saveProgress();
    state.itemIndex += 1;
    state.stepIndex = 0;
    state.stepState = {};
    if (state.itemIndex >= state.session.length) finishRound();
    else renderPractice();
  }

  function finishRound() {
    progressBar.style.width = "100%";
    const modeName = state.mode === "email" ? "Email" : "電話";
    document.querySelector("#summary-stats").innerHTML = `
      <div class="summary-stat"><strong>${state.round.completed}</strong><span>完成情境</span></div>
      <div class="summary-stat"><strong>${state.round.correct}</strong><span>順利作答</span></div>
      <div class="summary-stat"><strong>${state.round.mistakes}</strong><span>值得再練</span></div>`;
    const acceptableNote = state.round.acceptable > 0
      ? `另有 ${state.round.acceptable} 題是可以使用但不是最佳答案，已提供改進提醒，不會列入錯題。`
      : "";
    document.querySelector("#summary-note").textContent = state.round.mistakes > 0
      ? `錯誤已留在本機錯題紀錄。重練不是倒退，而是把句子練成能在工作中直接叫出來。${acceptableNote}`
      : acceptableNote || "這一輪很穩定。可以換另一種模式，也可以再做一輪累積熟悉度。";
    const continueButton = document.querySelector("#continue-mode");
    continueButton.textContent = `再練一輪 ${modeName}`;
    continueButton.onclick = () => startSession(state.mode);
    updateHomeProgress();
    showScreen("summary-screen");
  }

  function showMistakes() {
    if (!state.bank) return;
    const items = state.bank.items
      .filter((item) => state.progress.mistakes[item.id]?.count > 0)
      .sort((a, b) => state.progress.mistakes[b.id].count - state.progress.mistakes[a.id].count);
    showLibrary(
      "MISTAKE REVIEW",
      "錯題重練",
      "先處理反覆出現的錯誤；每次仍會從引導步驟開始。",
      items,
      "目前沒有錯題。完成一輪練習後，答錯的情境會出現在這裡。",
      "mistakes",
    );
  }

  function showPhrases() {
    if (!state.bank) return;
    const items = state.bank.items.filter((item) => state.progress.favorites[item.id]);
    showLibrary(
      "SAVED PHRASES",
      "收藏句型",
      "這些句子已保存在目前瀏覽器，可隨時回來複習。",
      items,
      "還沒有收藏句型。查看參考答案時，可以按下星號收藏。",
      "phrases",
    );
  }

  function showLibrary(eyebrow, title, description, items, emptyText, kind) {
    document.querySelector("#library-eyebrow").textContent = eyebrow;
    document.querySelector("#library-title").textContent = title;
    document.querySelector("#library-description").textContent = description;
    const list = document.querySelector("#library-list");

    if (!items.length) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    } else {
      list.innerHTML = items
        .map((item) => {
          const mistakes = state.progress.mistakes[item.id]?.count || 0;
          const detail = kind === "phrases" ? item.production.target : `${mistakes} 次錯誤紀錄`;
          return `<article class="library-item">
            <div class="library-item-head">
              <div>
                <span class="pill">${escapeHtml(item.mode === "email" ? "Email" : "電話")}</span>
                <h2>${escapeHtml(item.title)}</h2>
                <p>${escapeHtml(detail)}</p>
              </div>
              <button class="secondary-button" type="button" data-action="practice-item" data-mode="${item.mode}" data-item-id="${escapeHtml(item.id)}">練習</button>
            </div>
          </article>`;
        })
        .join("");
    }
    showScreen("library-screen");
  }

  function recordMistake(item, tag, feedback, response, stage, save = true, outcome = "incorrect") {
    const current = state.progress.mistakes[item.id] || { count: 0, tags: {} };
    current.count += 1;
    current.tags[tag] = (current.tags[tag] || 0) + 1;
    current.lastAt = new Date().toISOString();
    current.lastFeedback = feedback || "";
    state.progress.mistakes[item.id] = current;
    recordAttempt(item, stage, outcome, response, tag, save);
  }

  function recordAttempt(item, stage, outcome, response, errorType, save = true) {
    state.progress.attempts.push({
      at: new Date().toISOString(),
      itemId: item.id,
      mode: item.mode,
      category: item.category,
      stage,
      outcome,
      response,
      referenceAnswer: item.production.target,
      errorType,
    });
    if (state.progress.attempts.length > MAX_ATTEMPTS) {
      state.progress.attempts = state.progress.attempts.slice(-MAX_ATTEMPTS);
    }
    if (save) saveProgress();
  }

  function toggleFavorite(itemId) {
    if (state.progress.favorites[itemId]) delete state.progress.favorites[itemId];
    else state.progress.favorites[itemId] = { savedAt: new Date().toISOString() };
    saveProgress();
  }

  function exportProgress() {
    if (!state.bank) return;
    const errorTotals = {};
    Object.values(state.progress.mistakes).forEach((mistake) => {
      Object.entries(mistake.tags || {}).forEach(([tag, count]) => {
        errorTotals[tag] = (errorTotals[tag] || 0) + count;
      });
    });

    const exportData = {
      exportSchemaVersion: 1,
      generatedAt: new Date().toISOString(),
      purpose: "AI reference for personal workplace English practice",
      privacyNotice: "This file was created locally and was not uploaded automatically.",
      questionBank: { id: state.bank.bank.id, version: state.bank.bank.version },
      summary: {
        completedScenarios: Object.keys(state.progress.completed).length,
        savedPhrases: Object.keys(state.progress.favorites).length,
        errorTotals,
      },
      frequentMistakes: Object.entries(state.progress.mistakes)
        .map(([itemId, value]) => ({ itemId, ...value }))
        .sort((a, b) => b.count - a.count),
      savedPhrases: state.bank.items
        .filter((item) => state.progress.favorites[item.id])
        .map((item) => ({ itemId: item.id, mode: item.mode, category: item.category, phrase: item.production.target })),
      attempts: state.progress.attempts,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workplace-english-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    closeMenu();
  }

  function updateHomeProgress() {
    if (!state.bank) return;
    for (const mode of ["email", "phone"]) {
      const all = state.bank.items.filter((item) => item.mode === mode).length;
      const done = state.bank.items.filter((item) => item.mode === mode && state.progress.completed[item.id]).length;
      document.querySelector(`#${mode}-progress`).textContent = done ? `已完成 ${done} / ${all}` : "尚未開始";
    }
  }

  function currentItem() {
    return state.session[state.itemIndex];
  }

  function nextItemLabel() {
    return state.itemIndex + 1 >= state.session.length ? "完成本輪" : "下一個情境";
  }

  function goHome() {
    updateHomeProgress();
    closeMenu();
    showScreen("home-screen");
  }

  function showScreen(id) {
    screens.forEach((screen) => (screen.hidden = screen.id !== id));
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector(`#${id}`)?.focus?.({ preventScroll: true });
  }

  function showFatalError(message) {
    document.querySelector("#error-message").textContent = message;
    showScreen("error-screen");
  }

  function closeMenu() {
    utilityMenu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed?.schemaVersion === 1) return parsed;
    } catch (_error) {
      storageAvailable = false;
    }
    return emptyProgress();
  }

  function emptyProgress() {
    return { schemaVersion: 1, bankId: null, completed: {}, mistakes: {}, favorites: {}, attempts: [] };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
      storageAvailable = true;
    } catch (_error) {
      storageAvailable = false;
      updateStorageNotice();
    }
  }

  function updateStorageNotice() {
    const note = document.querySelector("#storage-note p");
    if (!note) return;
    note.innerHTML = storageAvailable
      ? "<strong>本機優先：</strong>不需登入、不連接 AI，也不會自動上傳你的答案。"
      : "<strong>目前無法保存：</strong>瀏覽器封鎖了本機儲存；本次練習仍可繼續，但關閉頁面後紀錄可能消失。";
  }

  function normalize(value) {
    return String(value)
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9'\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    if (result.length > 1 && result.every((value, index) => value.index === index)) {
      [result[0], result[1]] = [result[1], result[0]];
    }
    return result;
  }

  function renderDiff(response, target) {
    const responseWords = response.split(/\s+/);
    const targetWords = target.split(/\s+/);
    return responseWords
      .map((word, index) => {
        const same = normalize(word) === normalize(targetWords[index] || "");
        return same ? escapeHtml(word) : `<span class="diff-missing">${escapeHtml(word)}</span>`;
      })
      .join(" ");
  }

  function errorLabel(type) {
    const labels = {
      spelling: "拼字錯誤",
      grammar: "文法錯誤",
      "word-order": "中文式語序／句構",
      unnatural: "不自然但不一定錯",
      tone: "商務語氣問題",
      usage: "用字問題",
      suboptimal: "可以使用，但不是最佳答案",
      "needs-review": "待檢視",
    };
    return labels[type] || "需要再確認";
  }

  function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, (_, row) => [row]);
    for (let column = 0; column <= a.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= b.length; row += 1) {
      for (let column = 1; column <= a.length; column += 1) {
        matrix[row][column] = b[row - 1] === a[column - 1]
          ? matrix[row - 1][column - 1]
          : Math.min(matrix[row - 1][column - 1] + 1, matrix[row][column - 1] + 1, matrix[row - 1][column] + 1);
      }
    }
    return matrix[b.length][a.length];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
