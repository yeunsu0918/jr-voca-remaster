// app.js — screen router and UI controller. Ties store + quiz + tts together.
import * as store from "./store.js";
import { speak, ttsSupported } from "./tts.js";
import { MODES, buildQuiz, checkSpelling, shortKo } from "./quiz.js";

// ---- tiny DOM helper -------------------------------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const root = () => document.getElementById("app");

// ---- toast -----------------------------------------------------------------
let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = h("div", { class: "toast" });
    document.body.append(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

// ---- theme + font ----------------------------------------------------------
function applyChrome() {
  const s = store.settings();
  document.documentElement.dataset.theme = s.theme === "auto" ? "" : s.theme;
  if (s.theme === "auto") document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.setProperty("--font-scale", s.fontScale);
}

// ---- router ----------------------------------------------------------------
let route = { name: "home", params: {} };
const session = {}; // transient quiz/study state
function go(name, params = {}) {
  route = { name, params };
  render();
  window.scrollTo(0, 0);
}

const SCREENS = {};
function render() {
  applyChrome();
  const el = SCREENS[route.name] ? SCREENS[route.name](route.params) : SCREENS.home();
  root().replaceChildren(el);
}

// ---- shared bits -----------------------------------------------------------
function topbar(title, { back = null, actions = [] } = {}) {
  return h(
    "header",
    { class: "topbar" },
    back ? h("button", { class: "iconbtn back", onclick: back, "aria-label": "뒤로" }, "‹") : profileChip(),
    h("h1", {}, title),
    h("div", { class: "spacer" }),
    ...actions
  );
}
function profileChip() {
  const p = store.activeProfile();
  return h(
    "button",
    { class: "profile-chip", onclick: () => go("profiles") },
    h("span", { class: "avatar", style: { background: p.color } }, p.name.slice(0, 1)),
    p.name
  );
}
const screen = (...kids) => h("div", { class: "app" }, ...kids);

// ---- HOME (= DAY hub) ------------------------------------------------------
SCREENS.home = () => {
  const st = store.streak();
  const stats = store.overallStats();
  const due = store.dueCount();

  // quick actions: review / starred / random — kept small above the DAY grid
  const quick = h("div", { class: "quickbar" },
    h("button", { class: "qbtn accent", onclick: () => (due ? startReview() : toast("복습할 단어가 아직 없어요")) },
      "🎯 오답·복습", due ? h("span", { class: "pill" }, due) : null),
    h("button", { class: "qbtn", onclick: () => (store.starredWords().length ? startStudy(store.starredWords(), "⭐ 별표 단어") : toast("별표한 단어가 없어요")) }, "⭐ 별표"),
    h("button", { class: "qbtn", onclick: () => { const d = 1 + Math.floor(Math.random() * store.DAYS.length); startStudy(store.wordsForDay(d), `🎲 DAY ${d}`); } }, "🎲 랜덤")
  );

  const grid = h("div", { class: "day-grid" });
  for (const day of store.DAYS) {
    const pct = Math.round(store.dayMastery(day).ratio * 100);
    grid.append(
      h("button", { class: "day-cell" + (pct === 100 ? " done" : ""), onclick: () => go("dayHub", { day }) },
        h("span", { class: "ring", style: { "--p": pct } }),
        h("span", { class: "lbl" }, "DAY"),
        h("span", { class: "num" }, day))
    );
  }

  return screen(
    topbar(store.META.title, {
      actions: [h("button", { class: "iconbtn", onclick: () => go("settings"), "aria-label": "설정" }, "⚙️")],
    }),
    h("main", { class: "screen" },
      h("div", { class: "hero compact" },
        h("div", { class: "big" }, st.count > 0 ? `🔥 ${st.count}일 연속` : "오늘도 화이팅!"),
        h("div", { class: "sub" }, `마스터 ${stats.mastered} / ${stats.total} · 학습 ${stats.seen}단어`)),
      quick,
      h("div", { class: "section-title" }, "DAY 선택 — 눌러서 학습/시험"),
      grid)
  );
};

// ---- DAY HUB (pick study or quiz for one day) ------------------------------
function wordListPreview(words) {
  const wrap = h("div", { class: "word-preview" });
  words.forEach((w) =>
    wrap.append(
      h("button", { class: "wp-item", onclick: () => speak(w.en, store.settings().ttsRate) },
        h("span", { class: "en" }, w.en), h("span", { class: "ko" }, shortKo(w.ko)))
    )
  );
  return wrap;
}
SCREENS.dayHub = ({ day }) => {
  const m = store.dayMastery(day);
  const pct = Math.round(m.ratio * 100);
  const words = store.wordsForDay(day);
  return screen(
    topbar(`DAY ${day}`, { back: () => go("home") }),
    h("main", { class: "screen stack" },
      h("div", { class: "card center stack" },
        h("div", { class: "day-hub-num" }, `DAY ${day}`),
        h("div", { class: "muted" }, `20단어 · 마스터 ${m.learned}/${m.total}`),
        h("div", { class: "progress-line" }, h("span", { style: { width: `${pct}%` } }))),
      h("button", { class: "btn primary block", onclick: () => startStudy(words, `DAY ${day}`) }, "📖 단어 학습 (플래시카드)"),
      h("button", { class: "btn block", onclick: () => go("quizSetup", { day }) }, "✏️ 시험 풀기 (퀴즈)"),
      day > 1 && h("button", { class: "btn block", onclick: () => go("quizSetup", { day, cumulative: true }) }, `📚 누적 시험 (DAY 1~${day})`),
      h("div", { class: "card" },
        h("div", { class: "section-title", style: { margin: "0 0 8px" } }, "이 DAY 단어 (눌러서 발음)"),
        wordListPreview(words))
    )
  );
};

// ---- FLASHCARD STUDY -------------------------------------------------------
function startStudy(words, title) {
  session.study = { words: words.slice(), i: 0, title, flipped: false };
  go("study");
}
SCREENS.study = () => {
  const s = session.study;
  if (!s || !s.words.length) return SCREENS.home();
  const w = s.words[s.i];
  const box = store.boxOf(w.id);
  const flash = h("div", { class: "flash" + (s.flipped ? " flipped" : "") });
  const flip = () => { s.flipped = !s.flipped; flash.classList.toggle("flipped"); };

  flash.append(
    h("div", { class: "face front" },
      h("button", { class: "box-tag" }, `단계 ${box}/5`),
      h("button", { class: "star-btn" + (store.isStarred(w.id) ? " on" : ""), "aria-label": "어려운 단어 표시", onclick: (e) => { e.stopPropagation(); const on = store.toggleStar(w.id); e.currentTarget.classList.toggle("on", on); } }, "★"),
      h("div", { class: "en" }, w.en),
      ttsSupported() && h("button", { class: "speak-btn", "aria-label": "발음 듣기", onclick: (e) => { e.stopPropagation(); speak(w.en, store.settings().ttsRate); } }, "🔊"),
      h("div", { class: "hint" }, "탭하면 뜻 · 옆으로 밀면 O/X")
    ),
    h("div", { class: "face back" },
      h("div", { class: "en", style: { fontSize: "1.6rem" } }, w.en),
      h("div", { class: "ko" }, w.ko),
      h("div", { class: "hint" }, "알면 → 밀기, 헷갈리면 ← 밀기")
    )
  );

  const advance = (knew) => {
    // remember this card's state so an accidental grade can be undone
    (s.history ||= []).push({ i: s.i, id: w.id, snap: store.snapshotWord(w.id) });
    store.markSeen(w.id, knew);
    if (s.i + 1 >= s.words.length) return finishStudy(s);
    s.i += 1; s.flipped = false;
    go("study");
  };
  const goPrev = () => {
    if (!s.history || !s.history.length) return;
    const last = s.history.pop();
    store.restoreWord(last.id, last.snap); // undo the grade on the card we return to
    s.i = last.i; s.flipped = false;
    go("study");
  };

  // Tap to flip, horizontal swipe to grade (natural on phones).
  let px = 0, py = 0;
  flash.addEventListener("pointerdown", (e) => { px = e.clientX; py = e.clientY; });
  flash.addEventListener("pointerup", (e) => {
    if (e.target.closest(".speak-btn, .star-btn")) return; // let inner controls act
    const dx = e.clientX - px, dy = e.clientY - py;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) advance(dx > 0);
    else flip();
  });

  return screen(
    topbar(s.title, { back: () => go("home"), actions: [h("span", { class: "qcount" }, `${s.i + 1} / ${s.words.length}`)] }),
    h("main", { class: "screen" },
      h("div", { class: "progress-line", style: { marginBottom: "8px" } }, h("span", { style: { width: `${((s.i + 1) / s.words.length) * 100}%` } })),
      h("div", { class: "flash-wrap" }, flash),
      h("div", { class: "row", style: { marginTop: "18px" } },
        h("button", { class: "btn grow", onclick: () => advance(false) }, "✕ 헷갈려요"),
        h("button", { class: "btn primary grow", onclick: () => advance(true) }, "✓ 알아요")
      ),
      (s.history && s.history.length)
        ? h("button", { class: "btn ghost block", style: { marginTop: "8px" }, onclick: goPrev }, "← 이전 카드 (잘못 눌렀을 때)")
        : null
    )
  );
};
function finishStudy(s) {
  go("done", { title: "학습 끝!", msg: `${s.words.length}개 카드를 봤어요`, emoji: "🎉" });
}

