// store.js — persistent state: profiles, per-word progress, Leitner SRS, streak.
// One source of truth, saved to localStorage. UI reads via getters, writes via actions.

import { VOCAB } from "./data.js";

const STORAGE_KEY = "jrvoca:v2";

// Leitner boxes 1..5 → days until a word is due for review again.
// Box 1 (just wrong) comes back same day; box 5 (well known) rests a week.
const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 7 };
export const MAX_BOX = 5;

// Flat list of every word with its day, plus quick lookup by id.
export const WORDS = VOCAB.days.flatMap((d) => d.words.map((w) => ({ ...w, day: d.day })));
export const WORDS_BY_ID = new Map(WORDS.map((w) => [w.id, w]));
export const DAYS = VOCAB.days.map((d) => d.day);
export const META = VOCAB.meta;

// ---- date helpers (local day, no time component) ---------------------------
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysBetween = (aKey, bKey) => Math.round((Date.parse(bKey) - Date.parse(aKey)) / 86400000);

// ---- state shape -----------------------------------------------------------
const blankProgress = () => ({
  words: {}, // id -> { box, star, seen, correct, wrong, lastKey }
  streak: { count: 0, lastKey: null },
});

const freshState = () => {
  const id = "p1";
  return {
    activeProfile: id,
    profiles: { [id]: { id, name: "우리 아이", color: "#38bdf8" } },
    progress: { [id]: blankProgress() },
    settings: { theme: "auto", fontScale: 1, ttsRate: 0.85 },
  };
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed.profiles || !parsed.activeProfile) return freshState();
    return parsed;
  } catch {
    return freshState();
  }
}

const subscribers = new Set();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — keep running in memory */
  }
  subscribers.forEach((fn) => fn());
}
export const onChange = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

// ---- profiles --------------------------------------------------------------
export const profiles = () => Object.values(state.profiles);
export const activeProfile = () => state.profiles[state.activeProfile];
export const settings = () => state.settings;

function activeProgress() {
  const id = state.activeProfile;
  if (!state.progress[id]) state.progress[id] = blankProgress();
  return state.progress[id];
}

export function addProfile(name, color = "#34d399") {
  const id = "p" + (Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  state.profiles[id] = { id, name: name.trim() || "새 학습자", color };
  state.progress[id] = blankProgress();
  state.activeProfile = id;
  save();
}
export function switchProfile(id) {
  if (state.profiles[id]) {
    state.activeProfile = id;
    save();
  }
}
export function renameProfile(id, name) {
  if (state.profiles[id]) {
    state.profiles[id].name = name.trim() || state.profiles[id].name;
    save();
  }
}
export function removeProfile(id) {
  if (Object.keys(state.profiles).length <= 1) return; // keep at least one
  delete state.profiles[id];
  delete state.progress[id];
  if (state.activeProfile === id) state.activeProfile = Object.keys(state.profiles)[0];
  save();
}

// ---- settings --------------------------------------------------------------
export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  save();
}

// ---- word progress ---------------------------------------------------------
function wordRec(id) {
  const p = activeProgress();
  if (!p.words[id]) p.words[id] = { box: 1, star: false, seen: 0, correct: 0, wrong: 0, lastKey: null };
  return p.words[id];
}
export const getWord = (id) => activeProgress().words[id] || null;

function bumpStreak() {
  const p = activeProgress();
  const today = todayKey();
  if (p.streak.lastKey === today) return;
  const gap = p.streak.lastKey ? daysBetween(p.streak.lastKey, today) : null;
  p.streak.count = gap === 1 ? p.streak.count + 1 : 1;
  p.streak.lastKey = today;
}
export const streak = () => activeProgress().streak;

// Record a study answer. Correct → box up (rest longer); wrong → back to box 1.
export function recordAnswer(id, correct) {
  const rec = wordRec(id);
  rec.seen += 1;
  rec.lastKey = todayKey();
  if (correct) {
    rec.correct += 1;
    rec.box = Math.min(MAX_BOX, rec.box + 1);
  } else {
    rec.wrong += 1;
    rec.box = 1;
  }
  bumpStreak();
  save();
}
// Flashcard "봤어요" — counts as engagement and a gentle box bump, no wrong penalty.
export function markSeen(id, knewIt) {
  const rec = wordRec(id);
  rec.seen += 1;
  rec.lastKey = todayKey();
  if (knewIt) rec.box = Math.min(MAX_BOX, rec.box + 1);
  bumpStreak();
  save();
}
export function toggleStar(id) {
  const rec = wordRec(id);
  rec.star = !rec.star;
  save();
  return rec.star;
}

// ---- queries used by screens ----------------------------------------------
export const boxOf = (id) => (activeProgress().words[id]?.box ?? 1);
export const isStarred = (id) => !!activeProgress().words[id]?.star;
export const starredWords = () => WORDS.filter((w) => isStarred(w.id));

// Mastery for a day = share of its words sitting in box 4–5.
export function dayMastery(day) {
  const words = VOCAB.days[day - 1].words;
  const learned = words.filter((w) => (activeProgress().words[w.id]?.box ?? 1) >= 4).length;
  return { learned, total: words.length, ratio: learned / words.length };
}
export function overallStats() {
  const p = activeProgress().words;
  let seen = 0,
    mastered = 0;
  for (const w of WORDS) {
    const rec = p[w.id];
    if (rec?.seen) seen += 1;
    if ((rec?.box ?? 1) >= 4) mastered += 1;
  }
  return { seen, mastered, total: WORDS.length };
}

// Words due for review today (box interval elapsed) plus any never-correct wrongs.
// Ordered lowest box first so the shakiest words surface soonest.
export function dueForReview(limit = 40) {
  const today = todayKey();
  const p = activeProgress().words;
  const due = [];
  for (const w of WORDS) {
    const rec = p[w.id];
    if (!rec || !rec.lastKey) continue; // never studied → belongs to normal study, not review
    const interval = BOX_INTERVAL_DAYS[rec.box] ?? 0;
    if (daysBetween(rec.lastKey, today) >= interval) due.push(w);
  }
  due.sort((a, b) => (p[a.id].box - p[b.id].box) || (Date.parse(p[a.id].lastKey) - Date.parse(p[b.id].lastKey)));
  return due.slice(0, limit);
}
export const dueCount = () => dueForReview(9999).length;

export function resetProgress() {
  state.progress[state.activeProfile] = blankProgress();
  save();
}

export function wordsForDay(day) {
  return VOCAB.days[day - 1].words.map((w) => ({ ...w, day }));
}