// ---- QUIZ SETUP ------------------------------------------------------------
SCREENS.quizSetup = ({ day, cumulative }) => {
  const state = (session.setup ||= { mode: "en2ko", count: 20 });
  const pool = cumulative
    ? store.DAYS.filter((d) => d <= day).flatMap((d) => store.wordsForDay(d))
    : store.wordsForDay(day);
  const title = cumulative ? `DAY 1~${day} 누적` : `DAY ${day}`;
  const countOptions = cumulative ? [20, 40] : [10, 20];
  if (!countOptions.includes(state.count)) state.count = countOptions[countOptions.length - 1];

  const params = { day, cumulative };
  const modeChips = h("div", { class: "chips" });
  for (const [key, m] of Object.entries(MODES)) {
    if (m.audio && !ttsSupported()) continue;
    modeChips.append(h("button", { class: "chip" + (state.mode === key ? " on" : ""), onclick: () => { state.mode = key; go("quizSetup", params); } }, m.label));
  }
  const countChips = h("div", { class: "chips" });
  for (const c of countOptions) countChips.append(h("button", { class: "chip" + (state.count === c ? " on" : ""), onclick: () => { state.count = c; go("quizSetup", params); } }, `${c}문제`));

  return screen(
    topbar(`${title} 시험`, { back: () => go("dayHub", { day }) }),
    h("main", { class: "screen stack" },
      cumulative && h("p", { class: "muted", style: { margin: "0 2px" } }, `DAY 1~${day} 전체 ${pool.length}단어에서 무작위 출제`),
      h("div", { class: "card stack" },
        h("div", { class: "section-title", style: { margin: "0 0 4px" } }, "시험 유형"),
        modeChips,
        h("div", { class: "section-title", style: { margin: "8px 0 4px" } }, "문제 수"),
        countChips),
      h("button", { class: "btn primary block", onclick: () => startQuiz(pool, state.mode, state.count, title) }, "시작하기")
    )
  );
};

// ---- QUIZ PLAY -------------------------------------------------------------
function startQuiz(pool, mode, count, title) {
  const questions = buildQuiz(pool, mode, count);
  session.quiz = { questions, i: 0, correct: 0, wrong: [], title, mode, answered: false };
  go("quiz");
}
function startReview() {
  const words = store.dueForReview(20);
  if (!words.length) return toast("복습할 단어가 아직 없어요");
  startQuiz(words, ttsSupported() ? "en2ko" : "en2ko", words.length, "🎯 오답 · 복습");
}

SCREENS.quiz = () => {
  const q = session.quiz;
  if (!q) return SCREENS.home();
  const item = q.questions[q.i];
  if (item.audio) setTimeout(() => speak(item.word.en, store.settings().ttsRate), 250);

  const head = h("div", { class: "qhead" },
    h("button", { class: "iconbtn back", onclick: () => go("home") }, "✕"),
    h("div", { class: "progress-line grow" }, h("span", { style: { width: `${(q.i / q.questions.length) * 100}%` } })),
    h("div", { class: "qcount" }, `${q.i + 1}/${q.questions.length}`)
  );

  const body = MODES[item.mode].kind === "input" ? spellBody(q, item) : choiceBody(q, item);
  return screen(h("main", { class: "screen", style: { paddingTop: "8px" } }, head, body));
};

function nextQuestion(q) {
  if (q.i + 1 >= q.questions.length) return finishQuiz(q);
  q.i += 1; q.answered = false;
  go("quiz");
}

function choiceBody(q, item) {
  const wrap = h("div", { class: "stack" });
  const promptCard = h("div", { class: "card prompt-card" },
    item.audio
      ? h("div", { class: "stack", style: { alignItems: "center" } },
          h("button", { class: "speak-btn", "aria-label": "발음 듣기", style: { width: "72px", height: "72px", fontSize: "1.8rem" }, onclick: () => speak(item.word.en, store.settings().ttsRate) }, "🔊"),
          h("div", { class: "hint muted" }, "🔊 눌러서 다시 듣기"))
      : h("div", { class: "q" + (item.mode === "ko2en" ? " ko" : "") }, item.prompt)
  );
  const opts = h("div", { class: "options" });
  const buttons = [];
  item.options.forEach((o) => {
    const b = h("button", { class: "option", onclick: () => choose(o, b) }, o.text);
    buttons.push(b); opts.append(b);
  });
  const fb = h("div", { class: "feedback" });

  function choose(o, clickedBtn) {
    if (q.answered) return;
    q.answered = true;
    const correct = o.text === item.correctText;
    store.recordAnswer(item.id, correct);
    if (correct) q.correct += 1; else q.wrong.push(item.word);
    buttons.forEach((b) => {
      b.classList.add("dim");
      if (b.textContent === item.correctText) b.classList.replace("dim", "correct");
      if (b === clickedBtn && !correct) b.classList.replace("dim", "wrong");
    });
    fb.textContent = correct ? "정답! 👍" : `아쉬워요 · ${item.word.en} = ${shortKo(item.word.ko)}`;
    fb.className = "feedback " + (correct ? "ok" : "no");
    setTimeout(() => nextQuestion(q), correct ? 700 : 1500);
  }
  wrap.append(promptCard, opts, fb);
  return wrap;
}

function spellBody(q, item) {
  const wrap = h("div", { class: "stack" });
  const input = h("input", { class: "spell-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "영어로 입력", enterkeyhint: "done" });
  const fb = h("div", { class: "feedback" });
  const submit = h("button", { class: "btn primary block", onclick: check }, "확인");
  let tries = 0;

  function finalize(correct) {
    q.answered = true;
    store.recordAnswer(item.id, correct);
    if (correct) q.correct += 1; else q.wrong.push(item.word);
    input.disabled = true;
    fb.textContent = correct ? (tries > 1 ? "정답! (힌트 사용) 👍" : "정답! 👍") : `정답: ${item.answer}`;
    fb.className = "feedback " + (correct ? "ok" : "no");
    setTimeout(() => nextQuestion(q), correct ? 700 : 1600);
  }
  function check() {
    if (q.answered || !input.value.trim()) return;
    const correct = checkSpelling(input.value, item.answer);
    if (correct) return finalize(true);
    tries += 1;
    if (tries === 1) {
      // one free retry with a first-letter + length hint
      fb.textContent = `아쉬워요 · 힌트: ${item.answer[0]}${"_".repeat(Math.max(0, item.answer.length - 1))} (${item.answer.length}글자)`;
      fb.className = "feedback no";
      input.value = "";
      input.focus();
      return;
    }
    finalize(false);
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
  setTimeout(() => input.focus(), 60);
  wrap.append(h("div", { class: "card prompt-card" }, h("div", { class: "q ko" }, item.prompt)), input, fb, submit);
  return wrap;
}

function finishQuiz(q) {
  const score = Math.round((q.correct / q.questions.length) * 100);
  go("quizResult", { score });
}
SCREENS.quizResult = ({ score }) => {
  const q = session.quiz;
  const emoji = score === 100 ? "🏆" : score >= 80 ? "🎉" : score >= 60 ? "💪" : "📚";
  const wrongList = h("div", { class: "wrong-list" });
  q.wrong.forEach((w) =>
    wrongList.append(
      h("div", { class: "wrong-item", onclick: () => speak(w.en, store.settings().ttsRate) },
        h("span", { class: "en" }, w.en), h("span", { class: "ko" }, shortKo(w.ko)))
    )
  );
  return screen(
    topbar("결과", { back: () => go("home") }),
    h("main", { class: "screen stack" },
      h("div", { class: "card center stack" },
        h("div", { style: { fontSize: "3rem" } }, emoji),
        h("div", { class: "result-score" }, `${score}점`),
        h("div", { class: "muted" }, `${q.correct} / ${q.questions.length} 정답 · ${q.title}`)),
      q.wrong.length
        ? h("div", { class: "card" },
            h("div", { class: "section-title", style: { margin: "0 0 8px" } }, `틀린 단어 ${q.wrong.length}개 (눌러서 발음)`),
            wrongList,
            h("button", { class: "btn primary block", style: { marginTop: "12px" }, onclick: () => startStudy(q.wrong.slice(), "오답 다시 외우기") }, "📖 오답만 다시 외우기"),
            h("button", { class: "btn block", style: { marginTop: "8px" }, onclick: () => startQuiz(q.wrong.slice(), q.mode, q.wrong.length, "오답 재시험") }, "✏️ 오답만 다시 시험"))
        : h("div", { class: "card center" }, h("b", {}, "완벽해요! 틀린 단어가 없어요 ✨")),
      h("button", { class: "btn block", onclick: () => go("home") }, "홈으로")
    )
  );
};

// ---- generic DONE ----------------------------------------------------------
SCREENS.done = ({ title, msg, emoji }) =>
  screen(
    topbar(title, { back: () => go("home") }),
    h("main", { class: "screen" },
      h("div", { class: "card center stack", style: { marginTop: "40px" } },
        h("div", { style: { fontSize: "3.4rem" } }, emoji || "✅"),
        h("h2", {}, title), h("p", { class: "muted" }, msg),
        h("button", { class: "btn primary block", onclick: () => go("home") }, "홈으로"))
    )
  );

// ---- PROFILES --------------------------------------------------------------
SCREENS.profiles = () => {
  const list = h("div", { class: "stack" });
  store.profiles().forEach((p) => {
    const active = p.id === store.activeProfile().id;
    list.append(
      h("div", { class: "field" },
        h("button", { class: "row grow", style: { alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--text)" }, onclick: () => { store.switchProfile(p.id); toast(`${p.name}으로 전환`); go("home"); } },
          h("span", { class: "avatar", style: { background: p.color } }, p.name.slice(0, 1)),
          h("b", { style: { marginLeft: "10px" } }, p.name), active && h("span", { class: "muted", style: { marginLeft: "8px" } }, "· 사용 중")),
        h("button", { class: "iconbtn", "aria-label": "이름 변경", onclick: () => { const n = prompt("이름 변경", p.name); if (n && n.trim()) { store.renameProfile(p.id, n); go("profiles"); } } }, "✏️"),
        store.profiles().length > 1 && h("button", { class: "iconbtn", "aria-label": "삭제", onclick: () => { if (confirm(`${p.name} 학습자를 삭제할까요?`)) { store.removeProfile(p.id); go("profiles"); } } }, "🗑")
      )
    );
  });
  return screen(
    topbar("학습자", { back: () => go("home") }),
    h("main", { class: "screen stack" },
      h("div", { class: "card" }, list),
      h("button", { class: "btn primary block", onclick: () => { const n = prompt("새 학습자 이름"); if (n) { store.addProfile(n); go("home"); } } }, "+ 학습자 추가"))
  );
};

// ---- SETTINGS --------------------------------------------------------------
SCREENS.settings = () => {
  const s = store.settings();
  const themeChips = h("div", { class: "chips" });
  [["auto", "자동"], ["light", "밝게"], ["dark", "어둡게"]].forEach(([v, l]) =>
    themeChips.append(h("button", { class: "chip" + (s.theme === v ? " on" : ""), onclick: () => { store.updateSettings({ theme: v }); go("settings"); } }, l)));

  return screen(
    topbar("설정", { back: () => go("home") }),
    h("main", { class: "screen stack" },
      h("div", { class: "card" },
        h("div", { class: "field" }, h("label", {}, "테마"), themeChips),
        h("div", { class: "field" }, h("label", {}, "글자 크기"),
          h("input", { type: "range", min: "0.9", max: "1.3", step: "0.1", value: s.fontScale, oninput: (e) => { store.updateSettings({ fontScale: parseFloat(e.target.value) }); applyChrome(); } })),
        ttsSupported() && h("div", { class: "field" }, h("label", {}, "발음 속도"),
          h("input", { type: "range", min: "0.6", max: "1.1", step: "0.05", value: s.ttsRate, oninput: (e) => store.updateSettings({ ttsRate: parseFloat(e.target.value) }), onchange: () => speak("hello", store.settings().ttsRate) }))),
      h("div", { class: "card" },
        h("div", { class: "field" }, h("label", {}, "이 학습자 진도 초기화"),
          h("button", { class: "btn", onclick: () => { if (confirm("현재 학습자의 모든 진도를 지울까요?")) { store.resetProgress(); toast("초기화했어요"); go("home"); } } }, "초기화"))),
      h("p", { class: "muted center", style: { fontSize: "0.8rem" } }, `${store.META.total}단어 · 오프라인 지원 · v2`)
    )
  );
};

// ---- boot ------------------------------------------------------------------
store.onChange(() => {}); // reserved for future live-refresh
applyChrome();
go("home");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
